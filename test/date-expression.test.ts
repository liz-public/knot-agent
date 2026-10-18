import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDeviceDate } from '../src/cases/case1/device-clock.js'
import { travelDate } from '../src/cases/case1/device-travel-handlers.js'
import { createCliCatalog } from '../src/cases/case1/cli.js'
import { ANDROID_TOOL_CATALOG } from '../src/cases/case1/android-tool-catalog.js'
import { toolIntentMatchSource } from '../src/cases/case1/context-contributions.js'

const zone = 'Asia/Shanghai', now = Date.parse('2026-10-18T10:20:00+08:00')
test('one strict grammar resolves local days, months, natural weeks and minutes', () => {
  for (const [expr, iso] of [
    ['+d1', '2026-10-19T00:00'], ['-d3', '2026-10-15T00:00'],
    ['+m1d3T17:00', '2026-11-03T17:00'], ['-m1d25', '2026-09-25T00:00'],
    ['+w2d3T09:15', '2026-10-28T09:15'], ['+w0d3', '2026-10-14T00:00'],
    ['2028-02-29T10:15', '2028-02-29T10:15'],
  ]) assert.equal(parseDeviceDate(expr!, now, zone), Date.parse(iso + ':00+08:00'), expr)
  assert.equal(travelDate('+m1d5', Date.parse('2026-12-29T00:00:00Z'), zone), '20270105')
  assert.equal(travelDate('+m1d1', Date.parse('2026-01-31T00:00:00Z'), zone), '20260201')
})
test('rejects unsupported aliases, invalid dates and mixed expressions instead of normalizing them', () => {
  for (const expr of ['明天', '+3d', '10-23', '2026-10-23 09:00', '2026-02-30', '+m1d31',
    '+w1d0', '+w1d8', '+m1d3+w1d1', '+d1T24:00', '+d1T10:60'])
    assert.equal(parseDeviceDate(expr, now, zone), undefined, expr)
  assert.equal(travelDate('+d1T17:00', now, zone), undefined)
})
test('day offsets follow local dates across daylight saving, not fixed 24-hour increments', () => {
  const spring = Date.parse('2026-03-07T12:00:00-05:00')
  assert.equal(parseDeviceDate('+d1T12:00', spring, 'America/New_York'), Date.parse('2026-03-08T12:00:00-04:00'))
})
test('date policy is turn context only for matched consumers, not every command', async () => {
  const source = toolIntentMatchSource(createCliCatalog(ANDROID_TOOL_CATALOG))
  for (const query of ['创建日程', '查高铁', '查询航班', '哪天是星期三']) {
    const result = await source(query)
    assert.match(result!.content, /日期填写：/)
    assert.equal(result!.content.match(/日期填写：/g)?.length, 1)
  }
  assert.doesNotMatch((await source('音量调大'))!.content, /日期填写：/)
})
