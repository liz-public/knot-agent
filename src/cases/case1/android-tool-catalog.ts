import type { CliCommand } from './cli.js'
import { one, onOff, parseFlags } from './cli-arguments.js'

const command = (
  toolId: string,
  name: string,
  summary: string,
  usage: string,
  examples: readonly string[],
  keywords: readonly string[],
  parse: CliCommand['parse'],
): CliCommand => ({ toolId, name, summary, usage, examples, keywords, parse })

const empty = (usage: string) => (argv: readonly string[]) => {
  if (argv.length > 0) throw new Error(`usage: ${usage}`)
  return {}
}

export const ANDROID_TOOL_CATALOG: readonly CliCommand[] = [
  command('contact', 'contact', '通讯录查/打/增/删。', 'contact <lookup|call|add|delete> ...',
    ['contact lookup 爸爸', 'contact call 张三', 'contact add 10086 中国移动'],
    ['电话', '拨打', '联系人', '通讯录', '查号'], argv => {
      const sub = argv[0]
      if (sub === 'lookup' || sub === 'call') {
        const { positional, flags } = parseFlags(argv.slice(1))
        if (positional.length === 0) throw new Error(`usage: contact ${sub} <name> [--explicit]`)
        return { sub, query: positional.join(' '), explicit: flags.has('explicit') }
      }
      if (sub === 'add') {
        if (argv.length < 3) throw new Error('usage: contact add <phone> <name>')
        return { sub, phone: argv[1], name: argv.slice(2).join(' ') }
      }
      if (sub === 'delete') {
        const { flags } = parseFlags(argv.slice(1))
        const phone = flags.get('phone')
        const id = flags.get('id')
        return { sub, ...(typeof phone === 'string' ? { phone } : {}), ...(typeof id === 'string' ? { id } : {}) }
      }
      throw new Error('usage: contact <lookup|call|add|delete> ...')
    }),
  command('dial', 'dial', '拨打明确号码。', 'dial <number>', ['dial 10086'], ['拨号', '回拨'], argv => ({ phone: one(argv, 'dial <number>') })),
  command('select', 'select', '选择当前候选列表中的一项。', 'select <N>', ['select 1'], ['选择', '第一个', '候选', '电话', '拨打'], argv => {
    const ordinal = Number(one(argv, 'select <N>'))
    if (!Number.isInteger(ordinal) || ordinal < 1) throw new Error('usage: select <N>')
    return { ordinal }
  }),
  command('get_device_status', 'device.status', '读取设备状态。', 'device.status', ['device.status'], ['电量', '状态'], empty('device.status')),
  command('set_stream_volume', 'sys.volume', '按百分比设置或增减指定音频流音量。', 'sys.volume <percent|+N|-N> [--stream music|ring|alarm|notification]', ['sys.volume +20', 'sys.volume 50 --stream ring'], ['音量', '声音', '静音'], argv => {
    const { positional, flags } = parseFlags(argv)
    if (positional.length === 0) throw new Error('usage: sys.volume <percent> [--stream <stream>]')
    const stream = flags.get('stream')
    return { percent: positional[0], ...(typeof stream === 'string' ? { stream } : {}) }
  }),
  command('set_ringer_mode', 'sys.ringer', '设置响铃、静音或振动模式。', 'sys.ringer <normal|silent|vibrate>', ['sys.ringer silent'], ['铃声', '静音', '振动', '震动', '响铃'], argv => ({ mode: one(argv, 'sys.ringer <mode>') })),
  command('set_do_not_disturb', 'sys.dnd', '打开或关闭勿扰模式。', 'sys.dnd <on|off>', ['sys.dnd on'], ['勿扰', '免打扰'], argv => ({ enabled: onOff(argv, 'sys.dnd <on|off>') })),
  command('set_wifi_enabled', 'sys.wifi', 'WiFi 开关。', 'sys.wifi <on|off>', ['sys.wifi on'], ['WiFi', 'Wi-Fi', '无线网络'], argv => ({ enabled: onOff(argv, 'sys.wifi <on|off>') })),
  command('set_screen_brightness', 'sys.brightness', '按百分比设置或增减屏幕亮度。', 'sys.brightness <percent|+N|-N>', ['sys.brightness 60'], ['亮度', '调亮', '调暗'], argv => ({ percent: one(argv, 'sys.brightness <percent>') })),
  command('set_screen_rotation', 'sys.rotation', '设置屏幕旋转。', 'sys.rotation <auto|portrait|landscape|reverse_portrait|reverse_landscape>', ['sys.rotation auto'], ['旋转'], argv => ({ mode: one(argv, 'sys.rotation <mode>') })),
  command('media_play_pause', 'media.toggle', '播放/暂停切换。', 'media.toggle', ['media.toggle'], ['播放', '暂停'], empty('media.toggle')),
  command('list_sms_messages', 'sms.list', '列出短信。', 'sms.list [<limit>]', ['sms.list 20'], ['短信'], argv => ({ ...(argv[0] === undefined ? {} : { limit: Number(argv[0]) }) })),
  command('send_sms', 'sms.send', '打开短信编辑页。', 'sms.send --phone <num> --text <msg>', ['sms.send --phone 10086 --text hi'], ['发短信'], argv => {
    const { flags } = parseFlags(argv); const phone = flags.get('phone'); const text = flags.get('text')
    if (typeof phone !== 'string' || typeof text !== 'string') throw new Error('usage: sms.send --phone <num> --text <msg>')
    return { phone, text }
  }),
  command('list_call_history', 'call.log', '通话记录。', 'call.log [--limit N]', ['call.log'], ['通话记录', '未接'], argv => {
    const limit = parseFlags(argv).flags.get('limit'); return { ...(typeof limit === 'string' ? { limit: Number(limit) } : {}) }
  }),
  command('reject_incoming_call', 'hangup', '挂断通话。', 'hangup', ['hangup'], ['挂断'], empty('hangup')),
  command('wechat_send', 'wechat.send', '微信发文字。', 'wechat.send <text>', ['wechat.send "你好"'], ['微信'], argv => {
    if (argv.length === 0) throw new Error('usage: wechat.send <text>'); return { text: argv.join(' ') }
  }),
  command('launch_app', 'app.open', '按包名启动应用。', 'app.open <package_name>', ['app.open com.tencent.mm'], ['应用', 'App', '包名'], argv => ({ package_name: one(argv, 'app.open <package_name>') })),
  command('list_apps', 'app.list', '搜索已安装应用。', 'app.list --query <name>', ['app.list --query 微信'], ['应用列表', '安装的应用'], argv => {
    const query = parseFlags(argv).flags.get('query'); if (typeof query !== 'string') throw new Error('usage: app.list --query <name>'); return { query }
  }),
  command('open_android_uri', 'uri.open', '打开 URI。', 'uri.open <uri>', ['uri.open https://example.com'], ['链接'], argv => ({ uri: one(argv, 'uri.open <uri>') })),
  command('set_alarm_clock', 'alarm.set', '设置闹钟。', 'alarm.set <hour> [--minute N] [--label text]', ['alarm.set 7 --minute 30'], ['闹钟'], argv => {
    const hour = Number(argv[0]); if (!Number.isFinite(hour)) throw new Error('usage: alarm.set <hour> [--minute N]')
    const { flags } = parseFlags(argv.slice(1)); const minute = flags.get('minute'); const label = flags.get('label')
    return { hour, ...(typeof minute === 'string' ? { minute: Number(minute) } : {}), ...(typeof label === 'string' ? { label } : {}) }
  }),
  command('show_alarm_clocks', 'alarm.list', '打开闹钟列表。', 'alarm.list', ['alarm.list'], ['闹钟'], empty('alarm.list')),
  command('date', 'date', '日期解析。', 'date [<expr>]', ['date 明天'], ['时间', '日期'], argv => ({ ...(argv.length === 0 ? {} : { expr: argv.join(' ') }) })),
  command('ask', 'ask', '向用户提问。', 'ask "<question>" [--choices a,b]', ['ask "继续吗？" --choices 是,否'], ['询问', '确认'], argv => {
    const { positional, flags } = parseFlags(argv); if (positional.length === 0) throw new Error('usage: ask "<question>" [--choices a,b]')
    const choices = flags.get('choices'); return { question: positional.join(' '), ...(typeof choices === 'string' ? { choices: choices.split(',').map(item => item.trim()).filter(Boolean) } : {}) }
  }),
  command('list_calendar_events', 'calendar.list', '列出日程。', 'calendar.list [<days>] [--before N]', ['calendar.list 7'], ['日历', '日程'], argv => {
    const { positional, flags } = parseFlags(argv); const before = flags.get('before')
    return { ...(positional[0] === undefined ? {} : { days_ahead: Number(positional[0]) }), ...(typeof before === 'string' ? { days_before: Number(before) } : {}) }
  }),
  command('calendar_create_or_update_event', 'calendar.set', '创建/更新日程。', 'calendar.set <title> <date_expr> [--duration N] [--location text] [--id N]', ['calendar.set 团队会议 "2026-06-13 14:00"'], ['创建日程', '会议'], argv => {
    const { positional, flags } = parseFlags(argv); if (positional.length < 2) throw new Error('usage: calendar.set <title> <date_expr>')
    const duration = flags.get('duration'); const location = flags.get('location'); const id = flags.get('id')
    return { title: positional[0], date_expr: positional.slice(1).join(' '), ...(typeof duration === 'string' ? { duration_hours: Number(duration) } : {}), ...(typeof location === 'string' ? { location } : {}), ...(typeof id === 'string' ? { event_id: Number(id) } : {}) }
  }),
  command('calendar_delete_event', 'calendar.delete', '删除日程。', 'calendar.delete <event_id>', ['calendar.delete 123'], ['删除日程'], argv => {
    const event_id = Number(one(argv, 'calendar.delete <event_id>')); if (!Number.isFinite(event_id) || event_id <= 0) throw new Error('usage: calendar.delete <event_id>'); return { event_id }
  }),
  command('list_notifications', 'notif.list', '列出通知。', 'notif.list [--limit N]', ['notif.list'], ['通知'], argv => {
    const limit = parseFlags(argv).flags.get('limit'); return { ...(typeof limit === 'string' ? { limit: Number(limit) } : {}) }
  }),
  command('take_system_screenshot', 'screenshot', '截屏保存到相册。', 'screenshot', ['screenshot'], ['截图', '截屏'], empty('screenshot')),
  command('read_screen_content', 'screen.read', '读取屏幕文字。', 'screen.read [--detect_qr]', ['screen.read'], ['读屏', 'OCR'], argv => ({ ...(parseFlags(argv).flags.has('detect_qr') ? { detect_qr: true } : {}) })),
  command('scan', 'qrcode.scan', '打开扫一扫。', 'qrcode.scan [<wechat|alipay|unionpay|meituan>]', ['qrcode.scan wechat'], ['扫一扫', '扫码'], argv => ({ ...(argv[0] === undefined ? {} : { provider: argv[0] }) })),
  command('pay', 'qrcode.pay', '付款/收款码。', 'qrcode.pay [<provider>] [--receive]', ['qrcode.pay wechat'], ['付款码'], argv => {
    const { positional, flags } = parseFlags(argv); return { ...(positional[0] === undefined ? {} : { provider: positional[0] }), ...(flags.has('receive') ? { receive: true } : {}) }
  }),
  command('ride', 'qrcode.ride', '乘车码。', 'qrcode.ride [<alipay|unionpay>]', ['qrcode.ride alipay'], ['乘车码'], argv => ({ ...(argv[0] === undefined ? {} : { provider: argv[0] }) })),
  command('set_flashlight', 'flash', '打开或关闭手电筒。', 'flash <on|off>', ['flash on', 'flash off'], ['手电筒', '闪光灯'], argv => ({ on: onOff(argv, 'flash <on|off>') })),
  command('read_clipboard', 'clip.read', '读取剪贴板文本。', 'clip.read', ['clip.read'], ['剪贴板', '粘贴', '读取'], empty('clip.read')),
  command('write_clipboard', 'clip.write', '把文本写入剪贴板。', 'clip.write <text>', ['clip.write "明天下午三点开会"'], ['剪贴板', '复制', '写入'], argv => {
    if (argv.length === 0) throw new Error('usage: clip.write <text>'); return { text: argv.join(' ') }
  }),
]
