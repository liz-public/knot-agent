import assert from 'node:assert/strict'
import test from 'node:test'
import { deviceScreenHandlers } from '../src/cases/case1/device-screen-handlers.js'
const context = { turnId: 'turn', callId: 'call' }
test('screenshot only reports a real gallery save, without exposing a private URI', async () => {
  const handlers = deviceScreenHandlers({ async request(capability, args, ids) {
    assert.equal(capability, 'screen.capture'); assert.deepEqual(args, {}); assert.deepEqual(ids, context)
    return { ok: true, filename: 'fixture.png', saved_to_gallery: true, uri: 'private-not-for-model' }
  } })
  const result = JSON.parse((await handlers['take_system_screenshot']!({}, context)).content)
  assert.equal(result.filename, 'fixture.png')
  assert.equal(result.saved_to_gallery, true)
  assert.equal(result.uri, undefined)
})
test('screen permission denial is not empty success, nor unconfirmed save success', async () => {
  const denied = deviceScreenHandlers({ async request() { return { ok: false, error: 'accessibility_unavailable' } } })
  assert.equal(JSON.parse((await denied['read_screen_content']!({}, context)).content).error, 'accessibility_unavailable')
  const unconfirmed = deviceScreenHandlers({ async request() { return { ok: true } } })
  assert.equal(JSON.parse((await unconfirmed['take_system_screenshot']!({}, context)).content).error, 'screenshot_save_unconfirmed')
})
test('QR decoding is only requested explicitly and returns native observations', async () => {
  const capabilities: string[] = []
  const handlers = deviceScreenHandlers({ async request(capability) {
    capabilities.push(capability)
    return capability === 'screen.codes' ? { ok: true, qr_count: 1, qr_codes: [{ index_1based: 1, raw_value: 'fixture' }] }
      : { ok: true, text: 'fixture\ntext', packageName: 'fixture.app', truncated: false }
  } })
  const result = JSON.parse((await handlers['read_screen_content']!({ detect_qr: true }, context)).content)
  assert.equal(result.char_count, 12)
  assert.equal(result.qr_count, 1)
  assert.equal(result.qr_codes[0].raw_value, 'fixture')
  assert.deepEqual(capabilities, ['screen.text', 'screen.codes'])
  capabilities.length = 0
  await handlers['read_screen_content']!({}, context)
  assert.deepEqual(capabilities, ['screen.text'])
})
