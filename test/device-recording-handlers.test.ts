import assert from 'node:assert/strict'
import test from 'node:test'
import { DEVICE_RECORDING_COMMAND, deviceRecordingHandlers } from '../src/cases/case1/device-recording-handlers.js'
import { createCliCatalog } from '../src/cases/case1/cli.js'
const context = { turnId: 'turn', callId: 'call' }
test('record has one typed device command, no approval or business metadata downlink', async () => {
  const catalog = createCliCatalog([DEVICE_RECORDING_COMMAND])
  const parsed = catalog.resolve('record screen start --seconds 60')
  assert.ok(!('content' in parsed))
  const calls: unknown[] = []
  const handlers = deviceRecordingHandlers({ async request(capability, args, scope) {
    calls.push({ capability, args, scope })
    return { ok: true, kind: 'screen', status: 'recording', uri: 'private' }
  } })
  const result = JSON.parse((await handlers['record_control']!(parsed.arguments, context)).content)
  assert.deepEqual(calls, [{ capability: 'recording.start', args: { kind: 'screen', maxDurationSec: 60 }, scope: context }])
  assert.equal(result.status, 'recording')
  assert.equal(result.uri, undefined)
})
test('record validates input and refuses unconfirmed saving', async () => {
  let calls = 0
  const handlers = deviceRecordingHandlers({ async request() { calls++; return { ok: true, status: 'stopped' } } })
  assert.equal(JSON.parse((await handlers['record_control']!({ kind: 'audio', action: 'start', seconds: 'NaN' }, context)).content).error, 'invalid_duration')
  assert.equal(calls, 0)
  assert.equal(JSON.parse((await handlers['record_control']!({ kind: 'audio', action: 'stop' }, context)).content).error, 'recording_save_unconfirmed')
})
test('record preserves device ownership and consent denials', async () => {
  const handlers = deviceRecordingHandlers({ async request() { return { ok: false, error: 'recording_scope_mismatch' } } })
  assert.equal(JSON.parse((await handlers['record_control']!({ kind: 'screen', action: 'stop' }, context)).content).error, 'recording_scope_mismatch')
})
