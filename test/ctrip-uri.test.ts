import assert from 'node:assert/strict'
import test from 'node:test'
import { ctripFlightListUri, ctripHotelListUri, ctripTrainListUri } from '../src/cases/case1/adb/ctrip-uri.js'
const beijing = { code: 'BJS', cityId: 1, domestic: true }, shanghai = { code: 'SHA', cityId: 2, domestic: true }
test('domestic and international flights use the device-verified cabin/sort positions', () => {
  const domestic = new URL(ctripFlightListUri({ depart: beijing, arrive: shanghai, date: '20261012', cabin: 'business', sort: 'cheapest' }))
  assert.equal(domestic.pathname, '/flight_inland_singlelist')
  assert.equal(domestic.searchParams.get('c6'), '5')
  assert.equal(domestic.searchParams.get('c7'), '3')
  assert.equal(domestic.searchParams.has('c5'), false)
  const intl = new URL(ctripFlightListUri({ depart: beijing, arrive: { code: '228', cityId: 228, domestic: false },
    date: '20261012', returnDate: '20261015', cabin: 'business_first', sort: 'earliest' }))
  assert.equal(intl.pathname, '/flight_int_tolist')
  assert.equal(intl.searchParams.get('c7'), '9')
  assert.equal(intl.searchParams.get('c8'), '1')
  assert.equal(intl.searchParams.get('c5'), '20261015')
  assert.equal(intl.searchParams.get('acityid'), '228')
})
test('hotel and train preserve Chinese parameters and omit absent filters', () => {
  const hotel = new URL(ctripHotelListUri({ domestic: true, cityId: 2, checkIn: '20261012', checkOut: '20261014',
    keyword: '希尔顿 & 陆家嘴', brand: '希尔顿', sort: 'price_asc', near: { latitude: 31.2, longitude: 121.4 } }))
  assert.equal(hotel.searchParams.get('c24'), '希尔顿 & 陆家嘴')
  assert.equal(hotel.searchParams.get('c9'), '2')
  assert.equal(hotel.searchParams.get('c10'), '31.2')
  const train = new URL(ctripTrainListUri('北京', '上海虹桥', '20261012', true))
  assert.equal(train.searchParams.get('c2'), '上海虹桥')
  assert.equal(train.searchParams.get('c6'), '1')
  assert.equal(new URL(ctripTrainListUri('北京', '上海', '20261012', false)).searchParams.has('c6'), false)
})
