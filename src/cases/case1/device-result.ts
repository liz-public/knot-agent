import type { ToolExecution } from './tools.js'
import { err, ok } from './adb/json.js'

/** One projection of a native outcome into a business tool result. Native arguments never leak by default. */
export function deviceResult(result: Record<string, unknown>, value: Record<string, unknown>, hint: string): ToolExecution {
  if (result['ok'] === true) return ok(value, hint)
  const code = String(result['error'] ?? 'device_failed')
  if (code === 'system_access_required' && result['settings_opened'] === true) {
    const access = ({ WriteSettings: '修改系统设置', NotificationPolicy: '勿扰模式访问',
      NotificationListener: '通知使用权', Accessibility: '无障碍服务' } as Record<string, string>)[String(result['access'])]
    return err(code, `已打开${access}授权设置页。请告知用户为当前连接的助手应用开启对应授权，返回后重新请求原操作。原操作尚未执行，本轮结束，不要重试工具。`)
  }
  return err(code, code === 'device_outcome_unknown' ? '设备可能已经执行，结果尚未确认，不要自动重复执行。' : '')
}
