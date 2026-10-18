import type { DevicePort } from '../../device/port.js'
import type { ToolHandler } from './dispatcher.js'
import type { MapApiConfig } from './adb/map-config.js'
import { searchInputTips, searchNearby } from './adb/map-client.js'
import { createAmapDirectNavUri, createAmapRouteUri, createAmapShowOnMapUri, enrichTipsWithDistance,
  filterInputTips, formatLonLat, llmPlacesSummary, normalizeTravelMode, POI_TYPE_TO_CODE } from './adb/map-geo.js'
import type { MapPlaceTip } from './adb/session.js'
import { err, ok } from './tool-result.js'
import { deviceResult } from './device-result.js'

/** Cloud owns map search and URI configuration; the device owns the actionable list. */
export function deviceMapHandlers(port: DevicePort, config?: MapApiConfig): Readonly<Record<string, ToolHandler>> {
  type Context = Parameters<ToolHandler>[1]
  const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
  async function location(context: Context) {
    const result = await port.request('location.read', {}, context)
    const point = result['location'] as { latitude: number; longitude: number } | undefined
    return { result: result['ok'] === true && !point ? { ok: false, error: 'location_unavailable' } : result, user: result['ok'] === true && point ? {
      location: formatLonLat(point.longitude, point.latitude), lonLat: { lon: point.longitude, lat: point.latitude }
    } : undefined }
  }
  async function present(kind: string, tips: MapPlaceTip[], uri: (tip: MapPlaceTip) => string | undefined,
    fields: Record<string, unknown>, context: Context) {
    const usable = tips.map(tip => ({ tip, uri: uri(tip) })).filter((item): item is { tip: MapPlaceTip; uri: string } => !!item.uri)
    if (!usable.length) {
      const cleared = await port.request('selection.present', { kind, items: [] }, context)
      return cleared['ok'] === true ? { ...err('no_match', '没有可定位的匹配地点。'), state: { key: 'pending.selection', value: null } }
        : deviceResult(cleared, {}, '')
    }
    const installed = await port.request('packages.installed', { packageName: 'com.autonavi.minimap' }, context)
    if (installed['ok'] !== true) return deviceResult(installed, {}, '')
    if (installed['installed'] !== true) return err('app_not_installed', '高德地图未安装。')
    const result = await port.request('selection.present', { kind, items: usable.map(({ tip, uri }) => ({ title: tip.name,
      subtitle: tip.address, tags: tip.distance_label ? [tip.distance_label] : [],
      intent: { action: 'android.intent.action.VIEW', uri, packageName: 'com.autonavi.minimap' }
    })) }, context)
    const places = llmPlacesSummary(usable.map(item => item.tip))
    const reply = deviceResult(result, { action: 'awaiting_pick', count: places.length, places, ...fields }, '请用户选择哪一个地点。')
    return result['ok'] === true ? { ...reply, state: { key: 'pending.selection', value: { kind, places } } } : reply
  }
  return {
    async map_navigate(args, context) {
      if (!config) return err('map_api_unconfigured')
      const dest = text(args['dest'])
      if (!dest) return err('empty_query')
      const mode = normalizeTravelMode(text(args['type']))
      const { user, result } = await location(context)
      if (mode === 'transit' && !user) return deviceResult(result, {}, '')
      const response = await searchInputTips(config, dest, user ? { location: user.location } : {})
      if (!response.ok) return err('map_navi_failed', response.info ?? response.error)
      const tips = enrichTipsWithDistance(filterInputTips(response.tips ?? []), user?.lonLat)
      return present('map_navi', tips, tip => createAmapDirectNavUri(tip, mode, user?.location ?? ''), { nav_mode: mode }, context)
    },
    async map_route_plan(args, context) {
      if (!config) return err('map_api_unconfigured')
      const dest = text(args['dest']), src = text(args['src'])
      if (!dest) return err('empty_query')
      const mode = normalizeTravelMode(text(args['type'])), { user, result } = await location(context)
      let origin = user?.location, originName = '我的位置'
      if (src) {
        const response = await searchInputTips(config, src, user ? { location: user.location } : {})
        if (!response.ok) return err('map_origin_failed', response.info ?? response.error)
        const tip = filterInputTips(response.tips ?? [])[0]
        origin = tip?.location; originName = tip?.name ?? src
      }
      if (!origin) return user ? err('location_unavailable') : result['ok'] !== true ? deviceResult(result, {}, '') : err('location_unavailable')
      const response = await searchInputTips(config, dest, user ? { location: user.location } : {})
      if (!response.ok) return err('map_route_failed', response.info ?? response.error)
      const tips = enrichTipsWithDistance(filterInputTips(response.tips ?? []), user?.lonLat)
      return present('map_route', tips, tip => createAmapRouteUri(tip, origin!, originName, mode), { route_type: mode }, context)
    },
    async map_nearby_search(args, context) {
      if (!config) return err('map_api_unconfigured')
      const type = text(args['poi_type']), code = POI_TYPE_TO_CODE[type]
      if (!code) return err('invalid_poi_type')
      const { user, result } = await location(context)
      if (!user) return deviceResult(result, {}, '')
      const response = await searchNearby(config, { keywords: text(args['keyword']), location: user.location, types: code, radius: '3000' })
      if (!response.ok) return err('map_nearby_failed', response.info ?? response.error)
      const tips = enrichTipsWithDistance(filterInputTips(response.tips ?? []), user.lonLat)
      if (!tips.length) {
        const cleared = await port.request('selection.present', { kind: 'map_nearby', items: [] }, context)
        return cleared['ok'] === true ? { ...ok({ count: 0, places: [], poi_type: type }, '未找到附近地点。'),
          state: { key: 'pending.selection', value: null } } : deviceResult(cleared, {}, '')
      }
      return present('map_nearby', tips, createAmapShowOnMapUri, { poi_type: type, radius: 3000 }, context)
    },
  }
}
