import type { ToolHandler } from '../../dispatcher.js'
import type { AdbExecutor } from '../executor.js'
import { err, ok } from '../json.js'
import { readCachedLocation } from '../location.js'
import { fetchWeatherJson } from '../map-client.js'
import type { MapApiConfig } from '../map-config.js'

export interface WeatherHandlerOptions {
  readonly mapApi?: MapApiConfig
}

function requireMapApi(options: WeatherHandlerOptions) {
  return options.mapApi === undefined
    ? err('map_api_unconfigured', '地图 API 未配置。请设置 CASE1_MAP_API_BASE 与 CASE1_MAP_API_KEY。')
    : undefined
}

function formatWeatherBody(body: Record<string, unknown>) {
  if (body['ok'] !== true) {
    const info = typeof body['info'] === 'string' ? body['info'] : ''
    const error = typeof body['error'] === 'string' ? body['error'] : 'weather_failed'
    return err(error, info.length > 0 ? info : '天气查询失败。')
  }
  const payload: Record<string, unknown> = {}
  if (typeof body['city'] === 'string') payload['city'] = body['city']
  if (typeof body['province'] === 'string') payload['province'] = body['province']
  if (typeof body['country'] === 'string') payload['country'] = body['country']
  const live = body['live']
  if (typeof live === 'object' && live !== null) payload['current'] = live
  const daily = body['daily']
  if (Array.isArray(daily) && daily.length > 0) payload['forecast'] = daily
  return ok(payload, '天气查询完成。')
}

export function weatherHandlers(
  executor: AdbExecutor,
  options: WeatherHandlerOptions = {},
): Readonly<Record<string, ToolHandler>> {
  return {
    async get_weather(arguments_) {
      const missing = requireMapApi(options)
      if (missing !== undefined) return missing
      const modeRaw = typeof arguments_['mode'] === 'string' ? arguments_['mode'].trim().toLowerCase() : 'live'
      const isLiveOnly = modeRaw === 'live' || modeRaw === 'now' || modeRaw === 'current'
      const city = typeof arguments_['city'] === 'string' ? arguments_['city'].trim() : ''
      const countryCode = typeof arguments_['country_code'] === 'string' ? arguments_['country_code'].trim().toUpperCase() : ''

      if (city.length > 0) {
        const params: Record<string, string> = {
          city,
          extensions: isLiveOnly ? 'base' : 'all',
        }
        if (countryCode.length > 0) params['country_code'] = countryCode
        if (!isLiveOnly) params['forecast_days'] = '7'
        const body = await fetchWeatherJson(options.mapApi!, params)
        return body === undefined
          ? err('weather_failed', '天气查询失败。')
          : formatWeatherBody(body)
      }

      const location = await readCachedLocation(executor)
      if (location === undefined) {
        return err('location_unavailable', '无法获取设备位置，请打开定位后重试。')
      }
      const body = await fetchWeatherJson(options.mapApi!, {
        location: `${location.longitude},${location.latitude}`,
        extensions: isLiveOnly ? 'base' : 'all',
      })
      return body === undefined
        ? err('weather_failed', '天气查询失败。')
        : formatWeatherBody(body)
    },
  }
}
