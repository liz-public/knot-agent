import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createPersistentCase1Agent } from '../dist/src/cases/case1/case1.js'
import { openAiLlmPlugin } from '../dist/src/cases/case1/llm-openai.js'
import { createAdbCase1ToolRuntime } from '../dist/src/cases/case1/tool-runtimes.js'

const required = name => {
  const value = process.env[name]?.trim()
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`)
  return value
}

const optionalJson = (value, name) => {
  if (value === undefined) return undefined
  const parsed = JSON.parse(value)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object`)
  }
  return parsed
}

const cases = [
  { id: 'device-status', query: '查看当前手机的电量和存储设备状态', expected: ['device.status'] },
  { id: 'contact-add', query: '保存联系人，号码 10000000001，姓名 Knot冒烟联系人', expected: ['contact.add'] },
  { id: 'app-list', query: '查看应用列表里有没有微信', expected: ['app.list'] },
  { id: 'contact-call', query: '给李哲打电话', expected: ['contact'] },
  { id: 'contact-select', query: '选第一个', expected: ['select'] },
  { id: 'contact-hangup', query: '挂断电话', expected: ['hangup'] },
  { id: 'dial', query: '直接拨号 10086', expected: ['dial'] },
  { id: 'dial-hangup', query: '挂断电话', expected: ['hangup'] },
  { id: 'call-log', query: '查看今天的未接通话记录', expected: ['call.log'] },
  { id: 'date', query: '明天是星期几', expected: ['date'] },
  { id: 'sms-list', query: '列出最近 10 条短信', expected: ['sms.list'] },
  { id: 'qr-scan', query: '打开微信扫一扫', expected: ['qrcode.scan'] },
  { id: 'sms-send', query: '给 10086 发短信：Knot 冒烟测试', expected: ['sms.send'] },
  { id: 'volume-up', query: '把媒体音量调大 10%', expected: ['sys.volume'] },
  { id: 'weather', query: '查一下北京天气和气温', expected: ['weather'] },
  { id: 'volume-down', query: '把媒体音量调小 10%', expected: ['sys.volume'] },
  { id: 'ringer-vibrate', query: '把手机改成振动模式', expected: ['sys.ringer'] },
  { id: 'app-open', query: '打开应用微信', expected: ['app.open'] },
  { id: 'ringer-ring', query: '把手机恢复成响铃模式', expected: ['sys.ringer'] },
  { id: 'dnd-on', query: '打开勿扰模式', expected: ['sys.dnd'] },
  { id: 'notifications', query: '查看最近 20 条通知', expected: ['notif.list'] },
  { id: 'dnd-off', query: '关闭勿扰模式', expected: ['sys.dnd'] },
  { id: 'wifi-on', query: '确保 WiFi 无线网络处于开启状态', expected: ['sys.wifi'] },
  { id: 'map-navi', query: '导航去清华大学东门', expected: ['map.navi'] },
  { id: 'map-navi-select', query: '选第一个', expected: ['select'] },
  { id: 'uri-open', query: '打开网页链接 https://www.baidu.com', expected: ['uri.open'] },
  { id: 'map-route', query: '规划步行去北京大学东门的路线', expected: ['map.route'] },
  { id: 'map-route-select', query: '选第一个', expected: ['select'] },
  { id: 'qr-pay', query: '打开支付宝付款码', expected: ['qrcode.pay'] },
  { id: 'map-nearby', query: '查找附近的地铁站', expected: ['map.nearby'] },
  { id: 'map-nearby-select', query: '选第一个', expected: ['select'] },
  { id: 'screen-read', query: '读屏，读取当前屏幕上显示的文字', expected: ['screen.read'] },
  { id: 'brightness-up', query: '把屏幕亮度调亮 10%', expected: ['sys.brightness'] },
  { id: 'appstore', query: '下载知乎', expected: ['appstore.search'] },
  { id: 'brightness-down', query: '把屏幕亮度调暗 10%', expected: ['sys.brightness'] },
  { id: 'rotation-landscape', query: '把屏幕旋转到横屏', expected: ['sys.rotation'] },
  { id: 'qr-ride', query: '打开支付宝乘车码', expected: ['qrcode.ride'] },
  { id: 'rotation-auto', query: '恢复屏幕自动旋转', expected: ['sys.rotation'] },
  { id: 'media-toggle-1', query: '切换一次媒体播放暂停状态', expected: ['media.toggle'] },
  { id: 'alarm-set', query: '设置一个明早 7 点 30 分的闹钟', expected: ['alarm.set'] },
  { id: 'food', query: '打开美食应用，用美团搜索火锅', expected: ['food.explore'] },
  { id: 'alarm-list', query: '打开闹钟列表', expected: ['alarm.list'] },
  { id: 'shopping', query: '购物搜索 iPhone，使用京东', expected: ['shopping.search'] },
  { id: 'timer', query: '打开计时器页面', expected: ['timer'] },
  { id: 'hotspot', query: '打开热点设置', expected: ['hotspot'] },
  { id: 'ringtone', query: '打开闹钟铃声选择器', expected: ['ringtone'] },
  { id: 'ime', query: '弹出输入法选择器', expected: ['ime'] },
  { id: 'settings', query: '打开蓝牙设置', expected: ['sys.settings.open'] },
  { id: 'express', query: '查快递 SF1234567890', expected: ['express'] },
  { id: 'meeting', query: '加入腾讯会议 927318171', expected: ['meeting.join'] },
  { id: 'ticket', query: '用携程搜索故宫门票', expected: ['ticket.query'] },
  { id: 'content-search', query: '用抖音搜索周杰伦', expected: ['content.search'] },
  { id: 'screenshot', query: '截图并保存到相册', expected: ['screenshot'] },
  { id: 'location', query: '查看我现在的定位在哪', expected: ['location'] },
  { id: 'calendar-set', query: '创建一个会议提醒：明天晚上 11 点，标题是 Knot冒烟日程', expected: ['calendar.set'] },
  { id: 'wechat-send', query: '微信发消息，文字是“Knot CASE1 冒烟测试”', expected: ['wechat.send'] },
  { id: 'calendar-list', query: '列出未来两天的日程', expected: ['calendar.list'] },
  { id: 'calendar-delete', query: '删除刚才创建的 Knot冒烟日程', expected: ['calendar.delete'] },
  { id: 'contact-delete', query: '删除联系人，号码 10000000001', expected: ['contact.delete'] },
  { id: 'media-toggle-2', query: '再切换一次媒体播放暂停状态', expected: ['media.toggle'] },
  { id: 'unsupported-flash', query: '打开手电筒', expected: ['flash'], expectedError: 'unsupported_tool' },
  { id: 'unsupported-clip-write', query: '把“Knot冒烟测试”复制到剪贴板', expected: ['clip.write'], expectedError: 'unsupported_tool' },
  { id: 'unsupported-clip-read', query: '读取剪贴板内容', expected: ['clip.read'], expectedError: 'unsupported_tool' },
  { id: 'unsupported-flight', query: '查询明天去上海的机票', expected: ['flight.query'], expectedError: 'unsupported_tool' },
  { id: 'unsupported-hotel', query: '查询明天上海的酒店', expected: ['hotel.query'], expectedError: 'unsupported_tool' },
  { id: 'unsupported-train', query: '查询明天去上海的火车票', expected: ['train.query'], expectedError: 'unsupported_tool' },
]

