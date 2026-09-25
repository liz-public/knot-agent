/** Map proxy API settings. Configure before running map.* handlers on a real device. */
export interface MapApiConfig {
  readonly baseUrl: string
  readonly apiKey: string
}

export function readMapApiConfig(): MapApiConfig | undefined {
  const baseUrl = process.env['CASE1_MAP_API_BASE']?.trim()
  const apiKey = process.env['CASE1_MAP_API_KEY']?.trim()
  if (baseUrl === undefined || apiKey === undefined) return undefined
  if (baseUrl.length === 0 || apiKey.length === 0) return undefined
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey }
}
