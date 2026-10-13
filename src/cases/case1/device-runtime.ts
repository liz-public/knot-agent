import type { DevicePort } from './device-port.js'
import type { Case1ToolRuntime } from './tool-runtimes.js'
import { createToolDispatcher } from './dispatcher.js'
import { err, ok } from './adb/json.js'
import { contentSearchTarget, isContentSearchProvider } from './adb/content-deeplinks.js'
import { createWeatherHandler } from './adb/commands/weather.js'
import { readMapApiConfig } from './adb/map-config.js'
import { reverseLocation } from './adb/map-client.js'
import type { CachedLocation } from './adb/location.js'
import { localDateFields, parseDateExpr } from './adb/datetime.js'
import type { AppMatch } from './context-contributions.js'
import { deviceResult as nativeResult } from './device-result.js'
import { deviceAppHandlers } from './device-app-handlers.js'
import { deviceSystemHandlers } from './device-system-handlers.js'
import { deviceContactHandlers } from './device-contact-handlers.js'
import { deviceRecordHandlers } from './device-record-handlers.js'
import type { AskPort } from './ask-port.js'
import { deviceTravelHandlers } from './device-travel-handlers.js'
import { deviceMapHandlers } from './device-map-handlers.js'
import { androidSelectionRule, androidRecordingStopRule, shortcutSource } from './shortcuts.js'
import { deviceScreenHandlers } from './device-screen-handlers.js'
import { ANDROID_TOOL_CATALOG } from './android-tool-catalog.js'
import { DEVICE_RECORDING_COMMAND, deviceRecordingHandlers } from './device-recording-handlers.js'
import { deviceContextSource } from './device-context.js'