const baseUrl = required('KNOT_BASE_URL')
const model = required('KNOT_MODEL')
const apiKey = required('KNOT_API_KEY')
const serial = required('ADB_SERIAL')
const contextWindow = Number(process.env.KNOT_CONTEXT_WINDOW ?? '32768')
if (!Number.isFinite(contextWindow) || contextWindow <= 0) throw new Error('KNOT_CONTEXT_WINDOW must be positive')

const runDirectory = resolve(process.env.KNOT_SMOKE_DIR ?? `.local/case1-adb-smoke/${new Date().toISOString().replaceAll(':', '-')}`)
const journalPath = resolve(process.env.KNOT_JOURNAL_PATH ?? `${runDirectory}/session.jsonl`)
const reportPath = `${runDirectory}/smoke-report.json`
await mkdir(dirname(journalPath), { recursive: true })

const runtime = createAdbCase1ToolRuntime({
  serial,
  approvalPort: { async request() { return 'allow' } },
})
const report = []
let currentReply = ''
const agent = await createPersistentCase1Agent({
  journalPath,
  llm: openAiLlmPlugin({
    baseUrl,
    model,
    apiKey,
    contextWindow,
    extraBody: optionalJson(process.env.KNOT_REQUEST_EXTRA_JSON, 'KNOT_REQUEST_EXTRA_JSON'),
  }),
  dispatcher: runtime.dispatcher,
  appMatcher: runtime.appMatcher,
  output: {
    content(content) {
      currentReply = content
      process.stdout.write(`assistant> ${content.replaceAll('\n', ' ')}\n`)
    },
  },
})

