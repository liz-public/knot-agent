import assert from 'node:assert/strict'
import test from 'node:test'
import { createDeviceRequests } from '../src/workbench/device-requests.js'
import { createDeviceCase1ToolRuntime } from '../src/cases/case1/device-runtime.js'
import { createServer } from 'node:http'
import { createCase1Agent } from '../src/cases/case1/case1.js'
import { llmPlugin } from '../src/agent/plugins/llm.js'

const context = { turnId: 'turn', callId: 'call' }
test('explicit card choice executes before LLM and keeps the normal tool-call/result history', async () => {
  let generations = 0
  const runtime = createDeviceCase1ToolRuntime({ async request(capability, args) {
    assert.equal(generations, 0)
    assert.equal(capability, 'selection.consume')
    assert.deepEqual(args, { ordinal: 2 })
    return { ok: true, selected_title: 'fixture', index_1based: 2 }
  } })
  const agent = createCase1Agent({ dispatcher: runtime.dispatcher, approvalOwner: 'executor', contentSources: runtime.contentSources,
    llm: llmPlugin({ async generate(input) {
      generations++
      const assistant = input.messages.find(message => message.role === 'assistant' && message.tool_calls?.length)
      const result = input.messages.find(message => message.role === 'tool')
      assert.equal(assistant?.tool_calls?.[0]?.function.name, 'bash')
      assert.equal(result?.tool_call_id, assistant?.tool_calls?.[0]?.id)
      return { generated: { content: 'done', toolCalls: [] }, usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11, contextWindow: 100000 } }
    } }) })
  await agent.submit('选择第2项')
  assert.equal(generations, 1)
})
test('flash on/off uses observed native result, never a mock or ADB unsupported handler', async () => {
  const requests: unknown[] = []
  const runtime = createDeviceCase1ToolRuntime({ async request(capability, args, ids) {
    requests.push({ capability, args, ids }); return { ok: true, enabled: args['enabled'] }
  } })
  for (const on of ['on', 'off']) {
    const result = await runtime.dispatcher.dispatch({ toolId: 'set_flashlight', arguments: { on }, context })
    assert.equal(JSON.parse(result.content).on, on === 'on')
    assert.deepEqual(result.state, { key: 'device.flashlight', value: { on: on === 'on' } })
  }
  assert.deepEqual(requests, [true, false].map(enabled => ({ capability: 'torch.set', args: { enabled }, ids: context })))
  const invalid = await runtime.dispatcher.dispatch({ toolId: 'set_flashlight', arguments: { on: 'toggle' }, context })
  assert.equal(JSON.parse(invalid.content).error, 'invalid_on')
  assert.equal(requests.length, 2)
})
test('flash rejects absent confirmation and preserves native permission denial', async () => {
  for (const reply of [{ ok: true }, { ok: false, error: 'permission_denied' }]) {
    const runtime = createDeviceCase1ToolRuntime({ async request() { return reply } })
    const result = await runtime.dispatcher.dispatch({ toolId: 'set_flashlight', arguments: { on: 'on' }, context })
    assert.equal(JSON.parse(result.content).error, reply['ok'] ? 'torch_state_unconfirmed' : 'permission_denied')
  }
})
test('device requests correlate parallel replies, reject duplicates and never resend after disconnect', async () => {
  const broker = createDeviceRequests(10_000)
  const requests: any[] = []
  const detach = broker.attach(request => requests.push(request))
  assert.throws(() => broker.attach(() => {}), /already has/)
  const one = broker.port.request('apps.list', {}, context)
  const two = broker.port.request('location.read', {}, context)
  broker.settle(requests[1].operationId, { ok: true, location: {} })
  broker.settle(requests[0].operationId, { ok: true, apps: [] })
  assert.deepEqual(await one, { ok: true, apps: [] })
  assert.equal((await two)['ok'], true)
  assert.equal(broker.settle(requests[0].operationId, { ok: true }), false)
  const outstanding = broker.port.request('apps.launch', {}, context)
  detach()
  assert.equal((await outstanding)['error'], 'device_outcome_unknown')
  const reconnect = broker.attach(request => requests.push(request))
  assert.equal(requests.length, 3)
  reconnect()
  assert.equal((await broker.port.request('apps.list', {}, context))['error'], 'device_unavailable')
})
test('device timeout reports unknown outcome instead of claiming action failure', async () => {
  const broker = createDeviceRequests(5)
  broker.attach(() => {})
  assert.equal((await broker.port.request('apps.launch', {}, context))['error'], 'device_outcome_unknown')
})
test('business handlers return model results but only send native capabilities and cloud-built deeplinks', async () => {
  const calls: any[] = []
  const runtime = createDeviceCase1ToolRuntime({ async request(capability, args, ids) {
    calls.push({ capability, args, ids })
    if (capability === 'apps.list') return { ok: true, apps: [{ label: '微信', packageName: 'com.tencent.mm' }] }
    if (capability === 'packages.installed') return { ok: true, installed: true }
    return { ok: true }
  } })
  const dispatch = async (toolId: string, args: Record<string, unknown>) =>
    JSON.parse((await runtime.dispatcher.dispatch({ toolId, arguments: args, context })).content)
  assert.equal((await dispatch('list_apps', { query: '微信' })).count, 1)
  assert.equal((await dispatch('launch_app', { package_name: 'com.tencent.mm' })).ok, true)
  assert.equal((await dispatch('content_app_search', { provider: 'iqiyi', keyword: '流浪地球' })).ok, true)
  assert.equal(calls.at(-1).capability, 'intent.view')
  assert.equal(calls.at(-1).args.uri, 'iqiyi://mobile/search?keyword=%E6%B5%81%E6%B5%AA%E5%9C%B0%E7%90%83')
  assert.deepEqual(calls.at(-1).ids, context)
  assert.equal(calls.some(call => call.capability === 'content_app_search'), false)
})
test('native permission denial is preserved and no weather HTTP request is made', async () => {
  const runtime = createDeviceCase1ToolRuntime({ async request() { return { ok: false, error: 'permission_denied' } } },
    { baseUrl: 'http://127.0.0.1:1', apiKey: 'test-only' })
  const result = await runtime.dispatcher.dispatch({ toolId: 'get_weather', arguments: {}, context })
  assert.equal(JSON.parse(result.content).error, 'permission_denied')
})
test('weather HTTP runs on server, specified city skips device and local weather only reads native location', async t => {
  const queries: string[] = []
  const server = createServer((req, res) => {
    queries.push(req.url!)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, city: 'fixture', live: { weather: '晴' } }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const address = server.address() as import('node:net').AddressInfo
  let nativeCalls = 0
  const runtime = createDeviceCase1ToolRuntime({ async request(capability) {
    assert.equal(capability, 'location.read'); nativeCalls++
    return { ok: true, location: { latitude: 39.9, longitude: 116.4, provider: 'fixture' } }
  } }, { baseUrl: `http://127.0.0.1:${address.port}`, apiKey: 'test-only' })
  for (const args of [{ city: '北京' }, {}]) {
    const result = await runtime.dispatcher.dispatch({ toolId: 'get_weather', arguments: args, context })
    assert.equal(JSON.parse(result.content).current.weather, '晴')
  }
  assert.equal(nativeCalls, 1)
  assert.match(queries[0]!, /city=/)
  assert.match(queries[1]!, /location=116.4%2C39.9/)
})
