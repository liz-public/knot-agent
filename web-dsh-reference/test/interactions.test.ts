import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createInteractionBroker } from '../../src/workbench/interactions.ts'
import type { LiveSessionEvent } from '../../src/workbench/session.ts'
import { createWorkbenchRemote } from '../src/workbench-remote.ts'
import { answerableQuestion, interactionAnswer, interactionFrame } from '../src/interaction-projection.ts'

test('B3 preserves request details and validates single-choice/free-text replies', () => {
  const approval = { id: 'a', kind: 'approval' as const, toolName: 'bash', arguments: { command: 'pwd' } }
  assert.match(interactionFrame('s', approval).request.reason!, /pwd/)
  assert.equal(interactionAnswer(approval, 'allowed-once'), 'allow')
  assert.equal(interactionAnswer(approval, 'rejected'), 'deny')
  assert.throws(() => interactionAnswer(approval, 'allowed-always'))
  const ask = { id: 'q', kind: 'ask' as const, question: 'Next?', choices: ['A', 'B'] }
  assert.deepEqual(interactionFrame('s', ask).request.questions![0].options, [{ label: 'A' }, { label: 'B' }])
  assert.equal(interactionAnswer(ask, { answers: [{ id: 'q', selected: ['B'] }] }), 'B')
  assert.equal(interactionAnswer(ask, { answers: [{ id: 'q', selected: [], custom: 'Other answer' }] }), 'Other answer')
  for (const answer of [{ id: 'q', selected: [] }, { id: 'q', selected: ['C'] }, { id: 'wrong', selected: ['A'] }]) {
    assert.throws(() => interactionAnswer(ask, { answers: [answer] }))
  }
})

