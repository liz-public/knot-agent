import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createCase1Assembly } from '../src/workbench/case1-assembly.js'
import { createToolDispatcher } from '../src/cases/case1/dispatcher.js'
import { createLiveSession } from '../src/workbench/live-session.js'

test('Workbench case1 uses the selected runtime for each session without changing catalog or approval', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-case1-runtime-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let created = 0, executed = 0
  const assembly = createCase1Assembly(() => {
    created++
    return { dispatcher: createToolDispatcher({
      set_flashlight: () => { executed++; return { content: '{"ok":true}' } },
    }) }
  })
  for (const id of ['one', 'two']) {
    const session = await createLiveSession({ id, cwd: directory, journalPath: join(directory, id + '.jsonl'), assembly,
      llm: { async generate() { return { generated: { content: 'Done', toolCalls: [] },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, contextWindow: 1000 } } } },
    })
    const idle = new Promise<void>(resolve => session.subscribe!(event => {
      if (event.kind === 'state.changed' && event.runState === 'idle') resolve()
    }))
    session.submit!('打开手电筒')
    await idle
    const events = (await session.snapshot()).events
    assert.equal(events.filter(event => event.type === 'tool.registry').length, 1)
    assert.equal(events.filter(event => event.type === 'tool.result').length, 1)
  }
  assert.equal(created, 2)
  assert.equal(executed, 2)
})
