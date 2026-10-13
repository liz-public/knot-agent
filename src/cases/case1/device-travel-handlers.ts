import type { DevicePort } from './device-port.js'
import type { ToolHandler } from './dispatcher.js'
import { err } from './adb/json.js'
import { deviceResult } from './device-result.js'
import { resolveCtripPlace } from './travel/ctrip-suggest.js'
import { ctripFlightListUri, ctripHotelListUri, ctripTrainListUri, CTRIP_PACKAGE } from './adb/ctrip-uri.js'
import { parseDeviceDate, zonedParts } from './device-clock.js'
import { reverseLocation } from './adb/map-client.js'
import type { MapApiConfig } from './adb/map-config.js'

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const dateInPlace = (value: string) => /^(?:今天|明天|后天|\+\d+d|\d{2,4}-\d{2}(?:-\d{2})?)$/.test(value)
export function travelDate(expr: string, now: number, zone: string, daysAfter = 0): string | undefined {
  const p = zonedParts(now, zone)
  const full = /^\d{2}-\d{2}$/.test(expr) ? `${p['year']}-${expr}` : expr
  const epoch = full ? parseDeviceDate(full, now, zone) : now
  if (epoch === undefined) return undefined
  const day = zonedParts(epoch, zone)
  const shifted = new Date(Date.UTC(day['year']!, day['month']! - 1, day['day']! + daysAfter))
  if (!Number.isFinite(shifted.getTime())) return undefined
  return `${shifted.getUTCFullYear()}${String(shifted.getUTCMonth() + 1).padStart(2, '0')}${String(shifted.getUTCDate()).padStart(2, '0')}`
}
export function deviceTravelHandlers(port: DevicePort, mapApi?: MapApiConfig): Readonly<Record<string, ToolHandler>> {
  type Context = Parameters<ToolHandler>[1]
  async function open(uri: string, state: Record<string, unknown>, context: Context) {
    const installed = await port.request('packages.installed', { packageName: CTRIP_PACKAGE }, context)
    if (installed['ok'] !== true) return deviceResult(installed, {}, '')
    if (installed['installed'] !== true) return err('app_not_installed', '携程旅行未安装。')
    const result = await port.request('intent.view', { uri, packageName: CTRIP_PACKAGE }, context)
    return deviceResult(result, { action: 'query_open_requested', provider: 'ctrip', ...state }, '已请求打开携程查询页面。')
  }
  async function place(value: string, context: Context): Promise<string | Record<string, unknown>> {
    if (value) return value
    const location = await port.request('location.read', {}, context)
    if (location['ok'] !== true) return location
    const result = await reverseLocation(mapApi, location['location'] as { latitude: number; longitude: number })
    if (result['ok'] !== true) return result
    return text(result.address.city) || { ok: false, error: 'city_unavailable' }
  }
  return {
    async query_train(args, context) {
      const arrive = text(args['arrive']), departArg = text(args['depart'])
      if (!arrive) return err('need_arrive')
      if (dateInPlace(arrive) || dateInPlace(departArg)) return err('date_in_city_field')
      const depart = await place(departArg, context)
      if (typeof depart !== 'string') return deviceResult(depart, {}, '')
      const clock = await port.request('clock.read', {}, context)
      if (clock['ok'] !== true) return deviceResult(clock, {}, '')
      const date = travelDate(text(args['when']), Number(clock['epochMillis']), String(clock['timeZone']))
      if (!date) return err('bad_date')
      const [origin, destination] = await Promise.all([resolveCtripPlace(depart, 'train'), resolveCtripPlace(arrive, 'train')])
      if (!origin.ok) return err(origin.error, origin.hint)
      if (!destination.ok) return err(destination.error, destination.hint)
      const trainName = (place: typeof origin.place) => place.type === 'RailwayStation' ? place.label.replace(/站$/, '') : place.cityName
      const from = trainName(origin.place), to = trainName(destination.place)
      return open(ctripTrainListUri(from, to, date, args['high_speed'] === true), { kind: 'train', depart: from, arrive: to, date }, context)
    },
    async query_flight(args, context) {
      const arrive = text(args['arrive']), departArg = text(args['depart'])
      if (!arrive) return err('need_arrive')
      if (dateInPlace(arrive) || dateInPlace(departArg)) return err('date_in_city_field')
      const depart = await place(departArg, context)
      if (typeof depart !== 'string') return deviceResult(depart, {}, '')
      const cabin = text(args['cabin']) || 'economy', sort = text(args['sort'])
      if (!['economy', 'premium_economy', 'business', 'first', 'business_first'].includes(cabin)
        || (sort && !['earliest', 'latest', 'cheapest', 'priciest'].includes(sort))) return err('invalid_flight_filter')
      const clock = await port.request('clock.read', {}, context)
      if (clock['ok'] !== true) return deviceResult(clock, {}, '')
      const now = Number(clock['epochMillis']), zone = String(clock['timeZone']), date = travelDate(text(args['when']), now, zone)
      if (!date) return err('bad_date')
      const returnDate = args['round'] === true ? (text(args['return_date']) ? travelDate(text(args['return_date']), now, zone)
        : travelDate(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`, now, zone, 3)) : undefined
      if (args['round'] === true && (!returnDate || returnDate < date)) return err('bad_return_date')
      const [origin, destination] = await Promise.all([resolveCtripPlace(depart, 'city'), resolveCtripPlace(arrive, 'city')])
      if (!origin.ok) return err(origin.error, origin.hint)
      if (!destination.ok) return err(destination.error, destination.hint)
      const from = origin.place, to = destination.place
      const uri = ctripFlightListUri({ depart: { ...from, code: String(from.cityId) }, arrive: { ...to, code: String(to.cityId) },
        date, ...(returnDate ? { returnDate } : {}), cabin, sort })
      return open(uri, { kind: 'flight', depart: from.cityName, arrive: to.cityName, date, ...(returnDate ? { returnDate } : {}) }, context)
    },
    async query_hotel(args, context) {
      const cityArg = text(args['city'])
      if (dateInPlace(cityArg)) return err('date_in_city_field')
      const name = await place(cityArg, context)
      if (typeof name !== 'string') return deviceResult(name, {}, '')
      const nights = Number(args['nights'] ?? 1), sort = text(args['sort'])
      if (!Number.isInteger(nights) || nights < 1) return err('invalid_nights')
      if (sort && !['price_asc', 'price_desc', 'distance', 'star_desc', 'score_desc'].includes(sort)) return err('invalid_hotel_sort')
      const clock = await port.request('clock.read', {}, context)
      if (clock['ok'] !== true) return deviceResult(clock, {}, '')
      const now = Number(clock['epochMillis']), zone = String(clock['timeZone'])
      const checkIn = travelDate(text(args['when']), now, zone), checkOut = travelDate(text(args['when']), now, zone, nights)
      if (!checkIn || !checkOut) return err('bad_date')
      const resolved = await resolveCtripPlace(name, 'hotel')
      if (!resolved.ok) return err(resolved.error, resolved.hint)
      const city = resolved.place
      const area = text(args['area']) || text(args['keyword']) || (!['City', 'IntlCity'].includes(city.type) ? city.label : '')
      let near = !['City', 'IntlCity'].includes(city.type) ? city.near : undefined
      if ((text(args['area']) || text(args['keyword'])) && area !== city.label) {
        const point = await resolveCtripPlace(`${city.cityName} ${area}`, 'hotel', city.cityId)
        if (!point.ok) return err(point.error, point.hint)
        near = ['City', 'IntlCity'].includes(point.place.type) ? undefined : point.place.near
      }
      const uri = ctripHotelListUri({ domestic: city.domestic, cityId: city.cityId, checkIn, checkOut,
        keyword: text(args['keyword']) || (near ? '' : area), brand: text(args['brand']), sort, ...(near ? { near } : {}) })
      return open(uri, { kind: 'hotel', city: city.cityName, checkIn, checkOut, nights, ...(area ? { area } : {}) }, context)
    },
  }
}
