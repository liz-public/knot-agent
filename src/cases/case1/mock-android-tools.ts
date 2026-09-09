import type { AndroidDeviceSession, ToolDefinition, ToolExecution } from './tools.js'

type JsonProperties = Record<string, Record<string, unknown>>

const ok = (
  data: Record<string, unknown>,
  hint: string,
  state?: ToolExecution['state'],
): ToolExecution => ({
  content: JSON.stringify({ ok: true, ...data, hint }),
  ...(state === undefined ? {} : { state }),
})

const err = (error: string, hint = ''): ToolExecution => ({
  content: JSON.stringify({ ok: false, error, hint }),
})

function tool(
  name: string,
  description: string,
  properties: JsonProperties,
  required: readonly string[],
  execute: ToolDefinition['execute'],
): ToolDefinition {
  return {
    name,
    schema: {
      type: 'function',
      function: {
        name,
        description,
        parameters: { type: 'object', properties, required, additionalProperties: false },
      },
    },
    execute,
  }
}

function booleanArgument(arguments_: Record<string, unknown>, name: string): boolean | undefined {
  const value = arguments_[name]
  return typeof value === 'boolean' ? value : undefined
}

function percentage(raw: unknown, current: number): { value: number; adjust?: number } | undefined {
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined
  const text = raw.trim()
  if (!/^[+-]?\d+$/.test(text)) return undefined
  const value = Number(text.replace(/^[+-]/, ''))
  if (!Number.isFinite(value)) return undefined
  if (text.startsWith('+')) return { value: Math.min(100, current + value), adjust: value }
  if (text.startsWith('-')) return { value: Math.max(0, current - value), adjust: -value }
  return { value: Math.max(0, Math.min(100, value)) }
}

