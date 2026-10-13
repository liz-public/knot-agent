import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { deviceMapHandlers } from '../src/cases/case1/device-map-handlers.js'
const context = { turnId: 'turn', callId: 'call' }
test('cloud maps build native actionable rows; no cloud pending list or model-visible URI', async t => {
  const server = createServer((req, res) => {
    const name = new URL(req.url!, 'http://fixture').searchParams.get('keywords') ?? 'fixture'
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, tips: [{ name, location: name === 'start fixture' ? '116.3,39.8' : '116.4,39.9', address: 'fixture street' }] }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const calls: any[] = []
  const handlers = deviceMapHandlers({ async request(capability, args, ids) {
    calls.push({ capability, args, ids })
    if (capability === 'location.read') return { ok: true, location: { latitude: 39.8, longitude: 116.3 } }
    return { ok: true, installed: true, count: 1, cardId: 'native-private-ref' }
  } }, { baseUrl: `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`, apiKey: 'fixture' })
  for (const [tool, args] of [['map_navigate', { dest: 'fixture', type: 'walking' }],
    ['map_route_plan', { dest: 'fixture', src: 'start fixture', type: 'transit' }], ['map_nearby_search', { poi_type: '银行' }]] as const) {
    const reply = await handlers[tool]!(args, context), result = JSON.parse(reply.content)
    assert.equal(result.action, 'awaiting_pick')
    assert.equal(result.count, 1)
    assert.equal(reply.content.includes('native-private-ref'), false)
    assert.equal(reply.content.includes('amapuri'), false)
    const request = calls.at(-1)
    assert.equal(request.capability, 'selection.present')
    assert.equal(request.args.items[0].intent.packageName, 'com.autonavi.minimap')
    assert.equal(request.args.items[0].intent.action, 'android.intent.action.VIEW')
    assert.deepEqual(request.ids, context)
    assert.equal(request.args.items[0].subtitle.includes('fixture street'), true)
  }
  assert.match(calls.filter(call => call.capability === 'selection.present')[0].args.items[0].intent.uri, /OnFootNavi/)
  assert.match(calls.filter(call => call.capability === 'selection.present')[1].args.items[0].intent.uri, /t=1/)
  const route = new URL(calls.filter(call => call.capability === 'selection.present')[1].args.items[0].intent.uri)
  assert.equal(route.searchParams.get('sname'), 'start fixture')
  assert.equal(route.searchParams.get('slat'), '39.8')
  assert.equal(route.searchParams.get('dlat'), '39.9')
})
test('nearby location denial is preserved and no candidate is presented', async () => {
  let count = 0
  const handlers = deviceMapHandlers({ async request() { count++; return { ok: false, error: 'permission_denied' } } },
    { baseUrl: 'http://127.0.0.1:1', apiKey: 'fixture' })
  assert.equal(JSON.parse((await handlers['map_nearby_search']!({ poi_type: '银行' }, context)).content).error, 'permission_denied')
  assert.equal(count, 1)
  assert.equal(JSON.parse((await handlers['map_nearby_search']!({ poi_type: 'invalid' }, context)).content).error, 'invalid_poi_type')
  assert.equal(count, 1)
})
test('a successful empty search clears the real old list and its context belief', async t => {
  const server = createServer((req, res) => {
    const params = new URL(req.url!, 'http://fixture').searchParams
    assert.equal(params.has('keywords'), true)
    assert.equal(params.get('keywords'), '')
    res.setHeader('content-type', 'application/json'); res.end('{"ok":true,"tips":[]}')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const calls: any[] = []
  const handlers = deviceMapHandlers({ async request(capability, args) {
    calls.push({ capability, args })
    return capability === 'location.read' ? { ok: true, location: { latitude: 39.9, longitude: 116.4 } } : { ok: true }
  } }, { baseUrl: `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`, apiKey: 'fixture' })
  const result = await handlers['map_nearby_search']!({ poi_type: '银行' }, context)
  assert.equal(JSON.parse(result.content).count, 0)
  assert.deepEqual(calls.at(-1), { capability: 'selection.present', args: { kind: 'map_nearby', items: [] } })
  assert.deepEqual(result.state, { key: 'pending.selection', value: null })
})
