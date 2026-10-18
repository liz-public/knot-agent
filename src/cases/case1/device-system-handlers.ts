import type { DevicePort } from '../../device/port.js'
import type { ToolHandler } from './dispatcher.js'
import { deviceResult } from './device-result.js'
import { parseDeviceStatusFields, unknownDeviceStatusFields } from './adb/device-status.js'
import { err, ok } from './tool-result.js'

/** CLI decoding is cloud business; Android receives typed native parameters and reports observed values. */
export function deviceSystemHandlers(port: DevicePort): Readonly<Record<string, ToolHandler>> {
  const call = async (capability: string, args: Record<string, unknown>, context: Parameters<ToolHandler>[1], hint: string) => {
    const result = await port.request(capability, args, context)
    return deviceResult(result, result, hint)
  }
  const percentage = (raw: unknown) => typeof raw === 'string' && /^[+-]?\d+$/.test(raw.trim())
    ? { mode: /^[+-]/.test(raw.trim()) ? 'relative' : 'absolute', percent: Number(raw.trim()) } : undefined
  return {
    async get_device_status(args, context) {
      const fields = parseDeviceStatusFields(args['fields'])
      const sensors = [...fields].filter(field => ['lux', 'pressure_hpa', 'steps_since_boot'].includes(field))
      const standard = new Set([...fields].filter(field => !sensors.includes(field)))
      const unknown = unknownDeviceStatusFields(standard)
      if (unknown.length) return err('unknown_fields', '存在未知的设备状态字段。', { fields: unknown })
      const result = standard.size ? await port.request('device.status', { fields: [...standard] }, context) : { ok: true }
      if (result['ok'] !== true) return deviceResult(result, {}, '')
      if (sensors.length) {
        const readings = await port.request('sensors.read', { fields: sensors }, context)
        if (readings['ok'] !== true) return deviceResult(readings, {}, '')
        Object.assign(result, readings)
      }
      return ok(result, sensors.includes('steps_since_boot')
        ? '步数为设备开机以来传感器累计值，不是今日步数；不可用字段已单独标明。'
        : '已读取可用设备状态；不可用字段已单独标明。')
    },
    async set_stream_volume(args, context) {
      const value = percentage(args['percent'])
      if (!value) return err('invalid_percent')
      const stream = String(args['stream'] ?? 'music')
      if (!['music', 'ring', 'alarm', 'notification'].includes(stream)) return err('invalid_stream')
      return call('audio.volume', { ...value, stream }, context, '已调节音量，返回值为设备实际音量。')
    },
    set_ringer_mode: (args, context) => call('audio.ringer', { mode: args['mode'] === 'ring' ? 'normal' : args['mode'] }, context, '铃声模式请求已处理，返回实际模式。'),
    async set_do_not_disturb(args, context) {
      if (!['on', 'off'].includes(String(args['enabled']))) return err('invalid_enabled')
      const result = await port.request('dnd.set', { enabled: args['enabled'] === 'on' }, context)
      if (result['ok'] === true && result['applied'] !== true) return err('dnd_state_not_applied')
      return deviceResult(result, { enabled: result['enabled'] }, '已处理勿扰设置请求。')
    },
    async set_wifi_enabled(args, context) {
      if (!['on', 'off'].includes(String(args['enabled']))) return err('invalid_enabled')
      const result = await port.request('wifi.request', { enabled: args['enabled'] === 'on' }, context)
      return deviceResult(result, result, result['outcome'] === 'panel_requested'
        ? '普通App无法直接切换Wi-Fi，已请求系统面板，请用户自行设置，开关尚未改变。'
        : result['outcome'] === 'already_set' ? 'Wi-Fi当前已经是请求的状态。' : '已向系统提交Wi-Fi变更请求，尚未确认最终状态。')
    },
    async set_screen_brightness(args, context) {
      const value = percentage(args['percent'])
      return value ? call('display.brightness', value, context, '已调节亮度，返回设备实际值。') : err('invalid_percent')
    },
    set_screen_rotation: (args, context) => call('display.rotation', { mode: args['mode'] ?? 'auto' }, context, '已向系统提交旋转设置。'),
    media_play_pause: (_, context) => call('media.toggle', {}, context, '已分发播放/暂停键，是否生效取决于活跃媒体会话。'),
    read_clipboard: (_, context) => call('clipboard.read', {}, context, '已读取剪贴板。'),
    async write_clipboard(args, context) {
      if (typeof args['text'] !== 'string') return err('missing_text')
      return call('clipboard.write', { text: args['text'] }, context, '已写入剪贴板。')
    },
  }
}
