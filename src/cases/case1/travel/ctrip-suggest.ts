import provinces from './ctrip-provinces.json' with { type: 'json' }

const capitals = new Map(provinces.map(row => [row.name, row.capital]))
export function normalizeCtripPlace(value: string): string {
  const key = value.trim().replace(/(?:壮族自治区|回族自治区|维吾尔自治区|自治区|省|市)$/, '')
  return capitals.get(key) ?? value.trim()
}
export interface CtripPlace {
  readonly cityId: number; readonly cityName: string; readonly label: string; readonly domestic: boolean
  readonly type: string; readonly near?: { latitude: number; longitude: number }
}
export type CtripPlaceResult = { ok: true; place: CtripPlace } | { ok: false; error: string; hint: string }

/** One authority for Ctrip IDs and country classification. The small capital table only normalizes input names. */
export async function resolveCtripPlace(value: string, purpose: 'city' | 'train' | 'hotel', cityId?: number): Promise<CtripPlaceResult> {
  const keyword = normalizeCtripPlace(value)
  try {
    const response = await fetch('https://m.ctrip.com/restapi/soa2/21881/json/gaHotelSearchEngine', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ keyword, searchType: purpose === 'hotel' ? 'H' : 'D', platform: 'online', pageID: '102001',
        head: { Locale: 'zh-CN', LocaleController: 'zh_cn', Currency: 'CNY', PageId: '102001', clientID: 'knot-ctrip-suggest',
          group: 'ctrip', Frontend: { sessionID: 1, pvid: 1 }, HotelExtension: { group: 'CTRIP', WebpSupport: false } } }) })
    if (!response.ok) return { ok: false, error: 'ctrip_request_failed', hint: '携程地点检索失败，未打开查询页面。' }
    const body = await response.json() as { Result?: boolean; Response?: { searchResults?: Record<string, any>[] } }
    if (body.Result !== true) return { ok: false, error: 'ctrip_suggest_rejected', hint: '携程未能完成地点检索，未打开查询页面。' }
    const rows = body.Response?.searchResults ?? []
    const types = purpose === 'train' ? ['City', 'IntlCity', 'RailwayStation']
      : purpose === 'hotel' ? ['City', 'IntlCity', 'Zone', 'Markland', 'Hotel', 'MetroStation', 'Location'] : ['City', 'IntlCity', 'Airport']
    const first = rows[0]
    if (first && ['Province', 'Country'].includes(first.type)) return { ok: false, error: 'need_city', hint: '请明确要查询的城市。' }
    const row = rows.find(r => types.includes(r.type) && Number(r.cityId) > 0 && (cityId === undefined || Number(r.cityId) === cityId))
    if (!row) return { ok: false, error: 'unknown_city', hint: '携程未匹配到可查询的地点，请明确城市或站名。' }
    if (typeof row.domestic !== 'boolean') return { ok: false, error: 'city_country_unresolved', hint: '携程未返回地点的国内/国际属性。' }
    const near = typeof row.gdLat === 'number' && typeof row.gdLon === 'number' && row.gdLat !== 0 && row.gdLon !== 0
      ? { latitude: row.gdLat, longitude: row.gdLon } : undefined
    return { ok: true, place: { cityId: Number(row.cityId), cityName: String(row.cityName || row.word),
      label: String(row.word || row.cityName), domestic: row.domestic, type: row.type, ...(near ? { near } : {}) } }
  } catch { return { ok: false, error: 'ctrip_request_failed', hint: '携程地点检索暂不可用，未打开查询页面。' } }
}
