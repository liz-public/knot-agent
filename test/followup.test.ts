import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLiveSession } from '../src/workbench/live-session.js'
import { case2Assembly } from '../src/workbench/case2-assembly.js'
import { createWorkbenchServer } from '../src/workbench/http-server.js'
import sharp from 'sharp'

test('native queue is editable/removable/promotable; only admitted turns enter Journal, in FIFO order', { timeout: 5000 }, async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'knot-followup-'))
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { entered = resolve })
  let calls = 0
  const seen: string[] = []
  const session = await createLiveSession({ id: 's', title: 'Queue test', cwd, journalPath: join(cwd, 's.jsonl'), assembly: case2Assembly,
    llm: { async generate(call) {
      seen.push(call.messages.filter(message => message.role === 'user').at(-1)!.content!)
      if (++calls === 1) { entered(); await gate }
      return { generated: { content: 'reply-' + calls, toolCalls: [] }, usage: { contextWindow: 100000 } }
    } } })
  const server = createWorkbenchServer({ sessions: [session] })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { release(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await session.close?.(); await rm(cwd, { recursive: true, force: true }) })
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/workbench/sessions/s`
  const send = async (text: string, mode = 'queue', requestId = text) => {
    const response = await fetch(base + '/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: text, mode, requestId }) })
    assert.equal(response.status, 202)
  }
  const update = async (itemId: string, action: unknown) => fetch(base + '/queue', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemId, action }) })
  await send('first'); await started
  await send('second'); await send('remove'); await send('third'); await send('promote')
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#00ff00' } }).png().toBuffer()
  const queuedImage = await fetch(base + '/messages', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'queue', content: [{ type: 'image', mediaType: 'image/png', data: png.toString('base64') }, { type: 'text', text: 'queued image' }] }) })
  assert.equal(queuedImage.status, 202)
  const initial = await session.snapshot()
  assert.equal(initial.pendingInputs!.length, 5)
  const ref = initial.pendingInputs!.at(-1)!.attachments![0]!
  assert.equal((await fetch(base + '/attachments?id=' + encodeURIComponent(ref.attachmentId))).status, 200)
  assert.equal(initial.events.filter(event => event.type === 'user.message').length, 1)
  const [second, removed, , promoted] = initial.pendingInputs!
  assert.equal((await update(second!.id, { kind: 'edit', content: 'edited second' })).status, 200)
  assert.equal((await update(removed!.id, { kind: 'remove' })).status, 200)
  assert.equal((await update(promoted!.id, { kind: 'steer' })).status, 200)
  const missing = await update(removed!.id, { kind: 'remove' })
  assert.equal((await missing.json()).error.code, 'session/queue-item-not-found')
  assert.deepEqual((await session.snapshot()).pendingInputs!.map(input => input.content), ['edited second', 'third', 'queued image'])
  const idle = new Promise<void>(resolve => {
    const unsubscribe = session.subscribe!(event => { if (event.kind === 'state.changed' && event.runState === 'idle') { unsubscribe(); resolve() } })
  })
  release(); await idle
  const final = await session.snapshot()
  assert.equal(final.pendingInputs, undefined)
  assert.deepEqual(final.events.filter(event => event.type === 'user.message').map(event => (event.data as any).content), ['first', 'promote', 'edited second', 'third', 'queued image'])
  assert.deepEqual(seen, ['first', 'promote', 'edited second', 'third', 'queued image'])
  assert.equal(final.events.filter(event => event.type === 'assistant.message').length, 4) // Stale first generation is steering-discarded.
})