export function mockAndroidSystemTools(session: AndroidDeviceSession): readonly ToolDefinition[] {
  return [
    tool(
      'set_flashlight',
      '开/关后置闪光灯（手电筒）。参数 on=true 打开，false 关闭。',
      { on: { type: 'boolean', description: 'on 或 off' } },
      ['on'],
      arguments_ => {
        const on = booleanArgument(arguments_, 'on')
        if (on === undefined) return err('invalid_on', 'on 必须是 boolean。')
        session.flashlightOn = on
        return ok(
          { on, camera_id: '0' },
          '闪光灯已切换。一句话告知用户。若是周期闪烁任务，请在同一轮继续下发 flash + wait 组合。',
          { key: 'device.flashlight', value: { on } },
        )
      },
    ),
    tool(
      'set_ringer_mode',
      '设置铃声模式。normal=响铃，silent=静音，vibrate=振动。',
      { mode: { type: 'string', enum: ['normal', 'silent', 'vibrate'] } },
      ['mode'],
      arguments_ => {
        const mode = arguments_['mode']
        if (mode !== 'normal' && mode !== 'silent' && mode !== 'vibrate') {
          return err('invalid_mode', 'mode 无效。请使用 normal、silent 或 vibrate。')
        }
        session.ringerMode = mode
        return ok(
          { requested_mode: mode, actual_mode: mode, dnd_active: session.doNotDisturb },
          '铃声模式已设置。一句话告知。',
          { key: 'device.ringer', value: { mode } },
        )
      },
    ),
    tool(
      'set_do_not_disturb',
      '开关系统勿扰模式。enabled=true 开启，false 关闭。',
      { enabled: { type: 'boolean', description: '是否开启勿扰' } },
      ['enabled'],
      arguments_ => {
        const enabled = booleanArgument(arguments_, 'enabled')
        if (enabled === undefined) return err('invalid_enabled', 'enabled 必须是 boolean。')
        session.doNotDisturb = enabled
        return ok(
          { dnd_active: enabled, interruption_filter: enabled ? 2 : 1 },
          enabled ? '勿扰已开启。' : '勿扰已关闭。',
          { key: 'device.dnd', value: { enabled } },
        )
      },
    ),
    tool(
      'set_stream_volume',
      '调节音量。percent 为绝对百分比或 +N/-N；stream 默认 music。',
      {
        percent: { type: 'string', description: '音量百分比：80、+20 或 -10' },
        stream: { type: 'string', enum: ['music', 'ring', 'alarm', 'notification'] },
      },
      ['percent'],
      arguments_ => {
        const stream = arguments_['stream'] ?? 'music'
        if (stream !== 'music' && stream !== 'ring' && stream !== 'alarm' && stream !== 'notification') {
          return err('invalid_stream')
        }
        const target = percentage(arguments_['percent'], session.volumes[stream])
        if (target === undefined) return err('invalid_percent', '传入的不是有效百分比。')
        session.volumes[stream] = target.value
        const max = 15
        return ok(
          {
            stream,
            level: Math.floor(max * target.value / 100),
            max,
            percent: target.value,
            ...(target.adjust === undefined ? {} : { adjust_percent: target.adjust }),
          },
          '音量已调节（已弹出系统音量条）。一句话告知。',
          { key: `device.volume.${stream}`, value: { percent: target.value } },
        )
      },
    ),
    tool(
      'set_wifi_enabled',
      '打开 WiFi 系统面板，供用户开启或关闭 WiFi。',
      { enabled: { type: 'boolean', description: '期望的 WiFi 开关状态' } },
      ['enabled'],
      arguments_ => booleanArgument(arguments_, 'enabled') === undefined
        ? err('invalid_enabled', 'enabled 必须是 boolean。')
        : ok({ action: 'opened_wifi_panel' }, '已打开 WiFi 系统面板。请用户在面板中操作。'),
    ),
    tool(
      'set_screen_brightness',
      '调节屏幕亮度。percent 为绝对百分比或 +N/-N。',
      { percent: { type: 'string', description: '亮度百分比：80、+20 或 -10' } },
      ['percent'],
      arguments_ => {
        const target = percentage(arguments_['percent'], session.brightnessPercent)
        if (target === undefined) return err('invalid_percent', '传入的不是有效百分比。')
        const value = Math.max(1, target.value)
        session.brightnessPercent = value
        return ok(
          {
            brightness_percent: value,
            brightness_raw_0_255: Math.floor(value * 255 / 100),
            ...(target.adjust === undefined ? {} : { adjust_percent: target.adjust }),
          },
          '亮度已调节。一句话告知。',
          { key: 'device.brightness', value: { percent: value } },
        )
      },
    ),
    tool(
      'read_clipboard',
      '读取系统剪贴板中的纯文本。',
      {},
      [],
      () => session.clipboardText === undefined || session.clipboardText.length === 0
        ? err('clipboard_empty', '剪贴板为空或无法读取。提示用户先复制内容并确保助手在前台。')
        : ok(
          { text: session.clipboardText, char_count: session.clipboardText.length },
          '已读取剪贴板内容。基于该内容继续处理用户请求。',
        ),
    ),
    tool(
      'write_clipboard',
      '将纯文本写入系统剪贴板，最多 16000 字符。',
      { text: { type: 'string', description: '要写入剪贴板的纯文本' } },
      ['text'],
      arguments_ => {
        const input = arguments_['text']
        if (typeof input !== 'string' || input.trim().length === 0) {
          return err('empty_text', '文本为空。提示用户提供要复制的内容。')
        }
        const text = input.trim()
        if (text.length > 16_000) {
          return {
            content: JSON.stringify({
              ok: false,
              error: 'text_too_long',
              max_chars: 16_000,
              actual_chars: text.length,
              hint: '文本超过 16000 字符上限。告知用户需缩短内容。',
            }),
          }
        }
        session.clipboardText = text
        return ok(
          { char_count: session.clipboardText.length },
          '已写入剪贴板。一句话告知用户即可。',
          { key: 'device.clipboard', value: { charCount: session.clipboardText.length } },
        )
      },
    ),
  ]
}
