import assert from 'node:assert/strict'
import test from 'node:test'
import { createInteractionBroker } from '../src/workbench/interactions.js'
import { createDeviceCase1ToolRuntime } from '../src/cases/case1/device-runtime.js'

test('ask keeps choices and open answers; explicit cancellation is not an answer', async () => {
  const broker = createInteractionBroker(() => undefined)
  let pending = broker.ask.ask({ question: 'fixture', choices: ['A', 'B'] })
  assert.deepEqual(broker.pending()[0]!.kind, 'ask')
  assert.equal(broker.respond(broker.pending()[0]!.id, 'B'), true)
  assert.deepEqual(await pending, { answer: 'B' })
  pending = broker.ask.ask({ question: 'open' })
  broker.respond(broker.pending()[0]!.id, 'typed answer')
  assert.deepEqual(await pending, { answer: 'typed answer' })
  pending = broker.ask.ask({ question: 'cancel' })
  const id = broker.pending()[0]!.id
  broker.respond(id, '', true)
  assert.deepEqual(await pending, { answer: '', cancelled: true })
  assert.equal(broker.respond(id, 'late'), false)
})
test('cancelled ask returns a factual tool error; cancelled approval is denied', async () => {
  const broker = createInteractionBroker(() => undefined)
  const runtime = createDeviceCase1ToolRuntime({ async request() { throw new Error('ask must not invoke Android actions') } }, undefined, broker.ask)
  const result = runtime.dispatcher.dispatch({ toolId: 'ask', arguments: { question: 'fixture' }, context: { turnId: 't', callId: 'c' } })
  broker.respond(broker.pending()[0]!.id, '', true)
  assert.equal(JSON.parse((await result).content).error, 'user_cancelled')
  const approval = broker.approval.request({ toolName: 'fixture', arguments: {} })
  broker.respond(broker.pending()[0]!.id, '', true)
  assert.equal(await approval, 'deny')
})
