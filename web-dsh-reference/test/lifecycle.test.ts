import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWorkbenchRemote } from '../src/workbench-remote.ts'
import { createInteractionBroker } from '../../src/workbench/interactions.ts'

const tick = () => new Promise<void>(resolve => setImmediate(resolve))

test('incremental carrier fetches only the tail, avoids catalog reads on refresh and releases history on close', async () => {
  let emit = (_: any) => {}
  const events: any[] = Array.from({ length: 1200 }, (_, position) => ({ position, type: 'trace.note', data: 'history' }))
  const urls: string[] = [], sizes: number[] = []
  const remote = createWorkbenchRemote((async (url: string) => {
    urls.push(url)
    const parsed = new URL(url, 'http://test')
    if (parsed.pathname.endsWith('/sessions')) return Response.json({ sessions: [] })
    const after = parsed.searchParams.has('after') ? Number(parsed.searchParams.get('after')) : undefined
    const tail = after === undefined ? [...events] : events.slice(after + 1)
    sizes.push(tail.length)
    return Response.json({ session: { id: 's', writable: true, runState: 'idle' }, events: tail,
      ...(after === undefined ? {} : { after }) })
  }) as typeof fetch, (_id, listener) => { emit = listener; return () => {} })
  const abort = new AbortController(), frames: any[] = []
  const consume = (async () => {
    for await (const frame of remote.open('$session', 'session/follow', { args: [{ address: { kind: 'session', sessionId: 's' } }] }, abort.signal)) frames.push(frame)
  })()
  await tick()
  const before = urls.length
  events.push({ position: 1200, type: 'user.message', data: { turnId: 't', content: 'New' } })
  emit({ kind: 'journal.changed' }); await tick()
  assert.deepEqual(urls.slice(before), ['/api/workbench/sessions/s?after=1199'])
  assert.equal(sizes.at(-1), 1)
  assert.equal(frames.filter(frame => frame.event?.type === 'user/message').length, 1)
  emit({ kind: 'journal.changed' }); await tick()
  assert.equal(sizes.at(-1), 0)
  assert.equal(frames.filter(frame => frame.event?.type === 'user/message').length, 1)
  abort.abort(); await consume
  const next = new AbortController()
  const stream = remote.open('$session', 'session/follow', { args: [{ address: { kind: 'session', sessionId: 's' } }] }, next.signal)
  await stream.next()
  assert.equal(urls.at(-1), '/api/workbench/sessions/s')
  assert.equal(sizes.at(-1), 1201)
  next.abort(); await stream.return?.()
})

test('catalog stream updates child navigation without tying it to every Journal notification', async () => {
  let changed = () => {}, reads = 0
  const sessions: any[] = [{ id: 'parent', title: 'Parent', workspace: '/test', assembly: 'case2', writable: true }]
  const remote = createWorkbenchRemote((async (url: string) => {
    if (url.endsWith('/sessions')) { reads++; return Response.json({ sessions: [...sessions] }) }
    return Response.json({ session: sessions[0], events: [] })
  }) as typeof fetch, () => () => {}, listener => { changed = listener; return () => {} })
  const abort = new AbortController(), frames: any[] = [], controls: any[] = []
  const follow = (async () => {
    for await (const _ of remote.open('$session', 'session/follow', { args: [{ address: { kind: 'session', sessionId: 'parent' } }] }, abort.signal)) {}
  })()
  const control = (async () => {
    for await (const frame of remote.open('$control', 'session/control', {}, abort.signal)) controls.push(frame)
  })()
  const consume = (async () => {
    for await (const frame of remote.open('$workspace', 'workspace/follow', {}, abort.signal)) frames.push(frame)
  })()
  await tick()
  sessions.push({ id: 'child', title: 'Child', parentSessionId: 'parent', workspace: '/test', assembly: 'case2' })
  changed(); await tick()
  const before = reads
  changed(); await tick()
  assert.equal(reads, before + 1)
  assert.ok(controls.every(frame => frame.type !== 'projection' || frame.seq >= 0))
  assert.deepEqual(frames.findLast(frame => frame.type === 'upsert').workspace.sessionIds, ['parent'])
  assert.deepEqual(frames.findLast(frame => frame.type === 'archived').archivedSessionIds, [])
  assert.deepEqual(frames.findLast(frame => frame.type === 'pinned').pinnedSessionIds, [])
  const children: any = await remote.call('$test', 'subagents/list', { args: [{ parentSessionId: 'parent' }] })
  assert.equal(children.ok, true)
  assert.equal(children.value.entries[0].id, 'child')
  abort.abort(); await Promise.all([consume, follow, control])
})

