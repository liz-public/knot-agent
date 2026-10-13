import assert from 'node:assert/strict'
import test from 'node:test'
import { reverseLocation } from '../src/cases/case1/adb/map-client.js'
import { createDeviceCase1ToolRuntime } from '../src/cases/case1/device-runtime.js'
import { deviceTravelHandlers } from '../src/cases/case1/device-travel-handlers.js'
const config = { baseUrl: 'http://unused', apiKey: 'proxy-fixture', webKey: 'web-fixture' }
test('location converts WGS84 once, reads street details and keeps native coordinates distinct', async t => {
  const old = globalThis.fetch, urls: URL[] = [], calls: string[] = []
  globalThis.fetch = async input => {
    const url = new URL(String(input)); urls.push(url)
    return new Response(JSON.stringify(url.pathname.includes('convert') ? { status: '1', locations: '116.406,39.901' }
      : { status: '1', regeocode: { formatted_address: '北京市样本区样本道路', addressComponent: {
        province: '北京市', city: [], district: '样本区', township: '样本街道', streetNumber: { street: '样本道路' } } } }))
  }
  t.after(() => { globalThis.fetch = old })
  const runtime = createDeviceCase1ToolRuntime({ async request(capability) {
    calls.push(capability); return { ok: true, location: { latitude: 39.9, longitude: 116.4, accuracy_m: 30, provider: 'network' } }
  } }, config)
  const reply = JSON.parse((await runtime.dispatcher.dispatch({ toolId: 'get_location', arguments: {}, context: { turnId: 'turn', callId: 'call' } })).content)
  assert.equal(reply.latitude, 39.9); assert.equal(reply.coordinate_system, 'WGS84')
  assert.equal(reply.address.city, '北京市'); assert.equal(reply.address.street, '样本道路')
  assert.equal(urls[0]!.searchParams.get('coordsys'), 'gps')
  assert.equal(urls[1]!.searchParams.get('location'), '116.406,39.901')
  assert.deepEqual(calls, ['location.read']); assert.ok(!JSON.stringify(reply).includes('web-fixture'))
})
test('upstream errors never expose authenticated URLs or invoke an alternate geocoder', async t => {
  const old = globalThis.fetch
  globalThis.fetch = async input => { throw Error(String(input)) }
  t.after(() => { globalThis.fetch = old })
  const result = await reverseLocation(config, { latitude: 39.9, longitude: 116.4 })
  assert.deepEqual(result, { ok: false, error: 'reverse_geocode_request_failed' })
  assert.equal(JSON.stringify(result).includes('web-fixture'), false)
  assert.equal((await reverseLocation(undefined, { latitude: 39.9, longitude: 116.4 })).ok, false)
})
test('travel default city uses the same cloud reverse helper, not device location.reverse', async t => {
  const old = globalThis.fetch, calls: any[] = []
  globalThis.fetch = async input => {
    const url = new URL(String(input))
    const body = url.pathname.includes('convert') ? { status: '1', locations: '116.406,39.901' }
      : url.pathname.includes('regeo') ? { status: '1', regeocode: { addressComponent: { province: '北京市', city: [] } } }
      : { Result: true, Response: { searchResults: [{ type: 'City', cityId: 1, cityName: '北京', word: '北京', domestic: true }] } }
    return new Response(JSON.stringify(body))
  }
  t.after(() => { globalThis.fetch = old })
  const handlers = deviceTravelHandlers({ async request(capability, args) {
    calls.push({ capability, args })
    return capability === 'location.read' ? { ok: true, location: { latitude: 39.9, longitude: 116.4 } }
      : capability === 'clock.read' ? { ok: true, epochMillis: Date.parse('2026-10-13T03:00:00Z'), timeZone: 'Asia/Shanghai' }
      : { ok: true, installed: true }
  } }, config)
  await handlers['query_train']!({ arrive: '北京', when: '明天' }, { turnId: 'turn', callId: 'call' })
  assert.equal(calls.filter(c => c.capability === 'location.read').length, 1)
  assert.equal(calls.some(c => c.capability === 'location.reverse'), false)
  assert.equal(new URL(calls.at(-1).args.uri).searchParams.get('c1'), '北京')
})
