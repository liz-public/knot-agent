import type { AdbExecutor } from './executor.js'

export interface CachedLocation {
  readonly latitude: number
  readonly longitude: number
  readonly accuracy_m?: number
  readonly provider: string
}

const LOCATION_RE = /last location=Location\[(\w+)\s+([-\d.]+),([-\d.]+)\s+hAcc=([-\d.]+)/g

export function parseCachedLocations(text: string): CachedLocation[] {
  const locations: CachedLocation[] = []
  for (const match of text.matchAll(LOCATION_RE)) {
    const provider = match[1]!
    const latitude = Number(match[2])
    const longitude = Number(match[3])
    const accuracy = Number(match[4])
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue
    locations.push({
      latitude,
      longitude,
      provider,
      ...(Number.isFinite(accuracy) ? { accuracy_m: accuracy } : {}),
    })
  }
  return locations
}

export async function readCachedLocation(executor: AdbExecutor): Promise<CachedLocation | undefined> {
  const text = await executor.shell('dumpsys location')
  const locations = parseCachedLocations(text)
  if (locations.length === 0) return undefined
  const gps = locations.find(item => item.provider === 'gps')
  if (gps !== undefined) return gps
  const network = locations.find(item => item.provider === 'network')
  if (network !== undefined) return network
  return locations[0]
}
