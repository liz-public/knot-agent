import type { ToolHandler } from '../../dispatcher.js'
import { parseDeviceStatusFields, readDeviceStatus, unknownDeviceStatusFields } from '../device-status.js'
import type { AdbExecutor } from '../executor.js'
import { launchAction } from '../intent-launch.js'
import { err, ok } from '../json.js'
import { readCachedLocation } from '../location.js'
import { parsePercent, shellQuote } from '../parse.js'
import { resolveSettingsPage } from '../settings-catalog.js'

const STREAM_IDS: Record<string, number> = { music: 3, ring: 2, alarm: 4, notification: 5 }
const RINGTONE_TYPES: Record<string, number> = { ring: 1, alarm: 4, notification: 2 }

export function systemHandlers(executor: AdbExecutor): Readonly<Record<string, ToolHandler>> {
  return {
    async get_device_status(arguments_) {
      const fields = parseDeviceStatusFields(arguments_['fields'])
      const unknown = unknownDeviceStatusFields(fields)
      if (unknown.length > 0) return err('unknown_fields', `未知状态字段: ${unknown.join(', ')}`)
      const status = await readDeviceStatus(executor, fields)
      return ok({ fields: [...fields], ...status }, '设备状态已读取。')
    },
    async get_location() {
      const location = await readCachedLocation(executor)
      return location === undefined
        ? err('unavailable_cached', '无缓存位置，请打开定位后重试。')
        : ok({ ...location }, '已读取最近一次缓存位置。')
    },
    async set_stream_volume(arguments_) {
      const percent = arguments_['percent']; const stream = typeof arguments_['stream'] === 'string' ? arguments_['stream'] : 'music'; const streamId = STREAM_IDS[stream]
      if (streamId === undefined || typeof percent !== 'string') return err('invalid_arguments')
      const matched = /volume is\s+(\d+)\s+in range\s+\[(\d+)\.\.(\d+)\]/i.exec(await executor.shell(`cmd media_session volume --stream ${streamId} --get`))
      const currentIndex = matched === null ? 0 : Number(matched[1]); const min = matched === null ? 0 : Number(matched[2]); const max = matched === null ? 15 : Number(matched[3])
      const current = max <= min ? 50 : Math.round((currentIndex - min) / (max - min) * 100); const target = parsePercent(percent, current); const index = Math.round(min + target / 100 * (max - min))
      await executor.shell(`cmd media_session volume --stream ${streamId} --set ${index}`)
      return ok({ stream, percent: target, stream_index: index }, '音量已调节。', { key: 'device.volume', value: { stream, percent: target } })
    },
    async set_ringer_mode(arguments_) {
      const requested = arguments_['mode']; const mode = requested === 'ring' ? 'normal' : requested
      if (mode !== 'normal' && mode !== 'silent' && mode !== 'vibrate') return err('invalid_mode')
      await executor.shell(`cmd audio set-ringer-mode ${mode === 'normal' ? 'NORMAL' : mode === 'silent' ? 'SILENT' : 'VIBRATE'}`)
      return ok({ mode }, '铃声模式已设置。', { key: 'device.ringer', value: { mode } })
    },
    async set_do_not_disturb(arguments_) {
      const enabled = arguments_['enabled'] === 'on' ? true : arguments_['enabled'] === 'off' ? false : undefined
      if (enabled === undefined) return err('invalid_enabled')
      await executor.shell(`cmd notification set_dnd ${enabled ? 'on' : 'off'}`)
      return ok({ enabled }, enabled ? '勿扰已开启。' : '勿扰已关闭。', { key: 'device.dnd', value: { enabled } })
    },
    async set_wifi_enabled(arguments_) {
      const enabled = arguments_['enabled'] === 'on' ? true : arguments_['enabled'] === 'off' ? false : undefined
      if (enabled === undefined) return err('invalid_enabled')
      await executor.shell(`cmd wifi set-wifi-enabled ${enabled ? 'enabled' : 'disabled'}`); return ok({ enabled }, `WiFi 已${enabled ? '开启' : '关闭'}。`)
    },
    async set_screen_brightness(arguments_) {
      const percent = arguments_['percent']; if (typeof percent !== 'string') return err('invalid_percent')
      const current = Math.round(Number(await executor.shell('settings get system screen_brightness')) / 255 * 100); const target = parsePercent(percent, Number.isFinite(current) ? current : 50); const level = Math.round(target / 100 * 255)
      await executor.shell(`settings put system screen_brightness ${level}`); return ok({ percent: target, level }, '亮度已调节。', { key: 'device.brightness', value: { percent: target } })
    },
    async set_screen_rotation(arguments_) {
      const mode = arguments_['mode'] ?? 'auto'; const map: Record<string, number> = { portrait: 0, landscape: 1, reverse_portrait: 2, reverse_landscape: 3 }
      if (mode === 'auto') await executor.shell('settings put system accelerometer_rotation 1')
      else if (typeof mode === 'string' && map[mode] !== undefined) { await executor.shell('settings put system accelerometer_rotation 0'); await executor.shell(`settings put system user_rotation ${map[mode]}`) }
      else return err('invalid_mode')
      return ok({ mode }, '屏幕旋转已设置。')
    },
    async media_play_pause() { await executor.shell('cmd media_session dispatch play-pause'); return ok({ action: 'media_play_pause_dispatch' }, '已派发播放/暂停键。') },

    async set_timer(arguments_) {
      const secondsRaw = arguments_['seconds']
      const message = typeof arguments_['message'] === 'string' ? arguments_['message'].trim() : ''
      if (secondsRaw === undefined || (typeof secondsRaw === 'string' && secondsRaw.trim().length === 0)) {
        const launched = await launchAction(executor, 'android.intent.action.SHOW_TIMERS')
        return launched
          ? ok({ action: 'show_timers' }, '已打开计时器页面。')
          : err('open_failed', '无法打开计时器页面。')
      }
      const seconds = Number(secondsRaw)
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 24 * 3600) return err('invalid_seconds')
      const extras = [
        `--ei android.intent.extra.alarm.LENGTH ${seconds}`,
        ...(message.length > 0 ? [`--es android.intent.extra.alarm.MESSAGE ${shellQuote(message)}`] : []),
      ]
      const launched = await launchAction(executor, 'android.intent.action.SET_TIMER', extras)
      return launched
        ? ok({ action: 'timer_set', seconds, ...(message.length > 0 ? { message } : {}) }, '已向系统发起设置计时器请求。')
        : err('open_failed', '无法打开计时器。')
    },

    async set_hotspot_enabled() {
      const page = resolveSettingsPage('hotspot')
      if (page === undefined) return err('settings_not_matched', '未匹配到热点设置页。')
      const launched = await launchAction(executor, page.action)
      return launched
        ? ok({ action: 'hotspot_settings_opened', matched_id: page.id }, '已打开热点设置页。')
        : err('open_failed', '无法打开热点设置页。')
    },

    async pick_ringtone(arguments_) {
      const type = typeof arguments_['type'] === 'string' ? arguments_['type'] : 'ring'
      const ringtoneType = RINGTONE_TYPES[type]
      if (ringtoneType === undefined) return err('invalid_type')
      const launched = await launchAction(executor, 'android.intent.action.RINGTONE_PICKER', [
        `--ei android.intent.extra.ringtone.TYPE ${ringtoneType}`,
      ])
      return launched
        ? ok({ action: 'ringtone_picker_started', type }, '已打开铃声选择器。')
        : err('open_failed', '无法打开铃声选择器。')
    },

    async show_input_method_picker() {
      const output = await executor.shell('cmd input_method show-input-method-picker')
      if (!/Error|Unknown command/i.test(output)) {
        return ok({ action: 'input_method_picker_shown' }, '已弹出输入法选择器。')
      }
      const launched = await launchAction(executor, 'android.settings.INPUT_METHOD_SETTINGS')
      return launched
        ? ok({ action: 'input_method_settings_opened' }, '已打开输入法设置页。')
        : err('open_failed', '无法弹出输入法选择器。')
    },
  }
}