/** Cloud business handlers invoke narrow native capabilities; no shell/ADB emulation. */
export function createDeviceCase1ToolRuntime(port: DevicePort, mapApi = readMapApiConfig(), askPort?: AskPort): Case1ToolRuntime {
  const request = port.request.bind(port)
  // Same session-scoped installed-app view as the ADB app index. Native execution remains authoritative.
  let appSnapshot: readonly AppMatch[] | undefined
  const list = async (context: { turnId: string; callId?: string }) => {
    if (appSnapshot) return { ok: true, apps: appSnapshot }
    const result = await request('apps.list', {}, context)
    if (result['ok'] === true) appSnapshot = result['apps'] as AppMatch[]
    return result
  }
  const matched = (apps: readonly AppMatch[], query: string, limit: number) => {
    const key = query.trim().toLowerCase()
    return apps.filter(app => !key || app.label.toLowerCase().includes(key)
      || key.includes(app.label.toLowerCase()) || app.packageName.toLowerCase().includes(key)).slice(0, limit)
  }
  const asApps = (result: Record<string, unknown>) => result['apps'] as AppMatch[]
  return {
    commands: [...ANDROID_TOOL_CATALOG, DEVICE_RECORDING_COMMAND],
    contextSources: [deviceContextSource(port)],
    approvalOwner: 'executor',
    includeToolState: false,
    contentSources: [shortcutSource([androidSelectionRule, androidRecordingStopRule])],
    appMatcher: { async match(query, context) {
      if (!context) return []
      const result = await list(context)
      return result['ok'] === true ? matched(asApps(result), query, 5) : []
    } },
    dispatcher: createToolDispatcher({
      ...deviceAppHandlers(port),
      ...deviceSystemHandlers(port),
      ...deviceContactHandlers(port),
      ...deviceRecordHandlers(port),
      ...deviceTravelHandlers(port, mapApi),
      ...deviceMapHandlers(port, mapApi),
      ...deviceScreenHandlers(port),
      ...deviceRecordingHandlers(port),
      async ask(args) {
        if (typeof args['question'] !== 'string' || !args['question'].trim()) return err('missing_question')
        if (!askPort) return err('ask_unavailable')
        const choices = args['choices']
        if (choices !== undefined && typeof choices !== 'string') return err('invalid_choices')
        const result = await askPort.ask({ question: args['question'], ...(typeof choices === 'string'
          ? { choices: choices.split(',').map(value => value.trim()).filter(Boolean) } : {}) })
        return result.cancelled ? err('user_cancelled', '用户取消了回答。') : ok({ answer: result.answer }, '已收到用户回答。')
      },
      async set_flashlight(args, context) {
        if (args['on'] !== 'on' && args['on'] !== 'off') return err('invalid_on')
        const on = args['on'] === 'on'
        const result = await request('torch.set', { enabled: on }, context)
        if (result['ok'] !== true) return nativeResult(result, {}, '')
        if (result['enabled'] !== on) return err('torch_state_unconfirmed')
        return ok({ on }, on ? '手电筒已开启。' : '手电筒已关闭。', { key: 'device.flashlight', value: { on } })
      },
      async get_location(_, context) {
        const result = await request('location.read', {}, context)
        if (result['ok'] !== true) return nativeResult(result, {}, '')
        const point = result['location'] as CachedLocation
        const reversed = await reverseLocation(mapApi, point)
        if (!reversed.ok) return err(reversed.error, '已获取设备坐标，但地址解析失败，不能确认所在街道。')
        return ok({ ...point, coordinate_system: 'WGS84', address: reversed.address }, '已解析设备最近一次缓存位置，非重新实时定位。')
      },
      async list_apps(args, context) {
        const limit = Number(args['limit'] ?? 40)
        if (!Number.isInteger(limit) || limit < 1) return err('invalid_limit')
        const query = typeof args['query'] === 'string' ? args['query'] : ''
        const result = await list(context)
        if (result['ok'] !== true) return err(String(result['error']))
        const apps = matched(asApps(result), query, Math.min(limit, 500))
        return ok({ ...(query ? { query } : {}), count: apps.length, apps }, query ? '已搜索安装应用。' : '已列出安装应用。')
      },
      async launch_app(args, context) {
        const name = args['package_name']
        if (typeof name !== 'string' || !name.trim()) return err('empty_package')
        return nativeResult(await request('apps.launch', { packageName: name }, context),
          { package_name: name }, '已向系统发起应用启动请求。')
      },
      async open_android_uri(args, context) {
        if (typeof args['uri'] !== 'string' || !args['uri']) return err('empty_uri')
        return nativeResult(await request('intent.view', { uri: args['uri'] }, context),
          { action: 'uri_open_requested' }, '已向系统发起打开 URI 请求。')
      },
      async content_app_search(args, context) {
        const provider = args['provider'], keyword = args['keyword']
        if (typeof keyword !== 'string' || !keyword.trim()) return err('missing_keyword')
        if (typeof provider !== 'string' || !isContentSearchProvider(provider)) return err('invalid_provider')
        const target = contentSearchTarget(provider)
        const installed = await request('packages.installed', { packageName: target.packageName }, context)
        if (installed['ok'] !== true) return err(String(installed['error']))
        if (installed['installed'] !== true) return err('app_not_installed', '目标应用未安装。', { provider, package_name: target.packageName })
        return nativeResult(await request('intent.view', { uri: target.buildUri(keyword.trim()), packageName: target.packageName }, context),
          { action: 'content_search_opened', provider, keyword: keyword.trim() }, '已在指定 App 内打开搜索。')
      },
      async get_weather(args, context) {
        let failure: Record<string, unknown> | undefined
        const handler = createWeatherHandler(async () => {
          const result = await request('location.read', {}, context)
          if (result['ok'] !== true) { failure = result; return undefined }
          return result['location'] as CachedLocation
        }, { mapApi })
        const result = await handler(args, context)
        return failure ? err(String(failure['error'])) : result
      },
      date(args) {
        const now = new Date(), expr = args['expr']
        const date = typeof expr === 'string' && expr.trim() ? parseDateExpr(expr, now) : now
        return date ? ok(localDateFields(date), '日期已解析，时间为所示时区的本地时间。') : err('bad_date')
      },
    }),
  }
}
