import type { MapPlaceTip } from './session.js'

export interface MapPlaceSummary {
  readonly ordinal_1based: number
  readonly name: string
}

const ROUTE_TYPE_CODE: Record<string, number> = {
  driving: 0,
  transit: 1,
  walking: 2,
  riding: 3,
}

export const POI_TYPE_TO_CODE: Readonly<Record<string, string>> = {
  '购物': '060000',
  '景点': '110000',
  '地铁': '150500',
  '公交': '150700',
  '银行': '160100',
  '停车': '150900',
  '加油': '010100',
  '充电': '011100',
}

export const POI_CODE_TO_LABEL: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(POI_TYPE_TO_CODE).map(([label, code]) => [code, label]),
)

export function normalizeTravelMode(raw: string): string {
  const text = raw.trim().toLowerCase()
  if (text.length === 0) return 'driving'
  switch (text) {
    case 'drive': case 'driving': case 'car': case '驾车': return 'driving'
    case 'walk': case 'walking': case '步行': return 'walking'
    case 'ride': case 'riding': case 'cycling': case 'bike': case '骑行': return 'riding'
    case 'bus': case 'transit': case '公交': case '地铁': return 'transit'
    default: return text in ROUTE_TYPE_CODE ? text : 'driving'
  }
}

export function parseLonLat(raw: string): { lon: number; lat: number } | undefined {
  const parts = raw.trim().split(',').map(item => item.trim())
  if (parts.length !== 2) return undefined
  const lon = Number(parts[0])
  const lat = Number(parts[1])
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return undefined
  return { lon, lat }
}

export function formatLonLat(lon: number, lat: number): string {
  return `${lon},${lat}`
}

export function haversineMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const r = 6_371_000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(Math.min(1, a)))
}

export function formatDistanceFromUserMeters(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} 公里`
}

function isNonEmptyTipRow(row: Record<string, unknown>): boolean {
  const fields = ['district', 'address', 'location', 'id', 'adcode'] as const
  return fields.some(field => {
    const value = row[field]
    return typeof value === 'string' && value.trim().length > 0
  }) || (typeof row['name'] === 'string' && row['name'].trim().length > 0)
}

export function filterInputTips(rows: readonly Record<string, unknown>[]): MapPlaceTip[] {
  const tips: MapPlaceTip[] = []
  for (const row of rows) {
    if (!isNonEmptyTipRow(row)) continue
    const name = typeof row['name'] === 'string' ? row['name'].trim() : ''
    const location = typeof row['location'] === 'string' ? row['location'].trim() : ''
    if (name.length === 0 && location.length === 0) continue
    tips.push({
      name: name.length > 0 ? name : '地点',
      location,
      ...(typeof row['district'] === 'string' && row['district'].length > 0 ? { district: row['district'] } : {}),
      ...(typeof row['address'] === 'string' && row['address'].length > 0 ? { address: row['address'] } : {}),
      ...(typeof row['distance_meters'] === 'number' ? { distance_meters: row['distance_meters'] } : {}),
      ...(typeof row['distance_label'] === 'string' ? { distance_label: row['distance_label'] } : {}),
    })
  }
  return tips
}

export function enrichTipsWithDistance(tips: MapPlaceTip[], userLonLat?: { lon: number; lat: number }): MapPlaceTip[] {
  if (userLonLat === undefined) return tips
  return tips.map(tip => {
    if (tip.distance_meters !== undefined && tip.distance_label !== undefined) return tip
    const point = parseLonLat(tip.location)
    if (point === undefined) return tip
    const meters = haversineMeters(userLonLat.lon, userLonLat.lat, point.lon, point.lat)
    return {
      ...tip,
      distance_meters: Math.round(meters),
      distance_label: formatDistanceFromUserMeters(meters),
    }
  })
}

export function llmPlacesSummary(tips: readonly MapPlaceTip[]): MapPlaceSummary[] {
  return tips
    .map((tip, index) => ({ ordinal_1based: index + 1, name: tip.name.trim() }))
    .filter(item => item.name.length > 0)
}

function encode(value: string): string {
  return encodeURIComponent(value)
}

export function createAmapDirectNavUri(place: MapPlaceTip, navMode: string, originLocation: string): string | undefined {
  const mode = normalizeTravelMode(navMode)
  const point = parseLonLat(place.location)
  if (point === undefined) return undefined
  const name = encode(place.name.trim() || '目的地')
  if (mode === 'walking') {
    return `amapuri://openFeature?featureName=OnFootNavi&poiname=${name}&lat=${point.lat}&lon=${point.lon}`
  }
  if (mode === 'riding') {
    return `amapuri://openFeature?featureName=OnRideNavi&rideType=bike&poiname=${name}&lat=${point.lat}&lon=${point.lon}`
  }
  if (mode === 'transit') {
    return createAmapRouteUri(place, originLocation, '我的位置', 'transit') ?? undefined
  }
  return `androidamap://navi?poiname=${name}&lat=${point.lat}&lon=${point.lon}&dev=0`
}

export function createAmapRouteUri(
  dest: MapPlaceTip,
  originLocation: string,
  originName: string,
  routeType: string,
): string | undefined {
  const destPoint = parseLonLat(dest.location)
  const originPoint = parseLonLat(originLocation)
  if (destPoint === undefined || originPoint === undefined) return undefined
  const mode = normalizeTravelMode(routeType)
  const t = ROUTE_TYPE_CODE[mode] ?? 0
  const sn = encode(originName.trim() || '我的位置')
  const dn = encode(dest.name.trim() || '目的地')
  let uri = `androidamap://route/plan?slat=${originPoint.lat}&slon=${originPoint.lon}&sname=${sn}&dlat=${destPoint.lat}&dlon=${destPoint.lon}&dname=${dn}&t=${t}`
  if (mode === 'riding') uri += '&rideType=bike'
  return uri
}

export function createAmapShowOnMapUri(place: MapPlaceTip): string | undefined {
  const point = parseLonLat(place.location)
  if (point === undefined) return undefined
  const name = encode(place.name.trim() || '地点')
  return `androidamap://viewMap?sourceApplication=knot-agent&poiname=${name}&lat=${point.lat}&lon=${point.lon}&dev=0`
}
