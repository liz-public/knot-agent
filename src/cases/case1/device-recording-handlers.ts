import type { DevicePort } from '../../device/port.js'
import type { ToolHandler } from './dispatcher.js'
import { deviceResult } from './device-result.js'
import { err } from './tool-result.js'

export function deviceRecordingHandlers(port: DevicePort): Readonly<Record<string, ToolHandler>> {
  return { async record_control(args, context) {
    if (!['audio', 'screen'].includes(String(args['kind']))) return err('invalid_recording_kind')
    if (!['start', 'stop', 'status'].includes(String(args['action']))) return err('invalid_recording_action')
    const seconds = Number(args['seconds'] ?? 300)
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 600) return err('invalid_duration')
    const result = await port.request(`recording.${args['action']}`, { kind: args['kind'],
      ...(args['action'] === 'start' ? { maxDurationSec: seconds } : {}) }, context)
    if (args['action'] === 'start' && result['ok'] === true && result['status'] !== 'recording') return err('recording_start_unconfirmed')
    if (args['action'] === 'stop' && result['ok'] === true && result['saved_to_media'] !== true) return err('recording_save_unconfirmed')
    return deviceResult(result, { kind: result['kind'], status: result['status'], filename: result['filename'],
      saved_to_media: result['saved_to_media'], collection: result['collection'] }, args['action'] === 'start' ? '录制已启动，可用停止命令或设备通知停止。'
      : args['action'] === 'stop' ? '录制已停止并保存。' : '已读取本会话的实际录制状态。')
  } }
}
