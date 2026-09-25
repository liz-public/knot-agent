import type { MapApiConfig } from './map-config.js'

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
