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
import { queryCallLog } from '../src/cases/case1/adb/call-log.js'
import { parseDeviceStatusFields } from '../src/cases/case1/adb/device-status.js'
import { parseCachedLocations } from '../src/cases/case1/adb/location.js'
import { POI_TYPE_TO_CODE } from '../src/cases/case1/adb/map-geo.js'

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

test('ADB app index loads launchable apps once and returns only query matches', async () => {
  let loads = 0
  const launcherLines = [
    'packageName=com.tencent.mm',
    'packageName=com.example.notes',
  ]
  const executor: AdbExecutor = {
    async shell(command) {
      if (command.includes('pm query-activities')) {
        loads += 1
        return launcherLines.join('\n')
      }
      return ''
    },
    async shellLines(command) {
      if (command.includes('pm query-activities')) {
        loads += 1
        return launcherLines
      }
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
  const directPayload = JSON.parse(direct.content)
  assert.equal(directPayload.ok, true)
  assert.equal(directPayload.phone, undefined)
  assert.equal(approvals, 1)

  await bash.execute({ command: 'contact lookup 李行素' }, { turnId: 't2', callId: 'c2' })
  const selected = await bash.execute({ command: 'select 1' }, { turnId: 't2', callId: 'c3' })
  const selectedPayload = JSON.parse(selected.content)
  assert.equal(selectedPayload.ok, true)
  assert.equal(selectedPayload.phone, undefined)
  assert.equal(approvals, 1)
  assert.equal(commands.filter(command => command.includes('android.intent.action.CALL')).length, 2)
})

test('call.log filters by type and time scope', async () => {
  const now = 1_790_315_000_000
  const executor: AdbExecutor = {
    async shell(command) {
      if (command === 'date +%s') return String(Math.floor(now / 1000))
      if (command === 'getprop persist.sys.timezone') return 'Asia/Shanghai'
      return ''
    },
    async shellLines(command) {
      if (!command.includes('call_log/calls')) return []
      return [
        `Row: 0 number=10086, type=3, date=${now - 3_600_000}, cached_name=`,
        `Row: 1 number=10010, type=2, date=${now - 86_400_000 * 2}, cached_name=`,
      ]
    },
  }
  const result = await queryCallLog(executor, {
    type: 'missed',
    time_scope: 'today',
    limit: 10,
    groupby_ctype: false,
  })
  assert.equal(result.call_count, 1)
  assert.equal(result.calls?.[0]?.number, '10086')
})

test('device.status parses requested fields', () => {
  assert.deepEqual([...parseDeviceStatusFields('battery,storage')], ['battery', 'storage'])
  assert.equal(parseDeviceStatusFields(undefined).size, 11)
})

test('location parser prefers gps over network', () => {
  const locations = parseCachedLocations([
    'last location=Location[network 40.01,116.34 hAcc=66.2 et=+1d]',
    'last location=Location[gps 40.02,116.35 hAcc=14.2 et=+1d]',
  ].join('\n'))
  assert.equal(locations.length, 2)
  assert.equal(locations[1]?.provider, 'gps')
})

test('adb device.status respects fields argument', async () => {
  const executor = mockExecutor({
    'dumpsys battery': 'level: 88\nstatus: 2',
    'getprop ro.product.model': 'SM-F7410',
  })
  const result = await adbBash(executor).execute({ command: 'device.status battery' }, { turnId: 't1', callId: 'c1' })
  const payload = JSON.parse(result.content)
  assert.equal(payload.ok, true)
  assert.equal(payload.fields[0], 'battery')
  assert.equal(payload.battery.percent, 88)
  assert.equal(payload.device, undefined)
})

test('adb app.list without query returns capped launchable apps', async () => {
  const launcherLines = Array.from({ length: 80 }, (_, index) => `packageName=com.example.app${index}`)
  const executor: AdbExecutor = {
    async shell(command) {
      if (command.includes('pm query-activities')) return launcherLines.join('\n')
      return ''
    },
    async shellLines(command) {
      if (command.includes('pm query-activities')) return launcherLines
      return (await this.shell(command)).split('\n').filter(Boolean)
    },
  }
  const bash = adbBash(executor, createAdbDeviceSession(), { appIndex: createAdbAppIndex(executor) })
  const result = await bash.execute({ command: 'app.list --limit 20' }, { turnId: 't1', callId: 'c1' })
  const payload = JSON.parse(result.content)
  assert.equal(payload.ok, true)
  assert.equal(payload.count, 20)
  assert.equal(payload.query, undefined)
})

test('adb contact lookup returns at most five candidates', async () => {
  const rows = Array.from({ length: 8 }, (_, index) => `Row: ${index} display_name=联系人${index}, data1=1380013800${index}`)
  const executor = mockExecutor({ 'content query --uri content://com.android.contacts': rows.join('\n') })
  const result = await adbBash(executor).execute({ command: 'contact lookup 联系人' }, { turnId: 't1', callId: 'c1' })
  const payload = JSON.parse(result.content)
  assert.equal(payload.ok, true)
  assert.equal(payload.count, 5)
  assert.equal(payload.candidates.length, 5)
})

test('adb contact.delete requires approval before deleting', async () => {
  let approvals = 0
  let deleted = false
  const phone = '19900001234'
  const executor: AdbExecutor = {
    async shell(command) {
      if (command.includes('phone_lookup') && !deleted) {
        return `Row: 0 contact_id=42, display_name=测试联系人, number=${phone}`
      }
      if (command.includes('phone_lookup') && deleted) return 'No result found.'
      if (command.includes('raw_contact_id') && command.includes('contact_id=42')) {
        return 'Row: 0 raw_contact_id=99'
      }
      if (command.includes('content delete --uri content://com.android.contacts/contacts/42')) {
        deleted = true
        return ''
      }
      return ''
    },
    async shellLines(command) {
      return (await this.shell(command)).split('\n').filter(Boolean)
    },
  }
  const bash = adbBash(executor, createAdbDeviceSession(), {
    approvalPort: {
      async request(input) {
        approvals += 1
        assert.equal(input.toolName, 'contact.delete')
        return 'allow'
      },
    },
  })
  const result = await bash.execute({ command: `contact.delete ${phone}` }, { turnId: 't1', callId: 'c1' })
  const payload = JSON.parse(result.content)
  assert.equal(payload.ok, true)
  assert.equal(payload.contact_id, 42)
  assert.equal(payload.phone, undefined)
  assert.equal(approvals, 1)
  assert.equal(deleted, true)
})

test('adb map.navi returns places and select launches navigation intent', async () => {
  const commands: string[] = []
  const executor: AdbExecutor = {
    async shell(command) {
      commands.push(command)
      if (command.includes('dumpsys location')) {
        return 'last location=Location[gps 40.01,116.34 hAcc=10 et=+1d]'
      }
      return ''
    },
    async shellLines(command) {
      return (await this.shell(command)).split('\n').filter(Boolean)
    },
  }
  const session = createAdbDeviceSession()
  const mapApi = { baseUrl: 'https://map.example.test', apiKey: 'test-key' }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes('/amap/inputtips')) {
      return new Response(JSON.stringify({
        ok: true,
        tips: [
          { name: '清华大学东门', location: '116.333374,40.002041', district: '海淀区', address: '双清路' },
        ],
      }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }
  try {
    const bash = adbBash(executor, session, { mapApi })
    const listed = await bash.execute({ command: 'map.navi 清华大学东门 --type walking' }, { turnId: 't1', callId: 'c1' })
    const listPayload = JSON.parse(listed.content)
    assert.equal(listPayload.ok, true)
    assert.equal(listPayload.count, 1)
    assert.equal(listPayload.places[0].name, '清华大学东门')
    const selected = await bash.execute({ command: 'select 1' }, { turnId: 't1', callId: 'c2' })
    const selectPayload = JSON.parse(selected.content)
    assert.equal(selectPayload.ok, true)
    assert.equal(selectPayload.action, 'navigate')
    assert.equal(selectPayload.place_name, '清华大学东门')
    assert.match(commands.find(command => command.includes('am start')) ?? '', /OnFootNavi/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('adb map.navi without map api config fails clearly', async () => {
  const executor = mockExecutor({})
  const bash = adbBash(executor, createAdbDeviceSession(), { mapApi: undefined })
  const result = await bash.execute({ command: 'map.navi 机场' }, { turnId: 't1', callId: 'c1' })
  const payload = JSON.parse(result.content)
  assert.equal(payload.ok, false)
  assert.equal(payload.error, 'map_api_unconfigured')
})

test('adb map.nearby maps catalog poi_type to backend code', async () => {
  assert.equal(POI_TYPE_TO_CODE['地铁'], '150500')
  const executor: AdbExecutor = {
    async shell(command) {
      if (command.includes('dumpsys location')) {
        return 'last location=Location[gps 40.01,116.34 hAcc=10 et=+1d]'
      }
      return ''
    },
    async shellLines(command) {
      return (await this.shell(command)).split('\n').filter(Boolean)
    },
  }
  const mapApi = { baseUrl: 'https://map.example.test', apiKey: 'test-key' }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes('/amap/search_nearby') && url.includes('types=150500')) {
      return new Response(JSON.stringify({
        ok: true,
        tips: [{ name: '西直门地铁站', location: '116.355,39.94', district: '西城区' }],
      }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }
  try {
    const bash = adbBash(executor, createAdbDeviceSession(), { mapApi })
    const result = await bash.execute({ command: 'map.nearby 地铁 地铁站' }, { turnId: 't1', callId: 'c1' })
    const payload = JSON.parse(result.content)
    assert.equal(payload.ok, true)
    assert.equal(payload.poi_type, '150500')
    assert.equal(payload.places[0].name, '西直门地铁站')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('adb alarm.set dispatches SET_ALARM with skip ui', async () => {
  let seen = ''
  const executor: AdbExecutor = {
    async shell(command) {
      seen = command
      return ''
    },
    async shellLines(command) {
      return (await this.shell(command)).split('\n').filter(Boolean)
    },
  }
  const result = await adbBash(executor).execute({ command: 'alarm.set 7 30 --repeat_weekdays 1,2,3,4,5' }, { turnId: 't1', callId: 'c1' })
  const payload = JSON.parse(result.content)
  assert.equal(payload.ok, true)
  assert.equal(payload.action, 'alarm_set')
  assert.match(seen, /SET_ALARM/)
  assert.match(seen, /SKIP_UI true/)
  assert.match(seen, /--eia android\.intent\.extra\.alarm\.DAYS 2,3,4,5,6/)
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
