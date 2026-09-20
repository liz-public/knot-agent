import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createAssemblyCatalog } from '../src/workbench/assembly-catalog.js'
import { createLiveSession } from '../src/workbench/live-session.js'
import type { LiveSessionEvent } from '../src/workbench/session.js'

test('assembly catalog exposes CASE1 and CASE2 from their executable definitions', () => {
  const catalog = createAssemblyCatalog()
  assert.deepEqual(catalog.list().map(item => item.description.id), ['case1', 'case2'])
  assert.deepEqual(catalog.get('case1')?.description.tools.map(tool => tool.name), ['bash'])
  assert.deepEqual(catalog.get('case2')?.description.tools.map(tool => tool.name), [
    'read', 'write', 'edit', 'bash', 'todo.write', 'goal.write', 'spawn_agent', 'ask',
  ])
  assert.equal(catalog.get('missing'), undefined)
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
    assembly: definition.create({
      model: 'mock-mobile',
      llm: {
        async generate() {
          return {
            generated: { content: '手电筒已打开。', toolCalls: [] },
            usage: { inputTokens: 40, outputTokens: 8, totalTokens: 48, contextWindow: 4096 },
          }
        },
      },
    }),
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
