import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { LlmProvider } from '../src/cases/case1/llm.js'
import { createWorkbenchServer } from '../src/workbench/http-server.js'
import { createInteractionBroker } from '../src/workbench/interactions.js'
import { case2AssemblyFactory } from '../src/workbench/case2-assembly.js'
import { createLiveSession } from '../src/workbench/live-session.js'
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
    assembly: 'case2',
    model: 'mock',
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
  const session = await createLiveSession({
    id: 'live',
    title: 'Live CASE2',
    cwd: directory,
    journalPath: join(directory, 'session.jsonl'),
    assembly: case2AssemblyFactory({ llm, model: 'mock' }),
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
  const session = await createLiveSession({
    id: 'live',
    title: 'Live CASE2',
    cwd: directory,
    journalPath: join(directory, 'session.jsonl'),
    assembly: case2AssemblyFactory({ llm: {
      async generate(_call, onUpdate) {
        await onUpdate?.({ kind: 'content', text: 'Done.' })
        return { generated: { content: 'Done.', toolCalls: [] }, usage }
      },
    }, model: 'mock' }),
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

test('live CASE2 completes a coding turn and continues it after host reconstruction', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-workbench-coding-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const journalPath = join(directory, 'session.jsonl')
  await writeFile(join(directory, 'value.txt'), 'before\n', 'utf8')
  let generation = 0
  const firstProvider: LlmProvider = {
    async generate() {
      generation += 1
      if (generation === 1) return {
        generated: { toolCalls: [{ id: 'read-1', name: 'read', arguments: { path: 'value.txt' } }] },
        usage,
      }
      if (generation === 2) return {
        generated: { toolCalls: [{ id: 'edit-1', name: 'edit', arguments: { path: 'value.txt', oldText: 'before', newText: 'after' } }] },
        usage,
      }
      if (generation === 3) return {
        generated: { toolCalls: [{ id: 'bash-1', name: 'bash', arguments: { command: 'printf streamed && test "$(cat value.txt)" = after' } }] },
        usage,
      }
      return { generated: { content: 'Changed value.txt and verified it.', toolCalls: [] }, usage }
    },
  }
  const first = await createLiveSession({
    id: 'coding',
    title: 'Coding session',
    cwd: directory,
    journalPath,
    assembly: case2AssemblyFactory({ llm: firstProvider, model: 'mock-coder' }),
  })
  const firstEvents: LiveSessionEvent[] = []
  first.subscribe!(event => {
    firstEvents.push(event)
    if (event.kind === 'interaction.request' && event.interaction.kind === 'approval') {
      assert.equal(first.respond!(event.interaction.id, 'allow'), true)
    }
  })
  const firstIdle = nextEvent(firstEvents, first.subscribe!, event => event.kind === 'state.changed' && event.runState === 'idle')
  first.submit!('Read value.txt, change before to after, and verify it with bash.')
  await firstIdle

  assert.equal(await readFile(join(directory, 'value.txt'), 'utf8'), 'after\n')
  const firstSnapshot = await first.snapshot()
  const calls = firstSnapshot.events
    .filter(event => event.type === 'tool.call')
    .flatMap(event => (event.data as { calls: Array<{ name: string }> }).calls.map(call => call.name))
  assert.deepEqual(calls, ['read', 'edit', 'bash'])
  assert.ok(firstEvents.some(event => event.kind === 'tool.open' && event.callId === 'bash-1'))
  assert.ok(firstEvents.some(event => event.kind === 'tool.update'
    && event.callId === 'bash-1'
    && event.update.stream === 'stdout'
    && event.update.text === 'streamed'))
  assert.ok(firstEvents.some(event => event.kind === 'tool.close'
    && event.callId === 'bash-1'
    && event.exitCode === 0))
  assert.equal(firstSnapshot.events.some(event => event.type.startsWith('tool.output.')), false)
  assert.equal(firstSnapshot.session.workspace, directory)
  assert.equal(firstSnapshot.session.model, 'mock-coder')

  let restoredMessages: unknown
  const restored = await createLiveSession({
    id: 'coding',
    title: 'Coding session',
    cwd: directory,
    journalPath,
    assembly: case2AssemblyFactory({
      model: 'mock-coder',
      llm: {
        async generate(call) {
          restoredMessages = call.messages
          return { generated: { content: 'The previous edit and verification are in this session.', toolCalls: [] }, usage }
        },
      },
    }),
  })
  const restoredEvents: LiveSessionEvent[] = []
  const restoredIdle = nextEvent(restoredEvents, restored.subscribe!, event => event.kind === 'state.changed' && event.runState === 'idle')
  restored.subscribe!(event => restoredEvents.push(event))
  restored.submit!('What did you just verify?')
  await restoredIdle

  assert.match(JSON.stringify(restoredMessages), /value\.txt/)
  const restoredSnapshot = await restored.snapshot()
  assert.equal(restoredSnapshot.events.filter(event => event.type === 'session.start').length, 1)
  assert.equal(restoredSnapshot.events.filter(event => event.type === 'assistant.message').length, 2)
})
