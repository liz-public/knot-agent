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

test('call.log incoming excludes rejected and blocked calls', async () => {
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
        `Row: 0 number=10001, type=1, date=${now - 1_000}, cached_name=`,
        `Row: 1 number=10002, type=5, date=${now - 2_000}, cached_name=`,
        `Row: 2 number=10003, type=6, date=${now - 3_000}, cached_name=`,
      ]
    },
  }
  const result = await queryCallLog(executor, {
    type: 'incoming',
    time_scope: 'today',
    limit: 10,
    groupby_ctype: false,
  })
  assert.equal(result.call_count, 1)
  assert.equal(result.calls?.[0]?.number, '10001')
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

test('adb device.status rejects unknown fields', async () => {
  const result = await adbBash(mockExecutor({})).execute(
    { command: 'device.status battery,banana' },
    { turnId: 't1', callId: 'c1' },
  )
  const payload = JSON.parse(result.content)
  assert.equal(payload.ok, false)
  assert.equal(payload.error, 'unknown_fields')
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
    assert.deepEqual(listed.state?.value, {
      kind: 'map_navi',
      places: [{ ordinal_1based: 1, name: '清华大学东门' }],
    })
    assert.equal(JSON.stringify(listed.state).includes('116.333374'), false)
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

test('adb map selection keeps pending state when place payload is invalid', async () => {
  const executor = mockExecutor({ 'dumpsys location': '' })
  const session = createAdbDeviceSession()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: true,
    tips: [{ name: '无坐标地点', location: '' }],
  }), { status: 200 })
  try {
    const bash = adbBash(executor, session, { mapApi: { baseUrl: 'https://map.example.test', apiKey: 'test-key' } })
    await bash.execute({ command: 'map.navi 无坐标地点' }, { turnId: 't1', callId: 'c1' })
    const selected = await bash.execute({ command: 'select 1' }, { turnId: 't1', callId: 'c2' })
    assert.equal(JSON.parse(selected.content).error, 'bad_payload')
    assert.equal(session.pending?.kind, 'map_navi')
  } finally {
    globalThis.fetch = originalFetch
  }
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
    assert.equal(payload.poi_type, '地铁')
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

test('adb appstore.search uses Samsung Galaxy Store when installed', async () => {
  let seen = ''
  const executor: AdbExecutor = {
    async shell(command) {
      seen = command
      if (command.startsWith('pm list packages')) {
        return 'package:com.sec.android.app.samsungapps'
      }
      return 'Starting: Intent { act=android.intent.action.VIEW dat=samsungapps://SearchResult/... }'
    },
    async shellLines(command) {
      return (await this.shell(command)).split('\n').filter(Boolean)
    },
  }
  const result = await adbBash(executor).execute({ command: 'appstore.search 知乎' }, { turnId: 't1', callId: 'c1' })
  const payload = JSON.parse(result.content)
  assert.equal(payload.ok, true)
  assert.equal(payload.action, 'store_search')
  assert.equal(payload.store, 'samsung')
  assert.match(seen, /samsungapps:\/\/SearchResult\//)
  assert.match(seen, /-p com\.sec\.android\.app\.samsungapps/)
})

test('adb appstore.search falls back to market when Galaxy Store missing', async () => {
  let seen = ''
  const executor: AdbExecutor = {
    async shell(command) {
      seen = command
      if (command.startsWith('pm list packages')) return ''
      return 'Starting: Intent { act=android.intent.action.VIEW dat=market://search/... }'
    },
    async shellLines(command) {
      return (await this.shell(command)).split('\n').filter(Boolean)
    },
  }
  const result = await adbBash(executor).execute({ command: 'appstore.search 知乎' }, { turnId: 't1', callId: 'c1' })
  const payload = JSON.parse(result.content)
  assert.equal(payload.ok, true)
  assert.equal(payload.action, 'store_search')
  assert.equal(payload.store, 'market')
  assert.match(seen, /market:\/\/search\?q=/)
})

test('adb content.search returns app_not_installed for missing provider app', async () => {
  const executor = mockExecutor({
    'pm list packages': '',
  })
  const result = await adbBash(executor).execute(
    { command: 'content.search 火锅 --provider douyin' },
    { turnId: 't1', callId: 'c1' },
  )
  const payload = JSON.parse(result.content)
  assert.equal(payload.ok, false)
  assert.equal(payload.error, 'app_not_installed')
  assert.equal(payload.provider, 'douyin')
})

test('adb content.search opens the required installed provider', async () => {
  let seen = ''
  const executor: AdbExecutor = {
    async shell(command) {
      if (command.startsWith('pm list packages')) return 'package:com.zhihu.android'
      seen = command
      return 'Starting: Intent { act=android.intent.action.VIEW dat=zhihu://search/... }'
    },
    async shellLines(command) {
      return (await this.shell(command)).split('\n').filter(Boolean)
    },
  }
  const result = await adbBash(executor).execute(
    { command: 'content.search AI --provider zhihu' },
    { turnId: 't1', callId: 'c1' },
  )
  const payload = JSON.parse(result.content)
  assert.equal(payload.ok, true)
  assert.equal(payload.provider, 'zhihu')
  assert.match(seen, /zhihu:\/\/search/)
})

test('adb content.search rejects a missing required provider before dispatch', async () => {
  const result = await adbBash(mockExecutor({})).execute(
    { command: 'content.search AI' },
    { turnId: 't1', callId: 'c1' },
  )
  const payload = JSON.parse(result.content)
  assert.equal(payload.ok, false)
  assert.equal(payload.error, 'bad_arguments')
})

test('ADB launch treats an intent delivered to the running activity as success', async () => {
  const executor = mockExecutor({
    'pm list packages com.sec.android.app.samsungapps': 'package:com.sec.android.app.samsungapps',
    'am start': 'Warning: Activity not started, intent has been delivered to currently running top-most instance.',
  })
  const result = await adbBash(executor).execute(
    { command: 'appstore.search 知乎' },
    { turnId: 't1', callId: 'c1' },
  )
  assert.equal(JSON.parse(result.content).ok, true)
})

test('ADB launch reports an explicit activity resolution failure', async () => {
  const executor = mockExecutor({
    'pm list packages com.sec.android.app.samsungapps': 'package:com.sec.android.app.samsungapps',
    'am start': 'Error type 3\nError: Activity class does not exist.',
  })
  const result = await adbBash(executor).execute(
    { command: 'appstore.search 知乎' },
    { turnId: 't1', callId: 'c1' },
  )
  assert.equal(JSON.parse(result.content).error, 'open_failed')
})

test('adb settings executes only exact ids or aliases', async () => {
  const commands: string[] = []
  const executor: AdbExecutor = {
    async shell(command) {
      commands.push(command)
      return 'Starting: Intent'
    },
    async shellLines(command) { return (await this.shell(command)).split('\n').filter(Boolean) },
  }
  const bash = adbBash(executor)
  const matched = await bash.execute({ command: 'sys.settings.open wifi' }, { turnId: 't1', callId: 'c1' })
  const unmatched = await bash.execute({ command: 'sys.settings.open 系统升级' }, { turnId: 't2', callId: 'c2' })
  assert.equal(JSON.parse(matched.content).matched_id, 'wifi')
  assert.equal(JSON.parse(unmatched.content).error, 'settings_not_matched')
  assert.equal(commands.filter(command => command.includes('am start')).length, 1)
})

test('optional food and shopping providers fall back in declared order without duplicate package probes', async () => {
  const commands: string[] = []
  const executor: AdbExecutor = {
    async shell(command) {
      commands.push(command)
      if (command === 'pm list packages') {
        return ['package:com.dianping.v1', 'package:com.sankuai.meituan', 'package:com.jingdong.app.mall', 'package:com.xunmeng.pinduoduo'].join('\n')
      }
      return 'Starting: Intent'
    },
    async shellLines(command) { return (await this.shell(command)).split('\n').filter(Boolean) },
  }
  const bash = adbBash(executor)
  const food = await bash.execute({ command: 'food.explore 火锅' }, { turnId: 't1', callId: 'c1' })
  const shopping = await bash.execute({ command: 'shopping.search 手机' }, { turnId: 't2', callId: 'c2' })
  assert.equal(JSON.parse(food.content).provider, 'dianping')
  assert.equal(JSON.parse(shopping.content).provider, 'jd')
  assert.equal(commands.filter(command => command === 'pm list packages').length, 2)
  assert.equal(commands.some(command => command.startsWith('pm list packages ')), false)
})

test('optional QR providers fall back to the first installed compatible app', async () => {
  const executor = mockExecutor({
    'pm list packages': 'package:com.unionpay',
    'am start': 'Starting: Intent',
  })
  const bash = adbBash(executor)
  const scan = await bash.execute({ command: 'qrcode.scan' }, { turnId: 't1', callId: 'c1' })
  const pay = await bash.execute({ command: 'qrcode.pay' }, { turnId: 't2', callId: 'c2' })
  const ride = await bash.execute({ command: 'qrcode.ride' }, { turnId: 't3', callId: 'c3' })
  assert.equal(JSON.parse(scan.content).provider, 'unionpay')
  assert.equal(JSON.parse(pay.content).provider, 'unionpay')
  assert.equal(JSON.parse(ride.content).provider, 'unionpay')
})

test('optional QR provider reports when no compatible app is installed', async () => {
  const result = await adbBash(mockExecutor({ 'pm list packages': '' })).execute(
    { command: 'qrcode.pay' },
    { turnId: 't1', callId: 'c1' },
  )
  assert.equal(JSON.parse(result.content).error, 'app_not_installed')
})

test('explicit optional provider fails when its app is not installed', async () => {
  const result = await adbBash(mockExecutor({ 'pm list packages': 'package:com.dianping.v1' })).execute(
    { command: 'food.explore 火锅 --provider meituan' },
    { turnId: 't1', callId: 'c1' },
  )
  assert.equal(JSON.parse(result.content).error, 'app_not_installed')
})

test('adb express checks Alipay once before opening its express page', async () => {
  const commands: string[] = []
  const executor: AdbExecutor = {
    async shell(command) {
      commands.push(command)
      if (command.startsWith('pm list packages')) return 'package:com.eg.android.AlipayGphone'
      return 'Starting: Intent'
    },
    async shellLines(command) { return (await this.shell(command)).split('\n').filter(Boolean) },
  }
  const result = await adbBash(executor).execute({ command: 'express' }, { turnId: 't1', callId: 'c1' })
  assert.equal(JSON.parse(result.content).mode, 'alipay')
  assert.equal(commands.filter(command => command.startsWith('pm list packages')).length, 1)
})

test('adb weather maps a forecast response to compact tool content', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async input => {
    assert.match(String(input), /\/amap\/weather/)
    return new Response(JSON.stringify({
      ok: true,
      city: '北京',
      daily: [{ date: '2026-09-26', dayweather: '晴' }],
    }), { status: 200 })
  }
  try {
    const result = await adbBash(mockExecutor({}), createAdbDeviceSession(), {
      mapApi: { baseUrl: 'https://map.example.test', apiKey: 'test-key' },
    }).execute({ command: 'weather 北京 --mode forecast' }, { turnId: 't1', callId: 'c1' })
    const payload = JSON.parse(result.content)
    assert.equal(payload.ok, true)
    assert.equal(payload.city, '北京')
    assert.equal(payload.forecast.length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('adb weather reports missing map API configuration without fetching', async () => {
  const originalFetch = globalThis.fetch
  let fetched = false
  globalThis.fetch = async () => {
    fetched = true
    return new Response('{}')
  }
  try {
    const result = await adbBash(mockExecutor({})).execute(
      { command: 'weather 北京' },
      { turnId: 't1', callId: 'c1' },
    )
    assert.equal(JSON.parse(result.content).error, 'map_api_unconfigured')
    assert.equal(fetched, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('adb scenic ticket checks Ctrip and opens the requested search', async () => {
  let launch = ''
  const executor: AdbExecutor = {
    async shell(command) {
      if (command.startsWith('pm list packages ctrip.android.view')) return 'package:ctrip.android.view'
      launch = command
      return 'Starting: Intent'
    },
    async shellLines(command) { return (await this.shell(command)).split('\n').filter(Boolean) },
  }
  const result = await adbBash(executor).execute({ command: 'ticket.query 故宫' }, { turnId: 't1', callId: 'c1' })
  assert.equal(JSON.parse(result.content).action, 'ticket_search')
  assert.match(launch, /ctrip:\/\/wireless/)
})

test('adb ringtone and IME handlers expose their successful fallback paths', async () => {
  const commands: string[] = []
  const executor: AdbExecutor = {
    async shell(command) {
      commands.push(command)
      if (command === 'cmd input_method show-input-method-picker') return 'Unknown command'
      return 'Starting: Intent'
    },
    async shellLines(command) { return (await this.shell(command)).split('\n').filter(Boolean) },
  }
  const bash = adbBash(executor)
  const ringtone = await bash.execute({ command: 'ringtone --type alarm' }, { turnId: 't1', callId: 'c1' })
  const ime = await bash.execute({ command: 'ime' }, { turnId: 't2', callId: 'c2' })
  assert.equal(JSON.parse(ringtone.content).type, 'alarm')
  assert.equal(JSON.parse(ime.content).action, 'input_method_settings_opened')
  assert.ok(commands.some(command => command.includes('RINGTONE_PICKER')))
  assert.ok(commands.some(command => command.includes('INPUT_METHOD_SETTINGS')))
})

test('adb meeting.join builds wemeet deeplink with password', async () => {
  let seen = ''
  const executor: AdbExecutor = {
    async shell(command) {
      if (command.includes('pm list packages com.tencent.wemeet.app')) return 'package:com.tencent.wemeet.app'
      seen = command
      return 'Starting: Intent { act=android.intent.action.VIEW dat=wemeet://page/inmeeting?... }'
    },
    async shellLines(command) {
      return (await this.shell(command)).split('\n').filter(Boolean)
    },
  }
  const result = await adbBash(executor).execute(
    { command: 'meeting.join wemeet 927318171 --password 123456' },
    { turnId: 't1', callId: 'c1' },
  )
  const payload = JSON.parse(result.content)
  assert.equal(payload.ok, true)
  assert.match(seen, /wemeet:\/\/page\/inmeeting/)
  assert.match(seen, /password=123456/)
})

test('adb timer.set dispatches SET_TIMER with message', async () => {
  let seen = ''
  const executor: AdbExecutor = {
    async shell(command) {
      seen = command
      return 'Starting: Intent { act=android.intent.action.SET_TIMER ... }'
    },
    async shellLines(command) {
      return (await this.shell(command)).split('\n').filter(Boolean)
    },
  }
  const result = await adbBash(executor).execute({ command: 'timer 300 --message 泡茶' }, { turnId: 't1', callId: 'c1' })
  const payload = JSON.parse(result.content)
  assert.equal(payload.ok, true)
  assert.equal(payload.seconds, 300)
  assert.match(seen, /SET_TIMER/)
  assert.match(seen, /MESSAGE/)
})

test('adb hotspot opens wireless settings page', async () => {
  let seen = ''
  const executor: AdbExecutor = {
    async shell(command) {
      seen = command
      return 'Starting: Intent { act=android.settings.WIRELESS_SETTINGS }'
    },
    async shellLines(command) {
      return (await this.shell(command)).split('\n').filter(Boolean)
    },
  }
  const result = await adbBash(executor).execute({ command: 'hotspot' }, { turnId: 't1', callId: 'c1' })
  const payload = JSON.parse(result.content)
  assert.equal(payload.ok, true)
  assert.match(seen, /WIRELESS_SETTINGS/)
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