function commandNames(events) {
  const result = []
  for (const event of events) {
    if (event.type !== 'tool.call') continue
    for (const call of event.data.calls ?? []) {
      if (call.name !== 'bash' || typeof call.arguments?.command !== 'string') continue
      result.push(call.arguments.command.trim().split(/\s+/)[0])
    }
  }
  return result
}

function toolErrors(events) {
  const result = []
  for (const event of events) {
    if (event.type !== 'tool.result') continue
    for (const item of event.data.results ?? []) {
      try {
        const body = JSON.parse(item.content)
        if (body?.ok === false && typeof body.error === 'string') result.push(body.error)
      } catch {}
    }
  }
  return result
}

process.stdout.write(`CASE1 ADB smoke: ${cases.length} turns, journal ${journalPath}\n`)
await agent.start()
for (let index = 0; index < cases.length; index += 1) {
  const test = cases[index]
  const before = agent.journal.read().length
  const startedAt = Date.now()
  currentReply = ''
  process.stdout.write(`\n[${index + 1}/${cases.length}] ${test.id}\nyou> ${test.query}\n`)
  let thrown
  try {
    await agent.submit(test.query)
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error)
    process.stderr.write(`turn error: ${thrown}\n`)
  }
  const events = agent.journal.read().slice(before)
  const commands = commandNames(events)
  const errors = toolErrors(events)
  report.push({
    id: test.id,
    query: test.query,
    expected: test.expected,
    ...(test.expectedError === undefined ? {} : { expectedError: test.expectedError }),
    commands,
    errors,
    reply: currentReply,
    durationMs: Date.now() - startedAt,
    ...(thrown === undefined ? {} : { thrown }),
  })
  process.stdout.write(`observed commands: ${commands.join(', ') || '(none)'}; errors: ${errors.join(', ') || '(none)'}\n`)
  await writeFile(reportPath, `${JSON.stringify({ model, serial, journalPath, cases: report }, null, 2)}\n`)
  if (index + 1 < cases.length) await delay(5_000)
}

const missed = report.filter(item => !item.expected.every(expected => item.commands.includes(expected)))
const unexpectedThrows = report.filter(item => item.thrown !== undefined)
const errorMismatches = report.filter(item => item.expectedError !== undefined && !item.errors.includes(item.expectedError))
const summary = {
  turns: report.length,
  matchedExpectedCommands: report.length - missed.length,
  missed: missed.map(item => ({ id: item.id, expected: item.expected, commands: item.commands })),
  unexpectedThrows: unexpectedThrows.map(item => ({ id: item.id, thrown: item.thrown })),
  errorMismatches: errorMismatches.map(item => ({ id: item.id, expectedError: item.expectedError, errors: item.errors })),
  journalPath,
  reportPath,
}
await writeFile(reportPath, `${JSON.stringify({ model, serial, journalPath, cases: report, summary }, null, 2)}\n`)
process.stdout.write(`\n${JSON.stringify(summary, null, 2)}\n`)
