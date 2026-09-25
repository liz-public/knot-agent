/** Map proxy API settings. Configure before running map.* handlers on a real device. */
export interface MapApiConfig {
  readonly baseUrl: string
  readonly apiKey: string
}

const BASE_ENV_KEYS = ['CASE1_MAP_API_BASE', 'KNOT_MAP_API_BASE'] as const
const KEY_ENV_KEYS = ['CASE1_MAP_API_KEY', 'KNOT_MAP_API_KEY'] as const

function readEnv(keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value !== undefined && value.length > 0) return value
  }
  return undefined
}

export function readMapApiConfig(): MapApiConfig | undefined {
  const baseUrl = readEnv(BASE_ENV_KEYS)
  const apiKey = readEnv(KEY_ENV_KEYS)
  if (baseUrl === undefined || apiKey === undefined) return undefined
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey }
}