test('S3 coalesces long-history refresh bursts without losing stream order or final settlement', async () => {
  const events: any[] = Array.from({ length: 1200 }, (_, position) => ({ position, type: 'trace.note', data: { text: 'history' } }))
  let emit = (_: any) => {}, reads = 0, release: (() => void) | undefined
  let hold = false
  const remote = createWorkbenchRemote((async (url: string) => {
    if (url.endsWith('/sessions')) return Response.json({ sessions: [] })
    reads++
    const captured = [...events]
    if (hold) { hold = false; await new Promise<void>(resolve => { release = resolve }) }
    return Response.json({ session: { id: 's', writable: true, runState: 'running' }, events: captured })
  }) as typeof fetch, (_id, listener) => { emit = listener; return () => {} })
  const abort = new AbortController(), frames: any[] = []
  const consume = (async () => {
    for await (const frame of remote.open('$session', 'session/follow', { args: [{ address: { kind: 'session', sessionId: 's' }, assistantStream: true }] }, abort.signal)) frames.push(frame)
  })()
  await tick()
  events.push({ position: events.length, type: 'user.message', data: { turnId: 't', content: 'test' } },
    { position: events.length + 1, type: 'llm.invoke', data: { requestId: 'r', request: { turnId: 't', purpose: 'agent' } } })
  emit({ kind: 'generation.open', requestId: 'r', purpose: 'agent' }); await tick()
  const before = reads
  hold = true
  emit({ kind: 'journal.changed' }); await tick()
  for (let index = 0; index < 100; index++) {
    emit({ kind: 'journal.changed' })
    emit({ kind: 'generation.update', requestId: 'r', update: { kind: 'content', text: String(index) + ',' } })
  }
  release!(); await tick(); await tick()
  assert.equal(reads - before, 2) // One in flight + one trailing reconciliation, not 101.
  const chunks = frames.filter(frame => frame.frame?.chunk?.type === 'text-delta')
  assert.equal(chunks.map(frame => frame.frame.chunk.text).join(''), Array.from({ length: 100 }, (_, i) => i + ',').join(''))
  events.push({ position: events.length, type: 'llm.generated', data: { requestId: 'r', request: { turnId: 't', purpose: 'agent' }, generated: { content: 'final' } } })
  for (let i = 0; i < 100; i++) emit({ kind: 'journal.changed' })
  emit({ kind: 'generation.close', requestId: 'r' }); emit({ kind: 'state.changed', runState: 'idle' })
  await tick(); await tick()
  assert.equal(frames.filter(frame => frame.event?.type === 'assistant/message').length, 1)
  assert.equal(frames.filter(frame => frame.frame?.type === 'end').length, 1)
  assert.ok(reads - before <= 5)
  abort.abort(); await consume
})

