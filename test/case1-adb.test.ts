import assert from 'node:assert/strict'
import test from 'node:test'
import { ANDROID_TOOL_CATALOG } from '../src/cases/case1/android-tool-catalog.js'
import { createBashTool, createCliCatalog } from '../src/cases/case1/cli.js'
import { createAdbDispatcher, type AdbDispatcherOptions } from '../src/cases/case1/adb/dispatcher.js'
import { createAdbDeviceSession } from '../src/cases/case1/adb/session.js'
import { parseContentRows, parsePercent } from '../src/cases/case1/adb/parse.js'
import { extractScreenText } from '../src/cases/case1/adb/screen-xml.js'
import type { AdbExecutor } from '../src/cases/case1/adb/executor.js'
import { createAdbAppIndex } from '../src/cases/case1/adb/app-index.js'

function mockExecutor(responses: Record<string, string>): AdbExecutor {
  return {
    async shell(command) {
      for (const [prefix, value] of Object.entries(responses)) {
        if (command.includes(prefix)) return value
      }
      return ''
    },
    async shellLines(command) {
      const text = await this.shell(command)
      return text.split('\n').filter(Boolean)
    },
  }
}

function adbBash(
  executor: AdbExecutor,
  session = createAdbDeviceSession(),
  options: AdbDispatcherOptions = {},
) {
  return createBashTool(
    createCliCatalog(ANDROID_TOOL_CATALOG),
    createAdbDispatcher(executor, session, options),
  )
}

test('parsePercent supports absolute and relative values', () => {
  assert.equal(parsePercent('80', 50), 80)
  assert.equal(parsePercent('+20', 50), 70)
  assert.equal(parsePercent('-20', 50), 30)
})

test('parseContentRows reads adb content query output', () => {
  const rows = parseContentRows([
    'Row: 0 display_name=张三, data1=13800138000',
    'Row: 1 display_name=李四, data1=13900139000',
  ])
  assert.equal(rows.length, 2)
  assert.equal(rows[0]?.['display_name'], '张三')
})

test('adb contact lookup returns candidates without phone numbers', async () => {
  const executor = mockExecutor({
    'content query --uri content://com.android.contacts': [
      'Row: 0 display_name=李行素, data1=13800138000',
    ].join('\n'),
  })
  const result = await adbBash(executor).execute({ command: 'contact lookup 李行素' }, { turnId: 't1', callId: 'c1' })
  const payload = JSON.parse(result.content)
  assert.equal(payload.ok, true)
  assert.equal(payload.candidates[0].display_name, '李行素')
  assert.equal(payload.candidates[0].phone, undefined)
})

test('adb dial invokes CALL intent', async () => {
  let seen = ''
  const executor: AdbExecutor = {
    async shell(command) {
      seen = command
      return ''
    },
    async shellLines(command) {
      return (await this.shell(command)).split('\n')
    },
  }
  const result = await adbBash(executor).execute({ command: 'dial 10086' }, { turnId: 't1', callId: 'c1' })
  const payload = JSON.parse(result.content)
  assert.equal(payload.ok, true)
  assert.match(seen, /CALL/)
  assert.match(seen, /10086/)
})

test('adb ask returns answer through AskPort', async () => {
  const executor = mockExecutor({})
  const bash = adbBash(executor, createAdbDeviceSession(), {
    askPort: {
      async ask({ question, choices }) {
        assert.equal(question, '继续吗？')
        assert.deepEqual(choices, ['是', '否'])
        return { answer: '是' }
      },
    },
  })
  const result = await bash.execute(
    { command: 'ask "继续吗？" --choices 是,否' },
    { turnId: 't1', callId: 'c1' },
  )
  const payload = JSON.parse(result.content)
  assert.equal(payload.ok, true)
  assert.equal(payload.answer, '是')
})

test('adb ask without AskPort fails clearly', async () => {
  const result = await adbBash(mockExecutor({})).execute({ command: 'ask "hello"' }, { turnId: 't1', callId: 'c1' })
  const payload = JSON.parse(result.content)
  assert.equal(payload.ok, false)
  assert.equal(payload.error, 'no_ask_port')
})

test('extractScreenText reads uiautomator attributes', () => {
  const text = extractScreenText('<node text="设置" content-desc=""/><node text="WiFi" content-desc="无线网络"/>')
  assert.equal(text, '设置\nWiFi')
})

