import type { DevicePort } from './device-port.js'
import type { ToolHandler } from './dispatcher.js'
import { deviceResult } from './device-result.js'
import { err } from './adb/json.js'

export function deviceScreenHandlers(port: DevicePort): Readonly<Record<string, ToolHandler>> {
  return {
    async take_system_screenshot(_, context) {
      const result = await port.request('screen.capture', {}, context)
      if (result['ok'] === true && result['system_capture_requested'] === true)
        return deviceResult(result, { action: 'system_screenshot_requested' }, '系统已接受截图请求，截图预览与保存由系统处理。')
      if (result['ok'] === true && result['saved_to_gallery'] !== true) return err('screenshot_save_unconfirmed')
      return deviceResult(result, { action: 'screenshot_saved', filename: result['filename'], saved_to_gallery: true }, '截图已保存到相册。')
    },
    async read_screen_content(args, context) {
      const result = await port.request('screen.text', {}, context)
      if (result['ok'] !== true) return deviceResult(result, {}, '')
      const codes = args['detect_qr'] === true ? await port.request('screen.codes', {}, context) : undefined
      if (codes && codes['ok'] !== true) return deviceResult(codes, {}, '')
      const text = typeof result['text'] === 'string' ? result['text'] : ''
      return deviceResult(result, { capture_method: 'accessibility', text, char_count: text.length,
        package_name: result['packageName'], truncated: result['truncated'],
        ...(codes ? { qr_count: codes['qr_count'], qr_codes: codes['qr_codes'] } : {}) },
      codes ? '已读取屏幕可见文字并识别二维码；二维码内容未被打开或执行。' : '已读取屏幕可见文字。')
    },
  }
}
