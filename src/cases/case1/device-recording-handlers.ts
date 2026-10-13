import type { DevicePort } from './device-port.js'
import type { CliCommand } from './cli.js'
import type { ToolHandler } from './dispatcher.js'
import { deviceResult } from './device-result.js'
import { err } from './adb/json.js'

export const DEVICE_RECORDING_COMMAND: CliCommand = {
  name: 'record', toolId: 'record_control', summary: '设备录音/录屏开始或停止',
  description: '录音或录屏。开始后由设备前台服务持续录制，最长600秒；停止后保存文件。录屏每次须系统授权，录画面和麦克风，不捕获系统内部声音。不以聊天停止生成替代停止录制。',
  keywords: ['录音', '录屏', '录制', 'record'],
  examples: ['record audio start', 'record audio stop', 'record screen start --seconds 60', 'record screen stop'],
  arguments: [
    { name: 'kind', format: 'positional', type: 'enum', values: ['audio', 'screen'], required: true, description: '录制种类。' },
    { name: 'action', format: 'positional', type: 'enum', values: ['start', 'stop', 'status'], required: true, description: '开始、停止或查询本会话录制状态。' },
    { name: 'seconds', format: 'flag', type: 'text', required: false, description: '最长录制秒数，1到600，默认300，仅开始使用。' },
  ],
}
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
