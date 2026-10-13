import assert from 'node:assert/strict'
import test from 'node:test'
import { deviceContextFacts, deviceContextSource } from '../src/cases/case1/device-context.js'
import { createCase1Agent } from '../src/cases/case1/case1.js'
import { createCliCatalog } from '../src/cases/case1/cli.js'
import { DEVICE_RECORDING_COMMAND } from '../src/cases/case1/device-recording-handlers.js'
import { createToolDispatcher } from '../src/cases/case1/dispatcher.js'
import { mockLlmPlugin } from '../src/cases/case1/llm-mock.js'
test('passive context excludes unknown data and never labels boot steps as today', () => {
  assert.deepEqual(deviceContextFacts({ health: { unavailable: 'permission_required' }, environment: { steps_since_boot: { value: 9000 } } }), [])
  assert.deepEqual(deviceContextFacts({ device: { battery: { percent: 16, status: 2 } }, health: { today_steps: 0 } }), ['电量16%（偏低），正在充电', '健康记录今日步数0'])
})
test('native context contribution precedes tools and does not require an agent tool invocation', async () => {
  const calls: unknown[] = []
  const source = deviceContextSource({ async request(capability, args, context) {
    calls.push({ capability, args, context }); return { ok: true, environment: { lux: { value: 8 } } }
  } })
  const result = await source('打开微信', { turnId: 'turn' })
  assert.deepEqual(calls, [{ capability: 'context.read', args: {}, context: { turnId: 'turn' } }])
  assert.match(result!.content, /光照8lux（偏暗）/)
  assert.equal(result!.matchedCommands, undefined)
})
test('unavailable passive context does not invent a background fact', async () => {
  const source = deviceContextSource({ async request() { return { ok: false, error: 'permission_denied' } } })
  assert.equal(await source('query', { turnId: 'turn' }), undefined)
})
test('assembly puts native background into the first request context and supports explicit catalog', async () => {
  const observed: { type: string; data: unknown }[] = []
  const agent = createCase1Agent({ commands: [DEVICE_RECORDING_COMMAND], dispatcher: createToolDispatcher({}),
    llm: mockLlmPlugin(), trace: event => observed.push(event),
    contextSources: [deviceContextSource({ async request() { return { ok: true, device: { battery: { percent: 16 } } } } })],
  })
  await agent.submit('你好')
  const dynamic = observed.find(event => event.type === 'context.dynamic')!.data as { content: string }
  assert.match(dynamic.content, /电量16%/)
  const registry = JSON.stringify(observed.find(event => event.type === 'tool.registry')!.data)
  assert.match(registry, /record:/)
  assert.doesNotMatch(registry, /confirm|cancel/)
})
