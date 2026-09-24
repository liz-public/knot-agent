import type { ToolHandler } from '../../dispatcher.js'
import type { AdbExecutor } from '../executor.js'
import { err, ok } from '../json.js'
import { extractScreenText } from '../screen-xml.js'

export function screenHandlers(executor: AdbExecutor): Readonly<Record<string, ToolHandler>> {
  return {
    async list_notifications(arguments_) {
      const limit = typeof arguments_['limit'] === 'number' ? Math.max(1, arguments_['limit']) : 20
      const lines = await executor.shellLines('cmd notification list')
      const notifications = lines.map(line => {
        const parts = line.split('|')
        const packageName = parts[1]
        const notificationId = parts[2]
        const tag = parts[3]
        if (packageName === undefined || notificationId === undefined) return undefined
        return {
          package_name: packageName,
          notification_id: notificationId,
          ...(tag !== undefined && tag !== 'null' && tag.length > 0 ? { tag } : {}),
        }
      }).filter((item): item is NonNullable<typeof item> => item !== undefined).slice(0, limit)
      return ok({ count: notifications.length, notifications }, '已列出通知。')
    },
    async take_system_screenshot() {
      const filename = `knot-${Date.now()}.png`
      const path = `/sdcard/Pictures/Screenshots/${filename}`
      await executor.shell(`mkdir -p /sdcard/Pictures/Screenshots && screencap -p ${path}`)
      await executor.shell(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://${path}`)
      return ok({ path, filename }, '截图已保存到相册。')
    },
    async read_screen_content(arguments_) {
      const detectQr = arguments_['detect_qr'] === true
      const path = '/sdcard/window_dump.xml'
      await executor.shell(`uiautomator dump ${path}`)
      const text = extractScreenText(await executor.shell(`cat ${path}`))
      return ok(
        { capture_method: 'uiautomator', text, char_count: text.length, ...(detectQr ? { qr_count: 0, qr_codes: [] } : {}) },
        detectQr ? '已识别屏幕文字；ADB 读屏不支持二维码识别。' : text.length === 0 ? '抓屏成功但未识别到文字。' : '已识别屏幕文字。',
      )
    },
    async scan(arguments_) {
      const provider = typeof arguments_['provider'] === 'string' ? arguments_['provider'] : 'wechat'
      if (provider === 'wechat') await executor.shell('am start -n com.tencent.mm/.ui.LauncherUI --ez LauncherUI.From.Scaner.Shortcut true')
      else if (provider === 'alipay') await executor.shell('am start -a android.intent.action.VIEW -d "alipayqr://platformapi/startapp?saId=10000007" com.eg.android.AlipayGphone')
      else if (provider === 'unionpay') await executor.shell('am start -a android.intent.action.VIEW -d "upwallet://native/scanCode" com.unionpay')
      else if (provider === 'meituan') await executor.shell('am start -a android.intent.action.VIEW -d "imeituan://www.meituan.com/scan"')
      else return err('invalid_provider')
      return ok({ provider, action: 'scan_requested' }, '已向系统发起打开扫一扫请求。')
    },
    async pay(arguments_) {
      const provider = typeof arguments_['provider'] === 'string' ? arguments_['provider'] : 'wechat'
      const receive = arguments_['receive'] === true
      if (provider === 'wechat') await executor.shell('am start -n com.tencent.mm/.ui.ShortCutDispatchActivity --es LauncherUI.Shortcut.LaunchType launch_type_offline_wallet')
      else if (provider === 'alipay') await executor.shell(`am start -a android.intent.action.VIEW -d "${receive ? 'alipays://platformapi/startapp?appId=20000123' : 'alipays://platformapi/startapp?appId=20000056'}" com.eg.android.AlipayGphone`)
      else if (provider === 'unionpay') await executor.shell('am start -a android.intent.action.VIEW -d "upwallet://native/qrcode" com.unionpay')
      else return err('invalid_provider')
      return ok({ provider, receive }, '已向系统发起打开付款/收款码请求。')
    },
    async ride(arguments_) {
      const provider = typeof arguments_['provider'] === 'string' ? arguments_['provider'] : 'alipay'
      if (provider === 'alipay') await executor.shell('am start -a android.intent.action.VIEW -d "alipayqr://platformapi/startapp?saId=200011235" com.eg.android.AlipayGphone')
      else if (provider === 'unionpay') await executor.shell('am start -a android.intent.action.VIEW -d "upwallet://native/rideCode" com.unionpay')
      else return err('invalid_provider')
      return ok({ provider, action: 'ride_requested' }, '已向系统发起打开乘车码请求。')
    },
  }
}
