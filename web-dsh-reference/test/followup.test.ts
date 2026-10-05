import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWorkbenchRemote } from '../src/workbench-remote.ts'
import { projectKnotSnapshot } from '../src/knot-journal-projection.ts'
import { presentationMode } from '../src/presentation-mode.ts'
import { extendNativeInbox } from '../native-inbox-extension.ts'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

test('published native inbox apply accepts Host revisions without minting fake log seqs', () => {
  const require = createRequire(import.meta.url)
  const original = readFileSync(require.resolve('@deepseek-ai/dsh-api-session-controller/client'), 'utf8')
  const source = extendNativeInbox(original)
  new Function('window', source)
  assert.throws(() => extendNativeInbox(source), /no longer matches/)
  // Execute the published apply method itself, not a reimplementation of its comparator.
  const start = source.indexOf('apply(key, value, seq) {')
  const end = source.indexOf('this.changed(key);', start) + 'this.changed(key);'.length
  const method = source.slice(start, end) + '}'
  const apply = new Function('return ({' + method + '}).apply')()
  let changes = 0
  const store = { rows: new Map(), changed: () => changes++ }
  const update = (revision: number, contents: string[], epoch = 'host-a') => apply.call(store, 'inbox', {
    knotQueueVersion: { epoch, revision }, 'next-turn': contents,
  }, 5)
  update(0, []); update(1, ['queued']); update(2, ['edited']); update(1, ['stale'])
  assert.deepEqual(store.rows.get('inbox').value['next-turn'], ['edited'])
  assert.equal(store.rows.get('inbox').seq, 5)
  update(3, []); update(0, [], 'host-b')
  assert.equal(changes, 5)
  apply.call(store, 'inbox', { knotQueueVersion: { epoch: 'host-b', revision: 0 }, 'next-turn': [] }, 6)
  assert.equal(store.rows.get('inbox').seq, 6) // Admission can advance the original Journal watermark.
  apply.call(store, 'usage', { count: 1 }, 5); apply.call(store, 'usage', { count: 2 }, 5)
  assert.equal(store.rows.get('usage').value.count, 1)
})

test('missing mode selects real Workbench; fixture must be explicit, typos are errors', () => {
  assert.equal(presentationMode(undefined), 'workbench')
  assert.equal(presentationMode('workbench'), 'workbench')
  assert.equal(presentationMode('fixture'), 'fixture')
  assert.throws(() => presentationMode('workbenc'), /must be/)
})

test('native queue/steer and updateQueue are adapted without custom composer UI', async () => {
  const writes: any[] = []
  const session = { id: 's', title: 's', assembly: 'case2', writable: true, runState: 'running' as const, eventCount: 0 }
  const pendingInputs = [{ id: 'q', requestId: 'rpc2', content: 'second' }]
  const remote = createWorkbenchRemote((async (_url: string, init?: RequestInit) => {
    if (init?.method) { writes.push(JSON.parse(init.body as string)); return Response.json({ accepted: true }) }
    return Response.json({ session, events: [], pendingInputs })
  }) as typeof fetch)
  const call = (endpoint: string, input: any) => remote.call('$native', endpoint, { args: [input] }) as Promise<any>
  assert.equal((await call('session/prompt', { sessionId: 's', requestId: 'rpc2', mode: 'queue', content: [{ type: 'text', text: 'second' }] })).ok, true)
  assert.deepEqual(writes[0], { content: 'second', mode: 'queue', requestId: 'rpc2' })
  assert.equal((await call('session/prompt', { sessionId: 's', requestId: 'rpc3', mode: 'steer', content: [{ type: 'text', text: 'now' }] })).ok, true)
  assert.equal(writes[1].mode, 'steer')
  assert.equal((await call('session/updateQueue', { sessionId: 's', itemId: 'q', action: { kind: 'edit', content: [{ type: 'text', text: 'edited' }] } })).ok, true)
  assert.deepEqual(writes[2], { itemId: 'q', action: { kind: 'edit', content: 'edited' } })
  const projection = projectKnotSnapshot({ session, events: [], pendingInputs })
  assert.deepEqual((projection.projections.values.inbox as any)['next-turn'][0], { id: 'q', role: 'user', source: { kind: 'user', rpcId: 'rpc2' }, content: [{ type: 'text', text: 'second' }] })
  assert.equal(projection.records.some(record => record.event.type === 'user/message'), false)
})

test('queue-only live updates feed native inbox directly without reading full Journal snapshots', async () => {
  let listener: (event: any) => void = () => {}, reads = 0
  const remote = createWorkbenchRemote((async (url: string) => {
    reads++
    if (url.endsWith('/sessions')) return Response.json({ sessions: [] })
    return Response.json({ session: { id: 's', title: 's', assembly: 'case2', eventCount: 0, runState: 'running', writable: true }, events: [] })
  }) as typeof fetch, (_id, handler) => { listener = handler; return () => {} })
  const abort = new AbortController(), control: any[] = []
  const pumps = ['session/control', 'session/follow'].map(async endpoint => {
    for await (const frame of remote.open('$native', endpoint, { args: [{ sessionId: 's', address: { kind: 'session', sessionId: 's' } }] }, abort.signal)) if (endpoint === 'session/control') control.push(frame)
  })
  const tick = () => new Promise(resolve => setImmediate(resolve))
  await tick(); await tick()
  const before = reads
  listener({ kind: 'queue.changed', queueVersion: { epoch: 'a', revision: 1 }, pendingInputs: [{ id: 'q', content: 'next', requestId: 'rpc' }] })
  await tick(); await tick()
  assert.equal(reads, before)
  const update = control.find(frame => frame.type === 'projection' && frame.key === 'inbox')
  assert.equal(update.value['next-turn'][0].content[0].text, 'next')
  assert.equal(update.seq, -1)
  abort.abort(); await Promise.all(pumps)
})
