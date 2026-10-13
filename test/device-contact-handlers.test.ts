import assert from 'node:assert/strict'
import test from 'node:test'
import { deviceContactHandlers } from '../src/cases/case1/device-contact-handlers.js'
const context = { turnId: 'turn', callId: 'call' }
test('single contact calls the opaque local object; approval failure is not success or a second tool', async () => {
  const calls: any[] = []
  const handlers = deviceContactHandlers({ async request(capability, args) {
    calls.push({ capability, args })
    return capability === 'contacts.resolve'
      ? { ok: true, count: 1, candidates: [{ ordinal_1based: 1, display_name: 'fixture', contactRef: 'opaque-local-ref' }] }
      : { ok: false, error: 'user_denied' }
  } })
  const result = await handlers['contact']!({ sub: 'call', query: 'fixture' }, context)
  assert.equal(JSON.parse(result.content).error, 'user_denied')
  assert.deepEqual(calls[1], { capability: 'call.request', args: { contactRef: 'opaque-local-ref' } })
  assert.equal(result.content.includes('opaque-local-ref'), false)
  assert.equal('confirm' in handlers || 'cancel' in handlers, false)
})
test('multiple matches preserve count but hide refs; failed selection does not clear pending', async () => {
  const handlers = deviceContactHandlers({ async request(capability) {
    return capability === 'contacts.resolve' ? { ok: true, candidates: [1, 2].map(i => ({ ordinal_1based: i, display_name: `fixture${i}`, contactRef: `private${i}` })) }
      : { ok: false, error: 'permission_denied' }
  } })
  const result = await handlers['contact']!({ sub: 'call', query: 'fixture' }, context)
  assert.equal(JSON.parse(result.content).count, 2)
  assert.equal(result.content.includes('private'), false)
  const failed = await handlers['select']!({ ordinal: '1' }, context)
  assert.equal(failed.state, undefined)
})
