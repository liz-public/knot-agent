import type { DevicePort } from '../../device/port.js'
import type { ToolHandler } from './dispatcher.js'
import { deviceResult } from './device-result.js'
import { err } from './tool-result.js'
import { parseAlarmRepeatWeekdays } from './adb/alarm.js'
import { resolveSettingsPage, suggestSettingsPages } from './adb/settings-catalog.js'
import { CTRIP_PACKAGE, ctripTicketInquireUri, ctripTicketListUri } from './adb/ctrip-uri.js'
import { marketStoreSearchUri, samsungGalaxyStoreSearchUri, SAMSUNG_GALAXY_STORE_PACKAGE } from './adb/app-store.js'
import { meetingTarget, FOOD_APPS, SHOP_APPS, foodUri, shoppingUri, trackingUri } from './app-links.js'

type Context = Parameters<ToolHandler>[1]
type Target = { id: string; packageName: string }
const wechat = { id: 'wechat', packageName: 'com.tencent.mm' }
const alipay = { id: 'alipay', packageName: 'com.eg.android.AlipayGphone' }
const unionpay = { id: 'unionpay', packageName: 'com.unionpay' }
const meituan = { id: 'meituan', packageName: 'com.sankuai.meituan' }

/** Business slots and app links stay on the server. SDK receives only Android launch primitives. */
export function deviceAppHandlers(port: DevicePort): Readonly<Record<string, ToolHandler>> {
  const request = port.request.bind(port)
  const launch = async (intent: Record<string, unknown>, payload: Record<string, unknown>, hint: string, context: Context) =>
    deviceResult(await request('intent.launch', intent, context), payload, hint)
  const view = async (uri: string, packageName: string | undefined, payload: Record<string, unknown>, hint: string, context: Context) =>
    deviceResult(await request('intent.view', { uri, ...(packageName ? { packageName } : {}) }, context), payload, hint)
  async function installedView(uri: string, packageName: string, payload: Record<string, unknown>, hint: string, context: Context) {
    const status = await request('packages.installed', { packageName }, context)
    if (status['ok'] !== true) return deviceResult(status, {}, '')
    if (status['installed'] !== true) return err('app_not_installed', '目标应用未安装，请告知用户，可询问是否需要安装帮助。')
    return view(uri, packageName, payload, hint, context)
  }
  async function choose(targets: readonly Target[], provider: unknown, context: Context) {
    if (provider !== undefined && (typeof provider !== 'string' || !targets.some(target => target.id === provider)))
      return err('invalid_provider')
    for (const target of provider === undefined ? targets : targets.filter(target => target.id === provider)) {
      const result = await request('packages.installed', { packageName: target.packageName }, context)
      if (result['ok'] !== true) return deviceResult(result, {}, '')
      if (result['installed'] === true) return target
    }
    return err('app_not_installed', '没有已安装的目标应用，可询问用户是否需要安装帮助。')
  }
  return {
    async set_alarm_clock(args, context) {
      const hour = Number(args['hour']), minute = Number(args['minute'] ?? 0)
      if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return err('invalid_time')
      const repeat = typeof args['repeat_weekdays'] === 'string' ? args['repeat_weekdays'].trim() : ''
      const days = repeat ? parseAlarmRepeatWeekdays(repeat) : undefined
      if (repeat && !days) return err('bad_repeat_days')
      return launch({ action: 'android.intent.action.SET_ALARM', extras: {
        'android.intent.extra.alarm.HOUR': hour, 'android.intent.extra.alarm.MINUTES': minute,
        'android.intent.extra.alarm.SKIP_UI': true, ...(days ? { 'android.intent.extra.alarm.DAYS': days } : {}),
      } }, { action: 'alarm_set_requested', hour, minute }, '已向系统发起设置闹钟请求。', context)
    },
    show_alarm_clocks: (_, context) => launch({ action: 'android.intent.action.SHOW_ALARMS' },
      { action: 'show_alarms_requested' }, '已向系统发起打开闹钟列表请求。', context),
    async set_timer(args, context) {
      const raw = args['seconds'], message = typeof args['message'] === 'string' ? args['message'].trim() : ''
      if (raw === undefined || raw === '') return launch({ action: 'android.intent.action.SHOW_TIMERS' },
        { action: 'show_timers_requested' }, '已向系统发起打开计时器请求。', context)
      const seconds = Number(raw)
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86400) return err('invalid_seconds')
      return launch({ action: 'android.intent.action.SET_TIMER', extras: {
        'android.intent.extra.alarm.LENGTH': seconds, ...(message ? { 'android.intent.extra.alarm.MESSAGE': message } : {}),
      } }, { action: 'timer_set_requested', seconds }, '已向系统发起设置计时器请求。', context)
    },
    set_hotspot_enabled: (_, context) => launch({ action: resolveSettingsPage('hotspot')!.action },
      { action: 'hotspot_settings_requested' }, '已请求打开热点设置页，尚未改变热点开关。', context),
    async pick_ringtone(args, context) {
      const type = String(args['type'] ?? 'ring'), types: Record<string, number> = { ring: 1, alarm: 4, notification: 2 }
      if (!types[type]) return err('invalid_type')
      return launch({ action: 'android.intent.action.RINGTONE_PICKER', extras: { 'android.intent.extra.ringtone.TYPE': types[type] } },
        { action: 'ringtone_picker_requested', type }, '已请求打开铃声选择器。', context)
    },
    show_input_method_picker: async (_, context) => deviceResult(await request('ime.show', {}, context),
      { action: 'input_method_picker_requested' }, '已请求显示输入法选择器。'),
    async open_settings_page(args, context) {
      const page = typeof args['page'] === 'string' ? args['page'].trim() : ''
      if (!page) return err('missing_page')
      const target = resolveSettingsPage(page)
      if (!target) return err('settings_not_matched', '未匹配到设置页。', { suggestions: suggestSettingsPages(page).map(({ id, label }) => ({ id, label })) })
      return launch({ action: target.action }, { action: 'settings_page_requested', matched_id: target.id, matched_label: target.label }, '已请求打开设置页。', context)
    },
    async send_sms(args, context) {
      const phone = args['phone'], text = args['text']
      if (typeof phone !== 'string' || !phone.trim() || typeof text !== 'string') return err('invalid_arguments')
      return launch({ action: 'android.intent.action.SENDTO', uri: 'smsto:' + phone.trim(), extras: { sms_body: text } },
        { action: 'sms_editor_requested' }, '已请求打开系统短信编辑页，短信尚未发送。', context)
    },
    async wechat_send(args, context) {
      const text = args['text']
      if (typeof text !== 'string' || !text.trim()) return err('invalid_args')
      const result = await request('packages.installed', { packageName: wechat.packageName }, context)
      if (result['ok'] !== true) return deviceResult(result, {}, '')
      if (result['installed'] !== true) return err('app_not_installed', '微信未安装。')
      return launch({ action: 'android.intent.action.SEND', mimeType: 'text/plain',
        component: { packageName: wechat.packageName, className: 'com.tencent.mm.ui.tools.ShareImgUI' },
        extras: { 'android.intent.extra.TEXT': text } }, { action: 'wechat_share_requested' }, '已请求打开微信分享页，消息尚未发送。', context)
    },
    async scan(args, context) {
      const target = await choose([wechat, alipay, unionpay, meituan], args['provider'], context)
      if ('content' in target) return target
      if (target.id === 'wechat') return launch({ action: 'android.intent.action.MAIN',
        component: { packageName: target.packageName, className: 'com.tencent.mm.ui.LauncherUI' },
        extras: { 'LauncherUI.From.Scaner.Shortcut': true } }, { provider: target.id, action: 'scan_requested' }, '已请求打开扫一扫。', context)
      const urls: Record<string, string> = { alipay: 'alipayqr://platformapi/startapp?saId=10000007', unionpay: 'upwallet://native/scanCode', meituan: 'imeituan://www.meituan.com/scan' }
      return view(urls[target.id]!, target.packageName, { provider: target.id, action: 'scan_requested' }, '已请求打开扫一扫。', context)
    },
    async pay(args, context) {
      const target = await choose([wechat, alipay, unionpay], args['provider'], context)
      if ('content' in target) return target
      const receive = args['receive'] === true
      if (receive && target.id !== 'alipay') return err('unsupported_receive_provider', '此执行环境尚未接入该应用的收款码入口。')
      if (target.id === 'wechat') return launch({ action: 'android.intent.action.MAIN',
        component: { packageName: target.packageName, className: 'com.tencent.mm.ui.ShortCutDispatchActivity' },
        extras: { 'LauncherUI.Shortcut.LaunchType': 'launch_type_offline_wallet' } },
        { provider: target.id, action: 'payment_code_requested' }, '已请求打开付款码。', context)
      const uri = target.id === 'alipay' ? `alipays://platformapi/startapp?appId=${receive ? '20000123' : '20000056'}` : 'upwallet://native/qrcode'
      return view(uri, target.packageName, { provider: target.id, receive, action: 'payment_code_requested' }, '已请求打开付款或收款码。', context)
    },
    async ride(args, context) {
      const target = await choose([alipay, unionpay], args['provider'], context)
      if ('content' in target) return target
      return view(target.id === 'alipay' ? 'alipayqr://platformapi/startapp?saId=200011235' : 'upwallet://native/rideCode',
        target.packageName, { provider: target.id, action: 'ride_requested' }, '已请求打开乘车码。', context)
    },
    async search_app_store(args, context) {
      const keyword = typeof args['keyword'] === 'string' ? args['keyword'].trim() : ''
      if (!keyword) return err('missing_keyword')
      const status = await request('packages.installed', { packageName: SAMSUNG_GALAXY_STORE_PACKAGE }, context)
      if (status['ok'] !== true) return deviceResult(status, {}, '')
      return view(status['installed'] === true ? samsungGalaxyStoreSearchUri(keyword) : marketStoreSearchUri(keyword),
        status['installed'] === true ? SAMSUNG_GALAXY_STORE_PACKAGE : undefined, { action: 'store_search_requested', keyword }, '已请求应用商店搜索。', context)
    },
    async explore_food(args, context) {
      const target = await choose(FOOD_APPS, args['provider'], context)
      if ('content' in target) return target
      const keyword = typeof args['keyword'] === 'string' ? args['keyword'].trim() : ''
      const uri = foodUri(target.id, keyword)
      return view(uri, target.packageName, { action: keyword ? 'food_search_requested' : 'food_home_requested', provider: target.id, ...(keyword ? { keyword } : {}) }, '已请求打开美食页面。', context)
    },
    async search_shopping(args, context) {
      const keyword = typeof args['keyword'] === 'string' ? args['keyword'].trim() : ''
      if (!keyword) return err('missing_keyword')
      const target = await choose(SHOP_APPS, args['provider'], context)
      if ('content' in target) return target
      const uri = shoppingUri(target.id, keyword)
      if (target.id === 'taobao') return launch({ action: 'android.intent.action.VIEW', uri,
        component: { packageName: target.packageName, className: 'com.taobao.browser.BrowserActivity' } },
        { action: 'shopping_search_requested', provider: target.id, keyword }, '已请求打开购物搜索。', context)
      return view(uri, target.packageName, { action: 'shopping_search_requested', provider: target.id, keyword }, '已请求打开购物搜索。', context)
    },
    async open_express_tracking(args, context) {
      const number = typeof args['tracking_no'] === 'string' ? args['tracking_no'].replace(/\s+/g, '') : ''
      if (number) {
        if (!/^[A-Za-z0-9]{6,32}$/.test(number)) return err('invalid_tracking_number')
        return view(trackingUri(number), undefined,
          { action: 'tracking_requested', tracking_number: number }, '已请求打开快递查询。', context)
      }
      const status = await request('packages.installed', { packageName: alipay.packageName }, context)
      if (status['ok'] !== true) return deviceResult(status, {}, '')
      return view(status['installed'] === true ? 'alipays://platformapi/startapp?appId=20000754' : 'https://m.kuaidi100.com',
        status['installed'] === true ? alipay.packageName : undefined, { action: 'tracking_home_requested' }, '已请求打开快递查询入口。', context)
    },
    async query_scenic_ticket(args, context) {
      const keyword = typeof args['keyword'] === 'string' ? args['keyword'].trim() : ''
      return installedView(keyword ? ctripTicketListUri(keyword) : ctripTicketInquireUri(), CTRIP_PACKAGE,
        { action: keyword ? 'ticket_search_requested' : 'ticket_home_requested', ...(keyword ? { keyword } : {}) }, '已请求打开景区门票页面。', context)
    },
    async join_meeting(args, context) {
      const target = meetingTarget(args)
      if ('content' in target) return target
      return installedView(target.uri, target.packageName, target.payload, target.hint, context)
    },
  }
}
