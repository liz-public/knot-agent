import assert from 'node:assert/strict'
import test from 'node:test'
import { Runtime, type Plugin } from '../src/core.js'

test('events are breadth-first and subscribers use registration order', async () => {
  const calls: string[] = []
  const plugins: Plugin[] = [
    {
      name: 'first',
      subscriptions: ['root'],
      handle(_event, context) {
        calls.push('first')
        context.append('left', {})
      },
    },
    {
      name: 'second',
      subscriptions: ['root'],
      handle(_event, context) {
        calls.push('second')
        context.append('right', {})
      },
    },
    {
      name: 'leaves',
      subscriptions: ['left', 'right'],
      handle(event) {
        calls.push(event.type)
      },
    },
  ]
  const runtime = new Runtime(plugins)
  runtime.ingress('root', {})

  await runtime.runUntilIdle()

  assert.deepEqual(calls, ['first', 'second', 'left', 'right'])
  assert.deepEqual(runtime.journal.read().map(event => event.type), [
    'root', 'left', 'right',
  ])
})

test('event data is immutable after append', () => {
  const input = { nested: { value: 1 } }
  const runtime = new Runtime([])
  const event = runtime.ingress('never-run', input)
  input.nested.value = 2
  assert.deepEqual(event.data, { nested: { value: 1 } })
  assert.equal(Object.isFrozen((event.data as typeof input).nested), true)
})

test('an unhandled event stops the runtime', async () => {
  const runtime = new Runtime([])
  runtime.ingress('missing', {})
  await assert.rejects(runtime.runUntilIdle(), /unhandled event #0 missing/)
  await assert.rejects(runtime.runUntilIdle(), /unhandled event #0 missing/)
})

