import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { LlmProvider } from '../src/cases/case1/llm.js'
import { createWorkbenchServer } from '../src/workbench/http-server.js'
import { createInteractionBroker } from '../src/workbench/interactions.js'
import { createLiveCase2Session } from '../src/workbench/live-session.js'
import { loadSessionDescriptors, saveSessionDescriptor } from '../src/workbench/session-catalog.js'
import type { InteractionRequestDto, LiveSessionEvent } from '../src/workbench/session.js'

const usage = { inputTokens: 20, outputTokens: 5, totalTokens: 25, contextWindow: 1000 }

test('workbench ask interaction waits for and returns the matching browser answer', async () => {
  const events: LiveSessionEvent[] = []
  const broker = createInteractionBroker(event => events.push(event))
  const answer = broker.ask.ask({ question: 'Choose one', choices: ['a', 'b'] })
  const request = events[0]
  assert.equal(request?.kind, 'interaction.request')
  if (request?.kind !== 'interaction.request') throw new Error('expected interaction')
  assert.equal(request.interaction.kind, 'ask')
  assert.equal(broker.respond(request.interaction.id, 'b'), true)
  assert.deepEqual(await answer, { answer: 'b' })
  assert.equal(broker.respond(request.interaction.id, 'a'), false)
})

test('workbench session descriptors preserve new sessions for host restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-workbench-catalog-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const descriptor = {
    id: 'case2-one',
    title: 'Persistent session',
    cwd: directory,
    journalPath: join(directory, 'case2-one.jsonl'),
  }
  await saveSessionDescriptor(directory, descriptor)
  assert.deepEqual(await loadSessionDescriptors(directory), [descriptor])
})

function nextEvent(
  events: LiveSessionEvent[],
  subscribe: (listener: (event: LiveSessionEvent) => void) => () => void,
  predicate: (event: LiveSessionEvent) => boolean,
): Promise<LiveSessionEvent> {
  const existing = events.find(predicate)
  if (existing !== undefined) return Promise.resolve(existing)
  return new Promise(resolve => {
    const unsubscribe = subscribe(event => {
      if (!predicate(event)) return
      unsubscribe()
      resolve(event)
    })
  })
}

test('live CASE2 session streams generation, resolves approval, and persists authoritative facts', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-workbench-live-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let generation = 0
  const llm: LlmProvider = {
    async generate(_call, onUpdate) {
      generation += 1
      if (generation === 1) {
        await onUpdate?.({ kind: 'reasoning', text: 'I will write the requested file.' })
        await onUpdate?.({ kind: 'tool_call', index: 0, id: 'write-1', name: 'write', argumentsDelta: '{"path":"answer.txt"}' })
        return {
          generated: {
            reasoning: 'I will write the requested file.',
            toolCalls: [{ id: 'write-1', name: 'write', arguments: { path: 'answer.txt', content: 'done\n' } }],
          },
          usage,
        }
      }
      await onUpdate?.({ kind: 'content', text: 'Created and verified answer.txt.' })
      return {
        generated: { content: 'Created and verified answer.txt.', toolCalls: [] },
        usage,
      }
    },
  }
  const session = await createLiveCase2Session({
    id: 'live',
    title: 'Live CASE2',
    cwd: directory,
    journalPath: join(directory, 'session.jsonl'),
    llm,
  })
  const events: LiveSessionEvent[] = []
  const subscribe = session.subscribe!
  const unsubscribe = subscribe(event => events.push(event))
  t.after(unsubscribe)

  session.submit!('Create answer.txt.')
  const requestEvent = await nextEvent(events, subscribe, event => event.kind === 'interaction.request')
  const interaction = (requestEvent as { interaction: InteractionRequestDto }).interaction
  assert.equal(interaction.kind, 'approval')
  assert.equal(interaction.kind === 'approval' ? interaction.toolName : '', 'write')
  assert.equal(session.respond!(interaction.id, 'allow'), true)
  await nextEvent(events, subscribe, event => event.kind === 'state.changed' && event.runState === 'idle')

  assert.equal(await readFile(join(directory, 'answer.txt'), 'utf8'), 'done\n')
  assert.ok(events.some(event => event.kind === 'generation.update'))
  assert.ok(events.some(event => event.kind === 'journal.changed'))
  const snapshot = await session.snapshot()
  assert.equal(snapshot.session.runState, 'idle')
  assert.equal(snapshot.session.writable, true)
  assert.ok(snapshot.events.some(event => event.type === 'tool.registry'))
  assert.ok(snapshot.events.some(event => event.type === 'tool.result'))
  assert.ok(snapshot.events.every(event => event.observedAt !== undefined))
})

test('workbench HTTP commands drive one injected live session', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-workbench-live-http-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const session = await createLiveCase2Session({
    id: 'live',
    title: 'Live CASE2',
    cwd: directory,
    journalPath: join(directory, 'session.jsonl'),
    llm: {
      async generate(_call, onUpdate) {
        await onUpdate?.({ kind: 'content', text: 'Done.' })
        return { generated: { content: 'Done.', toolCalls: [] }, usage }
      },
    },
  })
  const server = createWorkbenchServer({ sessions: [session] })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error === undefined ? resolve() : reject(error))
  }))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected TCP address')
  const base = `http://127.0.0.1:${address.port}/api/workbench/sessions/live`
  const idle = nextEvent([], session.subscribe!, event => event.kind === 'state.changed' && event.runState === 'idle')
  const streamAbort = new AbortController()
  t.after(() => streamAbort.abort())
  const stream = await fetch(`${base}/stream`, { signal: streamAbort.signal })
  assert.equal(stream.status, 200)
  const reader = stream.body!.getReader()
  const sawGenerationUpdate = (async () => {
    const decoder = new TextDecoder()
    let text = ''
    while (!text.includes('"kind":"generation.update"')) {
      const next = await reader.read()
      if (next.done) throw new Error('SSE ended before generation update')
      text += decoder.decode(next.value, { stream: true })
    }
  })()

  const response = await fetch(`${base}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'Reply once.' }),
  })
  assert.equal(response.status, 202)
  await sawGenerationUpdate
  await reader.cancel()
  await idle
  const snapshot = await (await fetch(base)).json() as { events: Array<{ type: string }> }
  assert.ok(snapshot.events.some(event => event.type === 'assistant.message'))
})
