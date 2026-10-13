import type { MapApiConfig } from './map-config.js'

export interface PlaceAddress {
  readonly province: string; readonly city: string; readonly district: string
  readonly township: string; readonly street: string; readonly formatted_address: string
}

/** Android Location is WGS84. Convert only at the Amap boundary, never by altering native coordinates. */
export async function reverseLocation(config: MapApiConfig | undefined, point: { latitude: number; longitude: number }):
  Promise<{ ok: true; address: PlaceAddress } | { ok: false; error: string }> {
  if (!config?.webKey) return { ok: false, error: 'amap_web_key_unconfigured' }
  const get = async (path: string, params: Record<string, string>) => {
    const url = new URL(`https://restapi.amap.com${path}`)
    url.search = new URLSearchParams({ ...params, key: config.webKey!, output: 'JSON' }).toString()
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error('amap_http_error')
    return await response.json() as Record<string, any>
  }
  try {
    const converted = await get('/v3/assistant/coordinate/convert', {
      locations: `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`, coordsys: 'gps' })
    if (converted['status'] !== '1' || typeof converted['locations'] !== 'string') return { ok: false, error: 'coordinate_conversion_failed' }
    const body = await get('/v3/geocode/regeo', { location: converted['locations'], extensions: 'base' })
    if (body['status'] !== '1' || !body['regeocode']?.addressComponent) return { ok: false, error: 'reverse_geocode_failed' }
    const reg = body['regeocode'], ac = reg.addressComponent
    const text = (value: unknown) => typeof value === 'string' ? value : ''
    const province = text(ac.province), city = text(ac.city) || (province.endsWith('市') ? province : '')
    return { ok: true, address: { province, city, district: text(ac.district), township: text(ac.township),
      street: text(ac.streetNumber?.street), formatted_address: text(reg.formatted_address) } }
  } catch {
    // A thrown fetch error can contain the authenticated URL. Never return its message.
    return { ok: false, error: 'reverse_geocode_request_failed' }
  }
}

export interface MapApiResponse {
  readonly ok: boolean
  readonly tips?: readonly Record<string, unknown>[]
  readonly error?: string
  readonly info?: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function asRows(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
}

export async function mapApiGet(
  config: MapApiConfig,
  path: string,
  params: Record<string, string>,
): Promise<MapApiResponse> {
  const query = Object.entries(params)
    // An explicitly empty required field (nearby keywords) is not an omitted field.
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
  const url = `${config.baseUrl}${path}${query.length > 0 ? `?${query}` : ''}`
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(30_000),
    })
    const body = asRecord(await response.json())
    if (body === undefined) {
      return { ok: false, error: 'parse_error', info: '响应解析失败' }
    }
    if (!response.ok) {
      return {
        ok: false,
        error: typeof body['error'] === 'string' ? body['error'] : 'http_error',
        info: typeof body['info'] === 'string' ? body['info'] : `HTTP ${response.status}`,
      }
    }
    return {
      ok: body['ok'] === true,
      tips: asRows(body['tips']),
      ...(typeof body['error'] === 'string' ? { error: body['error'] } : {}),
      ...(typeof body['info'] === 'string' ? { info: body['info'] } : {}),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: 'network_error', info: message }
  }
}

export async function searchInputTips(
  config: MapApiConfig,
  keywords: string,
  options: { city?: string; location?: string } = {},
): Promise<MapApiResponse> {
  return mapApiGet(config, '/amap/inputtips', {
    keywords,
    ...(options.city === undefined ? {} : { city: options.city }),
    ...(options.location === undefined ? {} : { location: options.location }),
  })
}

export async function searchNearby(
  config: MapApiConfig,
  input: { keywords: string; location: string; types: string; radius: string },
): Promise<MapApiResponse> {
  return mapApiGet(config, '/amap/search_nearby', input)
}

export async function fetchWeatherJson(
  config: MapApiConfig,
  params: Record<string, string>,
): Promise<Record<string, unknown> | undefined> {
  return fetchMapJson(config, '/amap/weather', params)
}

export async function fetchMapJson(config: MapApiConfig, path: string,
  params: Record<string, string>): Promise<Record<string, unknown> | undefined> {
  const query = Object.entries(params)
    .filter(([, value]) => value.length > 0)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
  const url = `${config.baseUrl}${path}${query.length > 0 ? `?${query}` : ''}`
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(30_000),
    })
    const body = asRecord(await response.json())
    if (body === undefined || !response.ok) return undefined
    return body
  } catch {
    return undefined
  }
}
