import type { ToolHandler } from '../../dispatcher.js'
import type { AdbExecutor } from '../executor.js'
import { err, ok } from '../json.js'
import type { ToolExecution } from '../../tools.js'
import { readCachedLocation } from '../location.js'
import type { MapApiConfig } from '../map-config.js'
import { searchInputTips, searchNearby } from '../map-client.js'
import {
  createAmapDirectNavUri,
  createAmapRouteUri,
  createAmapShowOnMapUri,
  enrichTipsWithDistance,
  filterInputTips,
  formatLonLat,
  llmPlacesSummary,
  normalizeTravelMode,
  POI_CODE_TO_LABEL,
  POI_TYPE_TO_CODE,
} from '../map-geo.js'
import { shellQuote } from '../parse.js'
import type { AdbDeviceSession, PendingSelection } from '../session.js'

const AMAP_PACKAGE = 'com.autonavi.minimap'

export interface NavigationHandlerOptions {
  readonly mapApi?: MapApiConfig
}

function pendingState(kind: PendingSelection['kind'], places: ReturnType<typeof llmPlacesSummary>): ToolExecution['state'] {
  return { key: 'pending.selection', value: { kind, places } }
}

function requireMapApi(options: NavigationHandlerOptions) {
  return options.mapApi === undefined
    ? err('map_api_unconfigured', '地图 API 未配置。请设置 CASE1_MAP_API_BASE 与 CASE1_MAP_API_KEY。')
    : undefined
}

async function readUserLocation(executor: AdbExecutor): Promise<{ location: string; lonLat: { lon: number; lat: number } } | undefined> {
  const cached = await readCachedLocation(executor)
  if (cached === undefined) return undefined
  const lonLat = { lon: cached.longitude, lat: cached.latitude }
  return { location: formatLonLat(lonLat.lon, lonLat.lat), lonLat }
}

async function resolveOriginLocation(
  config: MapApiConfig,
  src: string | undefined,
  userLocation: { location: string; lonLat: { lon: number; lat: number } } | undefined,
): Promise<{ origin_location: string; origin_name: string } | undefined> {
  if (src === undefined || src.trim().length === 0) {
    if (userLocation === undefined) return undefined
    return { origin_location: userLocation.location, origin_name: '我的位置' }
  }
  const response = await searchInputTips(config, src.trim(), {
    ...(userLocation === undefined ? {} : { location: userLocation.location }),
  })
  if (!response.ok) return undefined
  const tip = filterInputTips(response.tips ?? [])[0]
  if (tip === undefined || tip.location.length === 0) return undefined
  return { origin_location: tip.location, origin_name: tip.name }
}

async function launchMapUri(executor: AdbExecutor, uri: string): Promise<void> {
  await executor.shell(`am start -a android.intent.action.VIEW -d ${shellQuote(uri)} -p ${AMAP_PACKAGE}`)
}

export async function executeMapSelect(
  executor: AdbExecutor,
  session: AdbDeviceSession,
  pending: PendingSelection,
  ordinal: number,
): Promise<ToolExecution> {
  if (pending.kind === 'contact') return err('no_active_list')
  const tip = pending.tips[ordinal - 1]
  if (tip === undefined) return err('invalid_selection')

  if (pending.kind === 'map_navi') {
    const uri = createAmapDirectNavUri(tip, pending.nav_mode, pending.user_location)
    if (uri === undefined) return err('bad_payload', '地点数据无效。')
    await launchMapUri(executor, uri)
    session.pending = undefined
    return ok(
      { action: 'navigate', index_1based: ordinal, source: 'map_navi', nav_mode: pending.nav_mode, place_name: tip.name },
      '已向系统发起导航请求。',
      { key: 'pending.selection', value: null },
    )
  }
  if (pending.kind === 'map_route') {
    const uri = createAmapRouteUri(tip, pending.origin_location, pending.origin_name, pending.route_type)
    if (uri === undefined) return err('bad_payload', '地点数据无效。')
    await launchMapUri(executor, uri)
    session.pending = undefined
    return ok(
      { action: 'route_plan', index_1based: ordinal, source: 'map_route', route_type: pending.route_type, place_name: tip.name },
      '已向系统发起路线规划请求。',
      { key: 'pending.selection', value: null },
    )
  }
  const uri = createAmapShowOnMapUri(tip)
  if (uri === undefined) return err('bad_payload', '地点数据无效。')
  await launchMapUri(executor, uri)
  session.pending = undefined
  return ok(
    { action: 'show_on_map', index_1based: ordinal, source: 'map_nearby', place_name: tip.name },
    '已在地图中显示所选地点。',
    { key: 'pending.selection', value: null },
  )
}

