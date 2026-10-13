import assert from 'node:assert/strict'
import test from 'node:test'
import { deviceSystemHandlers } from '../src/cases/case1/device-system-handlers.js'
const context = { turnId: 'turn', callId: 'call' }
test('sensor reads are explicit native samples, never substituted for today steps', async () => {
  const calls: unknown[] = []
  const handlers = deviceSystemHandlers({ async request(capability, args) {
    calls.push({ capability, args })
    return { ok: true, steps_since_boot: { unavailable: 'sample_unavailable' } }
  } })
  const result = JSON.parse((await handlers['get_device_status']!({ fields: 'steps_since_boot' }, context)).content)
  assert.deepEqual(calls, [{ capability: 'sensors.read', args: { fields: ['steps_since_boot'] } }])
  assert.equal(result.steps_since_boot.unavailable, 'sample_unavailable')
  assert.equal(result.today_steps, undefined)
  assert.match(result.hint, /不是今日步数/)
})
test('default status does not silently acquire activity recognition data', async () => {
  const capabilities: string[] = []
  const handlers = deviceSystemHandlers({ async request(capability) { capabilities.push(capability); return { ok: true } } })
  await handlers['get_device_status']!({}, context)
  assert.deepEqual(capabilities, ['device.status'])
})
test('relative volume becomes native numeric input and result comes from the real readback', async () => {
  const calls: unknown[] = []
  const handlers = deviceSystemHandlers({ async request(capability, args) {
    calls.push({ capability, args }); return { ok: true, stream: 'music', percent: 46.7, stream_index: 7 }
  } })
  const result = await handlers['set_stream_volume']!({ percent: '+10' }, context)
  assert.deepEqual(calls, [{ capability: 'audio.volume', args: { mode: 'relative', percent: 10, stream: 'music' } }])
  assert.equal(JSON.parse(result.content).percent, 46.7)
})
test('restricted Wi-Fi reports the system panel instead of falsely claiming switch success', async () => {
  const handlers = deviceSystemHandlers({ async request() { return { ok: true, enabled: true, requested: false, outcome: 'panel_requested' } } })
  const result = JSON.parse((await handlers['set_wifi_enabled']!({ enabled: 'off' }, context)).content)
  assert.equal(result.enabled, true)
  assert.match(result.hint, /尚未改变/)
})
test('unknown fields and invalid percentage do not read devices; denied special access is preserved', async () => {
  let calls = 0
  const handlers = deviceSystemHandlers({ async request() { calls++; return { ok: false, error: 'system_access_denied' } } })
  assert.equal(JSON.parse((await handlers['get_device_status']!({ fields: 'androidid' }, context)).content).error, 'unknown_fields')
  assert.equal(JSON.parse((await handlers['set_screen_brightness']!({ percent: 'bad' }, context)).content).error, 'invalid_percent')
  assert.equal(calls, 0)
  assert.equal(JSON.parse((await handlers['set_screen_rotation']!({ mode: 'auto' }, context)).content).error, 'system_access_denied')
})
