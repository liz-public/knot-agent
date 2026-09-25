import type { ToolHandler } from '../../dispatcher.js'
import type { AdbExecutor } from '../executor.js'
import { err, ok } from '../json.js'
import { extractScreenText } from '../screen-xml.js'

export function screenHandlers(executor: AdbExecutor): Readonly<Record<string, ToolHandler>> {
  return {
    async list_notifications(arguments_) {
      const parsedLimit = Number(arguments_['limit'] ?? 20)
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1) return err('invalid_limit')
      const limit = parsedLimit
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
  }
}