test('S3 identical submitted texts get distinct receipts, then acknowledged content is retired', async () => {
  const events: any[] = []
  let emit = (_: any) => {}, fail = false
  const remote = createWorkbenchRemote((async (url: string, init?: RequestInit) => {
    if (init?.method) return Response.json(fail ? { error: { message: 'failed' } } : { accepted: true }, { status: fail ? 500 : 202 })
    return Response.json(url.endsWith('/sessions') ? { sessions: [] } : { session: { id: 's', writable: true, runState: 'idle' }, events })
  }) as typeof fetch, (_id, listener) => { emit = listener; return () => {} })
  const abort = new AbortController(), frames: any[] = []
  const consume = (async () => {
    for await (const frame of remote.open('$session', 'session/follow', { args: [{ address: { kind: 'session', sessionId: 's' } }] }, abort.signal)) frames.push(frame)
  })()
  await tick()
  const submit = (requestId: string) => remote.call('$test', 'session/prompt', { args: [{ sessionId: 's', requestId, content: [{ type: 'text', text: 'same' }] }] })
  await submit('first'); await submit('second')
  fail = true; assert.equal((await submit('failed')).ok, false)
  events.push(...['t1', 't2', 't3'].map((turnId, position) => ({ position, type: 'user.message', data: { turnId, content: 'same' } })))
  emit({ kind: 'journal.changed' }); await tick()
  assert.deepEqual(frames.filter(frame => frame.event?.type === 'user/message').map(frame => frame.event.data.source.rpcId), ['first', 'second', undefined])
  const rebuilt: any = await remote.call('$test', 'session/projections', { args: [{ sessionId: 's' }] })
  assert.equal(rebuilt.ok, true)
  abort.abort(); await consume
  const next = new AbortController()
  const stream = remote.open('$test', 'session/follow', { args: [{ address: { kind: 'session', sessionId: 's' } }] }, next.signal)
  const baseline: any = (await stream.next()).value
  assert.equal(baseline.records.some((record: any) => record.event.data.source?.rpcId), false)
  next.abort(); await stream.return?.()
})

test('S3 broker settlement reaches both Clients; reconnect baseline removes missed requests', async () => {
  const subscribers = new Set<(event: any) => void>()
  const broker = createInteractionBroker(event => subscribers.forEach(listener => listener(event)))
  const fetcher = (async (url: string, init?: RequestInit) => {
    if (init?.method) { const body = JSON.parse(init.body as string); return Response.json({ resolved: broker.respond(body.id, body.value) }) }
    return Response.json(url.endsWith('/sessions') ? { sessions: [] } : { session: { id: 's', writable: true }, events: [] })
  }) as typeof fetch
  const abort = new AbortController(), streams: Promise<void>[] = [], clients: any[] = []
  for (let i = 0; i < 2; i++) {
    const frames: any[] = [], remote = createWorkbenchRemote(fetcher, (_id, listener) => {
      subscribers.add(listener); listener({ kind: 'interaction.snapshot', interactions: broker.pending() })
      return () => { subscribers.delete(listener) }
    })
    clients.push({ remote, frames })
    for (const endpoint of ['$events', 'session/follow']) streams.push((async () => {
      for await (const frame of remote.open('$test', endpoint, { args: [{ address: { kind: 'session', sessionId: 's' } }] }, abort.signal)) frames.push(frame)
    })())
  }
  await tick()
  const decision = broker.approval.request({ toolName: 'bash', arguments: { command: 'not executed' } }); await tick()
  const [left, right] = clients
  const request = left.frames.find((frame: any) => frame.type === 'waterfall')
  const ready = left.frames.find((frame: any) => frame.type === 'ready')
  await left.remote.call('$test', '$events/result', { args: [{ clientId: ready.clientId, eventId: request.eventId, outcome: { kind: 'result', value: 'allowed-once' } }] })
  await tick(); assert.equal(await decision, 'allow')
  for (const client of clients) assert.equal(client.frames.filter((frame: any) => frame.type === 'cancel').length, 1)
  const pending = broker.ask.ask({ question: 'Next?' }); await tick()
  const question = right.frames.filter((frame: any) => frame.type === 'waterfall').at(-1)
  // A reconnect baseline is authoritative even when the settlement notification was missed.
  subscribers.forEach(listener => listener({ kind: 'interaction.snapshot', interactions: [] })); await tick()
  assert.equal(right.frames.at(-1).eventId, question.eventId)
  assert.equal(broker.pending().length, 1) // Presentation reconciliation cannot answer the tool.
  broker.respond(broker.pending()[0]!.id, 'done'); await pending
  abort.abort(); await Promise.all(streams)
})
