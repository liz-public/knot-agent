import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'

test('date reports local date/time with an explicit server timezone, including midnight rollover', () => {
  const code = `import {localDateFields} from './dist/src/cases/case1/adb/datetime.js';
    console.log(JSON.stringify(['2026-10-13T03:12:59Z','2026-10-13T20:00:00Z'].map(x=>localDateFields(new Date(x)))));`
  const rows = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code],
    { env: { ...process.env, TZ: 'Asia/Shanghai' }, encoding: 'utf8' }))
  assert.deepEqual(rows, [
    { local_date: '2026-10-13', local_time: '11:12:59', weekday: '二', time_zone: 'Asia/Shanghai' },
    { local_date: '2026-10-14', local_time: '04:00:00', weekday: '三', time_zone: 'Asia/Shanghai' },
  ])
})