export function navigationHandlers(
  executor: AdbExecutor,
  session: AdbDeviceSession,
  options: NavigationHandlerOptions = {},
): Readonly<Record<string, ToolHandler>> {
  return {
    async map_navigate(arguments_) {
      const missing = requireMapApi(options)
      if (missing !== undefined) return missing
      const dest = arguments_['dest']
      if (typeof dest !== 'string' || dest.trim().length === 0) return err('empty_query')
      const navMode = normalizeTravelMode(typeof arguments_['type'] === 'string' ? arguments_['type'] : 'driving')
      const user = await readUserLocation(executor)
      const response = await searchInputTips(options.mapApi!, dest.trim(), {
        ...(user === undefined ? {} : { location: user.location }),
      })
      if (!response.ok) return err('map_navi_failed', response.info ?? response.error ?? '搜索失败。')
      const tips = enrichTipsWithDistance(filterInputTips(response.tips ?? []), user?.lonLat)
      if (tips.length === 0) return err('no_match', '没有匹配地点。')
      const places = llmPlacesSummary(tips)
      session.pending = { kind: 'map_navi', nav_mode: navMode, user_location: user?.location ?? '', tips }
      return ok(
        { action: 'awaiting_pick', nav_mode: navMode, count: places.length, places },
        '导航候选已暂存，请调用 select 选择地点。',
        pendingState('map_navi', places),
      )
    },

    async map_route_plan(arguments_) {
      const missing = requireMapApi(options)
      if (missing !== undefined) return missing
      const dest = arguments_['dest']
      if (typeof dest !== 'string' || dest.trim().length === 0) return err('empty_query')
      const routeType = normalizeTravelMode(typeof arguments_['type'] === 'string' ? arguments_['type'] : 'driving')
      const user = await readUserLocation(executor)
      const origin = await resolveOriginLocation(
        options.mapApi!,
        typeof arguments_['src'] === 'string' ? arguments_['src'] : undefined,
        user,
      )
      if (origin === undefined) return err('location_unavailable', '无法确定路线起点。')
      const response = await searchInputTips(options.mapApi!, dest.trim(), {
        ...(user === undefined ? {} : { location: user.location }),
      })
      if (!response.ok) return err('map_route_failed', response.info ?? response.error ?? '搜索失败。')
      const tips = enrichTipsWithDistance(filterInputTips(response.tips ?? []), user?.lonLat)
      if (tips.length === 0) return err('no_match', '没有匹配地点。')
      const places = llmPlacesSummary(tips)
      session.pending = {
        kind: 'map_route',
        route_type: routeType,
        user_location: user?.location ?? origin.origin_location,
        origin_location: origin.origin_location,
        origin_name: origin.origin_name,
        tips,
      }
      return ok(
        { action: 'awaiting_pick', route_type: routeType, count: places.length, places },
        '路线候选已暂存，请调用 select 选择地点。',
        pendingState('map_route', places),
      )
    },

    async map_nearby_search(arguments_) {
      const missing = requireMapApi(options)
      if (missing !== undefined) return missing
      const poiType = typeof arguments_['poi_type'] === 'string' ? arguments_['poi_type'] : ''
      const poiCode = POI_TYPE_TO_CODE[poiType]
      if (poiCode === undefined) return err('invalid_poi_type', `无效的 poi_type: ${poiType}`)
      const user = await readUserLocation(executor)
      if (user === undefined) return err('location_unavailable', '无法获取设备位置。')
      const keyword = typeof arguments_['keyword'] === 'string' ? arguments_['keyword'].trim() : ''
      const response = await searchNearby(options.mapApi!, {
        keywords: keyword,
        location: user.location,
        types: poiCode,
        radius: '3000',
      })
      if (!response.ok) return err('map_nearby_failed', response.info ?? response.error ?? '搜索失败。')
      const tips = enrichTipsWithDistance(filterInputTips(response.tips ?? []), user.lonLat)
      const places = llmPlacesSummary(tips)
      if (places.length === 0) {
        return ok({ count: 0, places: [], poi_type: poiType, poi_label: POI_CODE_TO_LABEL[poiCode] ?? poiType }, '未搜索到附近地点。')
      }
      session.pending = { kind: 'map_nearby', tips }
      return ok(
        {
          action: 'awaiting_pick',
          poi_type: poiType,
          poi_label: POI_CODE_TO_LABEL[poiCode] ?? poiType,
          radius: 3000,
          count: places.length,
          places,
        },
        '附近地点候选已暂存，请调用 select 选择地点。',
        pendingState('map_nearby', places),
      )
    },
  }
}
