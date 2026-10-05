import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { defineAssembly } from '../src/workbench/assembly.js'
import { createAssemblyCatalog } from '../src/workbench/assembly-catalog.js'
import { createLiveSession } from '../src/workbench/live-session.js'
import { createCase2Assembly } from '../src/workbench/case2-assembly.js'
import type { LiveSessionEvent } from '../src/workbench/session.js'

test('CASE2 search declaration and execution use the same assembled provider capability', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-search-assembly-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const queries: string[] = []
  const assembly = createCase2Assembly({ async search(query) {
    queries.push(query)
    return { sources: [{ url: 'https://example.com', title: 'Test source' }] }
  } })
  assert.equal(assembly.description.tools.filter(tool => tool.name === 'web_search').length, 1)
  assert.equal(createCase2Assembly().description.tools.some(tool => tool.name === 'web_search'), false)
  let step = 0
  const session = await createLiveSession({
    id: 'search', title: 'Search', cwd: directory, journalPath: join(directory, 'session.jsonl'), assembly,
    subagentFactory: { run: async () => ({ summary: '' }) },
    llm: { async generate(input) {
      const names = input.tools.map(tool => (tool['function'] as { name: string }).name)
      assert.deepEqual(names, assembly.description.tools.map(tool => tool.name))
      return { usage: { contextWindow: 32_768 }, generated: ++step === 1
        ? { toolCalls: [{ id: 'search-1', name: 'web_search', arguments: { query: 'journal-first' } }] }
        : { content: 'Search completed.', toolCalls: [] } }
    } },
  })
  const idle = new Promise<void>(resolve => session.subscribe!(event => {
    if (event.kind === 'state.changed' && event.runState === 'idle') resolve()
  }))
  session.submit!('Search for journal-first')
  await idle
  assert.deepEqual(queries, ['journal-first'])
  const snapshot = await session.snapshot()
  const result = snapshot.events.find(event => event.type === 'tool.result')?.data
  assert.match(JSON.stringify(result), /Test source/)
})

test('assembly catalog exposes CASE1 and CASE2 from their executable definitions', () => {
  const catalog = createAssemblyCatalog()
  assert.deepEqual(catalog.list().map(item => item.description.id), ['case1', 'case2'])
  assert.deepEqual(catalog.get('case1')?.description.tools.map(tool => tool.name), ['bash'])
  assert.deepEqual(catalog.get('case2')?.description.tools.map(tool => tool.name), [
    'read', 'write', 'edit', 'bash', 'process.wait', 'process.stop', 'todo.write', 'goal.write', 'spawn_agent', 'ask',
  ])
  assert.equal(catalog.get('missing'), undefined)
})

test('an Assembly may intentionally declare no prompt, tools, or chat protocols', () => {
  const definition = defineAssembly({
    id: 'event-only',
    title: 'Event-only assembly',
    async create() {
      return {
        async submit() {},
        steer() {},
        pause() {},
        resume() {},
        status: () => 'idle',
      }
    },
  })

  assert.equal(definition.description.systemPrompt, '')
  assert.deepEqual(definition.description.plugins, [])
  assert.deepEqual(definition.description.tools, [])
  assert.deepEqual(definition.description.protocols, [])
})

test('Workbench runs a CASE1 assembly through the same live Session boundary', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-workbench-case1-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const definition = createAssemblyCatalog().get('case1')!
  const session = await createLiveSession({
    id: 'case1-live',
    title: 'CASE1 mobile assistant',
    cwd: directory,
    journalPath: join(directory, 'case1.jsonl'),
    assembly: definition,
    defaultConfiguration: {
      inference: { providerProfileId: 'mock', provider: 'openai-compatible', model: 'mock-mobile' },
    },
    llm: {
      async generate() {
        return {
          generated: { content: '手电筒已打开。', toolCalls: [] },
          usage: { inputTokens: 40, outputTokens: 8, totalTokens: 48, contextWindow: 4096 },
        }
      },
    },
  })
  const events: LiveSessionEvent[] = []
  const idle = new Promise<void>(resolve => {
    session.subscribe!(event => {
      events.push(event)
      if (event.kind === 'state.changed' && event.runState === 'idle') resolve()
    })
  })
  session.submit!('请打开手电筒')
  await idle

  const snapshot = await session.snapshot()
  assert.equal(snapshot.session.assembly, 'case1')
  assert.equal(snapshot.session.model, 'mock-mobile')
  assert.equal(snapshot.events.some(event => event.type === 'tool.result'), true)
  assert.equal(snapshot.events.some(event => event.type === 'assistant.message'
    && (event.data as { content?: string }).content === '手电筒已打开。'), true)
  assert.equal(events.some(event => event.kind === 'journal.changed'), true)
})