test('B3 real broker: parallel decisions, duplicate delivery, Session switch and Ask replies', async () => {
  const listeners = new Map<string, (event: LiveSessionEvent) => void>()
  const brokers = new Map(['one', 'two'].map(id => [id, createInteractionBroker(event => listeners.get(id)?.(event))]))
  let fail = false
  const writes: any[] = []
  const remote = createWorkbenchRemote((async (url: string, options?: RequestInit) => {
    const id = url.split('/')[4]!
    if (options?.method) {
      const body = JSON.parse(options.body as string)
      writes.push({ sessionId: id, ...body })
      if (fail) return Response.json({ error: { message: 'Controlled failure' } }, { status: 503 })
      const resolved = brokers.get(id)!.respond(body.id, body.value)
      return Response.json(resolved ? { resolved } : { error: { message: 'Not found' } }, { status: resolved ? 200 : 404 })
    }
    const sessions = ['one', 'two'].map(id => ({ id, title: id, writable: true, eventCount: 0, runState: 'idle', assembly: 'case2' }))
    return Response.json(url.endsWith('/sessions') ? { sessions } : { session: sessions.find(s => s.id === id), events: [] })
  }) as typeof fetch, (id, listener) => {
    listeners.set(id, listener)
    for (const interaction of brokers.get(id)!.pending()) listener({ kind: 'interaction.request', interaction })
    return () => { listeners.delete(id) }
  })
  const eventsAbort = new AbortController()
  const events = remote.open('$control', '$events', {}, eventsAbort.signal)
  const ready = (await events.next()).value as any
  const reply = (event: any, value: unknown, kind = 'result') => remote.call('/api', '$events/result', {
    args: { clientId: ready.clientId, eventId: event.eventId, outcome: { kind, value,
      ...(kind === 'rejected' ? { error: { code: 'ASK_CANCELLED', message: 'User closed Ask' } } : {}),
    } },
  }) as Promise<any>
  const follow = async (id: string) => {
    const abort = new AbortController()
    const stream = remote.open('$session', 'session/follow', { args: [{ address: { kind: 'session', sessionId: id } }] }, abort.signal)
    await stream.next()
    return { abort, stream }
  }
  const one = await follow('one')
  const broker = brokers.get('one')!
  const first = broker.approval.request({ toolName: 'bash', arguments: { command: 'pwd' } })
  const second = broker.approval.request({ toolName: 'write', arguments: { path: 'test.txt' } })
  const a = (await events.next()).value as any
  const b = (await events.next()).value as any
  assert.notEqual(a.eventId, b.eventId)
  assert.equal(broker.pending().length, 2) // Delivery alone never grants approval.
  listeners.get('one')!({ kind: 'interaction.request', interaction: broker.pending()[0]! })
  assert.equal((await reply(a, 'allowed-once')).ok, true)
  assert.equal(await first, 'allow')
  assert.equal((await events.next()).value.type, 'cancel') // Duplicate was suppressed.
  assert.equal(broker.pending().length, 1)
  assert.equal((await reply(a, 'allowed-once')).ok, false)
  assert.equal((await reply(b, 'rejected')).ok, true)
  assert.equal(await second, 'deny')
  await events.next() // cancel

  const answer = broker.ask.ask({ question: 'Next?', choices: ['A', 'B'] })
  const q = (await events.next()).value as any
  const two = await follow('two')
  one.abort.abort(); await one.stream.return?.()
  assert.equal((await events.next()).value.eventId, q.eventId)
  assert.equal(broker.pending().length, 1)
  assert.equal((await reply(q, { answers: [{ id: broker.pending()[0]!.id, selected: ['B'] }] })).ok, false)
  const reopened = await follow('one')
  const replayed = (await events.next()).value as any
  assert.equal(replayed.agentId, 'one')
  const writesBeforeCancel = writes.length
  assert.equal((await reply(replayed, undefined, 'rejected')).ok, false)
  assert.equal(writes.length, writesBeforeCancel)
  assert.equal(broker.pending().length, 1) // Closing Ask is not an empty answer.
  const questionId = broker.pending()[0]!.id
  fail = true
  const free = { answers: [{ id: questionId, selected: [], custom: 'My own answer' }] }
  assert.equal((await reply(replayed, free)).ok, false)
  assert.equal(broker.pending().length, 1)
  fail = false
  assert.equal((await reply(replayed, free)).ok, true)
  assert.deepEqual(await answer, { answer: 'My own answer' })
  await events.next()
  const selected = brokers.get('two')!.ask.ask({ question: 'Choose', choices: ['A'] })
  const choice = (await events.next()).value as any
  assert.equal((await reply(choice, { answers: [{ id: brokers.get('two')!.pending()[0]!.id, selected: ['A'] }] })).ok, true)
  assert.deepEqual(await selected, { answer: 'A' })
  assert.equal(writes.at(-1).sessionId, 'two')
  reopened.abort.abort(); two.abort.abort(); eventsAbort.abort()
  await reopened.stream.return?.(); await two.stream.return?.(); await events.return?.()
  assert.equal(listeners.size, 0)
})

test('S2 unsupported Ask actions reject before settlement; native card can retry an answer', async () => {
  class Pending {
    questions = [{ id: 'q', question: 'Next?', options: [{ label: 'A' }] }]
    #answer: unknown
    get answered() { return this.#answer !== undefined }
    answer(value: unknown) { this.#answer = value; return Promise.resolve() }
    cancel() { this.#answer = 'cancelled'; return Promise.resolve() }
  }
  const pending = new Pending(), originalCancel = pending.cancel
  const card = answerableQuestion(pending, 'Cancel is not supported')
  assert.ok(card instanceof Pending)
  assert.equal(card.questions, pending.questions)
  await assert.rejects(card.cancel(), /Cancel is not supported/)
  await assert.rejects(card.answer({ answers: [{ id: 'q', selected: [] }] }), /skipping is not supported/)
  await assert.rejects(card.answer({ answers: [{ id: 'q', selected: ['unknown'] }] }), /requires one choice/)
  assert.equal(pending.answered, false)
  assert.equal(pending.cancel, originalCancel)
  await card.answer({ answers: [{ id: 'q', selected: [], custom: 'My answer' }] })
  assert.equal(pending.answered, true) // The original private-field receiver is preserved.
})
