import assert from 'node:assert/strict'
import test from 'node:test'
import { deviceTravelHandlers, travelDate } from '../src/cases/case1/device-travel-handlers.js'
import { normalizeCtripPlace, resolveCtripPlace } from '../src/cases/case1/travel/ctrip-suggest.js'
const context = { turnId: 'turn', callId: 'call' }, now = Date.parse('2026-10-11T03:00:00Z')
const city = (name: string, id: number, domestic = true) => ({ type: domestic ? 'City' : 'IntlCity', word: name, cityName: name, cityId: id, domestic })
function mockFetch(t: any, respond: (url: URL, body: any) => unknown) {
  const old = globalThis.fetch
  globalThis.fetch = async (input, init) => new Response(JSON.stringify(respond(new URL(String(input)), init?.body ? JSON.parse(String(init.body)) : {})))
  t.after(() => { globalThis.fetch = old })
}
function ctrip(rows: unknown[]) { return { Result: true, Response: { searchResults: rows } } }
test('travel dates remain phone-local and province normalization is only a name policy', () => {
  assert.equal(travelDate('10-12', now, 'Asia/Shanghai'), '20261012')
  assert.equal(travelDate('明天', now, 'Asia/Shanghai', 2), '20261014')
  assert.equal(travelDate('2026-02-30', now, 'Asia/Shanghai'), undefined)
  assert.equal(normalizeCtripPlace('辽宁省'), '沈阳')
  assert.equal(normalizeCtripPlace('广西壮族自治区'), '南宁')
  assert.equal(normalizeCtripPlace('韩国'), '韩国')
})
test('flights resolve capital through Ctrip and use cityIds for domestic and international links', async t => {
  const queries: string[] = [], calls: any[] = []
  mockFetch(t, (_, body) => {
    queries.push(body.keyword)
    return ctrip([body.keyword === '北京' ? city('北京', 1) : body.keyword === '沈阳' ? city('沈阳', 451) : city('东京', 228, false)])
  })
  const handlers = deviceTravelHandlers({ async request(capability, args) {
    calls.push({ capability, args }); return capability === 'clock.read' ? { ok: true, epochMillis: now, timeZone: 'Asia/Shanghai' } : { ok: true, installed: true }
  } })
  await handlers['query_flight']!({ depart: '北京', arrive: '辽宁', when: '明天' }, context)
  const domestic = new URL(calls.at(-1).args.uri)
  assert.equal(domestic.pathname, '/flight_inland_singlelist'); assert.equal(domestic.searchParams.get('c3'), '451')
  assert.equal(domestic.searchParams.get('acityid'), '451'); assert.ok(queries.includes('沈阳'))
  await handlers['query_flight']!({ depart: '北京', arrive: '东京', when: '明天', round: true }, context)
  const intl = new URL(calls.at(-1).args.uri)
  assert.equal(intl.pathname, '/flight_int_tolist'); assert.equal(intl.searchParams.get('c3'), '228')
  assert.equal(intl.searchParams.get('c5'), '20261015')
})
test('station names and hotel landmarks come from the same online authority', async t => {
  const calls: any[] = []
  mockFetch(t, (_, body) => ctrip([body.keyword.includes('陆家嘴')
    ? { ...city('上海', 2), type: 'Zone', word: '陆家嘴', gdLat: 31.2, gdLon: 121.4 }
    : body.keyword === '济南西站' ? { ...city('济南', 144), type: 'RailwayStation', word: '济南西站' }
    : body.keyword === '上海虹桥站' ? { ...city('上海', 2), type: 'RailwayStation', word: '上海虹桥站' } : city('上海', 2)]))
  const handlers = deviceTravelHandlers({ async request(capability, args) {
    calls.push({ capability, args }); return capability === 'clock.read' ? { ok: true, epochMillis: now, timeZone: 'Asia/Shanghai' } : { ok: true, installed: true }
  } })
  await handlers['query_train']!({ depart: '济南西站', arrive: '上海虹桥站', when: '明天' }, context)
  assert.equal(new URL(calls.at(-1).args.uri).searchParams.get('c1'), '济南西')
  assert.equal(new URL(calls.at(-1).args.uri).searchParams.get('c2'), '上海虹桥')
  await handlers['query_hotel']!({ city: '上海', area: '陆家嘴', when: '明天', nights: 2 }, context)
  const hotel = new URL(calls.at(-1).args.uri)
  assert.equal(hotel.searchParams.get('c3'), '2'); assert.equal(hotel.searchParams.get('c10'), '31.2')
  assert.equal(hotel.searchParams.get('c2'), '20261014')
  assert.ok(!calls.some(c => c.capability === 'location.reverse'))
})
test('unresolved country, upstream failure and mismatched landmark cities never silently fall back', async t => {
  let rows: any[] = [{ type: 'Country', cityId: -1 }]
  mockFetch(t, () => ctrip(rows))
  const country = await resolveCtripPlace('韩国', 'city'); assert.equal(country.ok, false)
  rows = [city('上海', 2)]
  assert.equal((await resolveCtripPlace('外地地标', 'hotel', 1)).ok, false)
  rows = [{ type: 'City', cityId: 1, word: '北京' }]
  const missing = await resolveCtripPlace('北京', 'city'); assert.equal(missing.ok, false)
  globalThis.fetch = async () => { throw Error('network') }
  assert.equal((await resolveCtripPlace('北京', 'city')).ok, false)
})
test('hotel zone with no coordinates retains its keyword without duplicate lookup or a guessed city-center point', async t => {
  let queries = 0
  mockFetch(t, () => { queries++; return ctrip([{ ...city('上海', 2), type: 'Zone', word: '陆家嘴', gdLat: 0, gdLon: 0 }]) })
  let uri = ''
  const handlers = deviceTravelHandlers({ async request(capability, args) {
    if (capability === 'intent.view') uri = String(args['uri'])
    return capability === 'clock.read' ? { ok: true, epochMillis: now, timeZone: 'Asia/Shanghai' } : { ok: true, installed: true }
  } })
  await handlers['query_hotel']!({ city: '陆家嘴' }, context)
  assert.equal(queries, 1)
  assert.equal(new URL(uri).searchParams.get('c24'), '陆家嘴')
  assert.equal(new URL(uri).searchParams.has('c10'), false)
})
test('permission denial and invalid dates do not issue online searches or open pages', async t => {
  mockFetch(t, () => { throw Error('must not fetch') })
  const calls: string[] = []
  const handlers = deviceTravelHandlers({ async request(capability) {
    calls.push(capability)
    return capability === 'clock.read' ? { ok: true, epochMillis: now, timeZone: 'Asia/Shanghai' } : { ok: false, error: 'permission_denied' }
  } })
  assert.equal(JSON.parse((await handlers['query_train']!({ arrive: '上海' }, context)).content).error, 'permission_denied')
  assert.equal(JSON.parse((await handlers['query_hotel']!({ city: '上海', when: '2026-02-30' }, context)).content).error, 'bad_date')
  assert.ok(!calls.includes('intent.view'))
})
