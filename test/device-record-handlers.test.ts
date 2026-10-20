import assert from 'node:assert/strict'
import test from 'node:test'
import { deviceRecordHandlers } from '../src/cases/case1/device-record-handlers.js'
import { parseDeviceDate, startOfDeviceDay } from '../src/cases/case1/device-clock.js'
import { createDeviceCase1ToolRuntime } from '../src/cases/case1/device-runtime.js'
const context = { turnId: 'turn', callId: 'call' }
const now = Date.parse('2026-10-11T03:15:00Z')
test('calendar converts numeric-first dates and ignores valid ISO seconds before the device write', async () => {
  const writes: any[] = []
  const handlers = deviceRecordHandlers({ async request(capability, args) {
    if (capability === 'clock.read') return { ok: true, epochMillis: now, timeZone: 'Asia/Shanghai' }
    assert.equal(capability, 'calendar.upsert')
    writes.push(args); return { ok: true }
  } })
  for (const date_expr of ['+1dT09:00', '2026-10-12T09:00:59']) {
    assert.equal(JSON.parse((await handlers['calendar_create_or_update_event']!({ title: 'fixture', date_expr }, context)).content).ok, true)
    assert.equal(writes.at(-1).beginMillis, Date.parse('2026-10-12T01:00:00Z'))
  }
})
test('notification authorization produces a retry-after-grant hint, not an empty notification success', async () => {
  let requests = 0
  const handlers = deviceRecordHandlers({ async request(capability) {
    requests++
    assert.equal(capability, 'notifications.read')
    return { ok: false, error: 'system_access_required', access: 'NotificationListener', settings_opened: true }
  } })
  const reply = JSON.parse((await handlers['list_notifications']!({}, context)).content)
  assert.equal(reply.ok, false)
  assert.equal(reply.error, 'system_access_required')
  assert.match(reply.hint, /返回后重新请求/)
  assert.match(reply.hint, /本轮结束/)
  assert.equal(reply.notifications, undefined)
  assert.equal(requests, 1)
})
test('calendar uses device timezone, rejects invalid dates and nonexistent DST wall times', () => {
  assert.equal(startOfDeviceDay(now, 'Asia/Shanghai'), Date.parse('2026-10-10T16:00:00Z'))
  assert.equal(parseDeviceDate('2026-10-12T09:00', now, 'Asia/Shanghai'), Date.parse('2026-10-12T01:00:00Z'))
  assert.equal(parseDeviceDate('+d1T11:15', now, 'Asia/Shanghai'), now + 86400000)
  for (const input of ['2026-02-30', '2026-13-01', '2026-10-12 25:00']) assert.equal(parseDeviceDate(input, now, 'Asia/Shanghai'), undefined)
  assert.equal(parseDeviceDate('2026-03-08T02:30', now, 'America/New_York'), undefined)
  const spring = Date.parse('2026-03-08T12:00:00Z')
  assert.equal(startOfDeviceDay(spring, 'America/New_York', 1) - startOfDeviceDay(spring, 'America/New_York'), 23 * 3600000)
})
test('call list hides native phone references and groups without changing execution scope', async () => {
  const requests: any[] = []
  const handlers = deviceRecordHandlers({ async request(capability, args, ids) {
    requests.push({ capability, args, ids })
    return capability === 'clock.read' ? { ok: true, epochMillis: now, timeZone: 'Asia/Shanghai' }
      : { ok: true, calls: [{ display_name: 'fixture', call_type: 1, callRef: 'private' }] }
  } })
  const result = JSON.parse((await handlers['list_call_history']!({ groupby_ctype: true }, context)).content)
  assert.equal(result.count, 1)
  assert.equal(result.groups['1'].length, 1)
  assert.equal(JSON.stringify(result).includes('private'), false)
  assert.equal(requests[1].args.sinceMillis, Date.parse('2026-10-10T16:00:00Z'))
  assert.deepEqual(requests[1].ids, context)
})
test('calendar mutation sends native fields only and preserves execution-time denial', async () => {
  const requests: any[] = []
  const handlers = deviceRecordHandlers({ async request(capability, args) {
    requests.push({ capability, args })
    return capability === 'clock.read' ? { ok: true, epochMillis: now, timeZone: 'Asia/Shanghai' } : { ok: false, error: 'user_denied' }
  } })
  await handlers['calendar_create_or_update_event']!({ title: 'fixture', date_expr: '2026-10-12T09:00' }, context)
  assert.equal(requests[1].args.beginMillis, Date.parse('2026-10-12T01:00:00Z'))
  assert.equal(requests[1].args.date_expr, undefined)
  const denied = await handlers['calendar_delete_event']!({ event_id: 12 }, context)
  assert.equal(JSON.parse(denied.content).error, 'user_denied')
  assert.equal('confirm' in handlers || 'cancel' in handlers, false)
})
test('invalid arguments and clock failure do not execute writes', async () => {
  let calls = 0
  const handlers = deviceRecordHandlers({ async request() { calls++; return { ok: false, error: 'device_unavailable' } } })
  assert.equal(JSON.parse((await handlers['calendar_delete_event']!({ event_id: -1 }, context)).content).error, 'need_event_id')
  assert.equal(JSON.parse((await handlers['list_notifications']!({ limit: 0 }, context)).content).error, 'invalid_limit')
  assert.equal(calls, 0)
  assert.equal(JSON.parse((await handlers['calendar_create_or_update_event']!({ title: 'fixture', date_expr: '+d1T09:00' }, context)).content).error, 'device_unavailable')
  assert.equal(calls, 1)
})
test('ask uses Workbench input, never native permissions or an approval tool', async () => {
  const runtime = createDeviceCase1ToolRuntime({ async request() { throw Error('must not call device') } }, undefined,
    { async ask(input) { assert.deepEqual(input, { question: '选哪个？', choices: ['A', 'B'] }); return { answer: 'B' } } })
  const reply = await runtime.dispatcher.dispatch({ toolId: 'ask', arguments: { question: '选哪个？', choices: 'A, B' }, context })
  assert.equal(JSON.parse(reply.content).answer, 'B')
})