test('adb calendar.list filters events by day window', async () => {
  const now = Date.now()
  const inside = now + 3_600_000
  const outside = now + 40 * 86_400_000
  const executor = mockExecutor({
    'content query --uri content://com.android.calendar/events': [
      `Row: 0 _id=1, title=会, dtstart=${inside}, dtend=${inside + 3_600_000}, eventLocation=`,
      `Row: 1 _id=2, title=远, dtstart=${outside}, dtend=${outside + 3_600_000}, eventLocation=`,
    ].join('\n'),
  })
  const result = await adbBash(executor).execute({ command: 'calendar.list 1' }, { turnId: 't1', callId: 'c1' })
  const payload = JSON.parse(result.content)
  assert.equal(payload.ok, true)
  assert.equal(payload.count, 1)
  assert.equal(payload.events[0].title, '会')
})

test('adb notif.list parses cmd notification list', async () => {
  const executor = mockExecutor({
    'cmd notification list': '0|com.example.app|42|tag|null|10001',
  })
  const result = await adbBash(executor).execute({ command: 'notif.list' }, { turnId: 't1', callId: 'c1' })
  const payload = JSON.parse(result.content)
  assert.equal(payload.ok, true)
  assert.equal(payload.notifications[0].package_name, 'com.example.app')
})

test('adb media.toggle dispatches play-pause', async () => {
  let seen = ''
  const executor: AdbExecutor = {
    async shell(command) {
      seen = command
      return ''
    },
    async shellLines(command) {
      return (await this.shell(command)).split('\n')
    },
  }
  await adbBash(executor).execute({ command: 'media.toggle' }, { turnId: 't1', callId: 'c1' })
  assert.match(seen, /dispatch play-pause/)
})

test('ADB app index loads once and returns only query matches', async () => {
  let loads = 0
  const executor: AdbExecutor = {
    async shell(command) {
      if (command === 'pm list packages') {
        loads += 1
        return 'package:com.tencent.mm\npackage:com.example.notes'
      }
      return ''
    },
    async shellLines(command) {
      return (await this.shell(command)).split('\n').filter(Boolean)
    },
  }
  const index = createAdbAppIndex(executor)
  assert.deepEqual(await index.match('微信'), [{ label: '微信', packageName: 'com.tencent.mm' }])
  assert.deepEqual(await index.search('notes'), [{ label: 'com.example.notes', packageName: 'com.example.notes' }])
  assert.equal(loads, 1)
})

test('ADB direct contact call asks once, while select confirms the prior user choice', async () => {
  let approvals = 0
  const commands: string[] = []
  const executor: AdbExecutor = {
    async shell(command) {
      commands.push(command)
      if (command.includes('content://com.android.contacts')) {
        return 'Row: 0 display_name=李行素, data1=13800138000'
      }
      return ''
    },
    async shellLines(command) {
      return (await this.shell(command)).split('\n').filter(Boolean)
    },
  }
  const bash = adbBash(executor, createAdbDeviceSession(), {
    approvalPort: {
      async request() {
        approvals += 1
        return 'allow'
      },
    },
  })

  const direct = await bash.execute({ command: 'contact call 李行素' }, { turnId: 't1', callId: 'c1' })
  assert.equal(JSON.parse(direct.content).ok, true)
  assert.equal(approvals, 1)

  await bash.execute({ command: 'contact lookup 李行素' }, { turnId: 't2', callId: 'c2' })
  const selected = await bash.execute({ command: 'select 1' }, { turnId: 't2', callId: 'c3' })
  assert.equal(JSON.parse(selected.content).ok, true)
  assert.equal(approvals, 1)
  assert.equal(commands.filter(command => command.includes('android.intent.action.CALL')).length, 2)
})

test('ADB relative volume uses the reported current index and range', async () => {
  const commands: string[] = []
  const executor: AdbExecutor = {
    async shell(command) {
      commands.push(command)
      if (command.includes('--get')) return '[V] volume is 6 in range [0..15]'
      return ''
    },
    async shellLines(command) {
      return (await this.shell(command)).split('\n').filter(Boolean)
    },
  }
  const result = await adbBash(executor).execute({ command: 'sys.volume +20' }, { turnId: 't1', callId: 'c1' })
  assert.equal(JSON.parse(result.content).stream_index, 9)
  assert.ok(commands.some(command => command.includes('--set 9')))
})
