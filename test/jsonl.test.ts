import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createJournal } from '../src/journal.js'
import { JSONL_LOAD, jsonlLoadPlugin, jsonlStorePlugin } from '../src/plugins/jsonl.js'

test('JSONL storage restores history without replaying it to later subscribers', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-jsonl-'))
  const path = join(directory, 'session.jsonl')
  t.after(() => rm(directory, { recursive: true, force: true }))

  const first = createJournal()
  jsonlStorePlugin(path)(first.journal)
  first.journal.append('one', { value: 1 })
  first.journal.append('two', { value: 2 })
  await first.runUntilIdle()

  const second = createJournal()
  jsonlLoadPlugin(path)(second.journal)
  second.journal.append(JSONL_LOAD, {})
  await second.runUntilIdle()

  let handled = 0
  jsonlStorePlugin(path)(second.journal)
  second.journal.subscribe('*', () => {
    handled += 1
  })
  second.journal.append('three', { value: 3 })
  await second.runUntilIdle()

  assert.deepEqual(second.journal.read().map(event => event.type), [
    JSONL_LOAD,
    'one',
    'two',
    'three',
  ])
  assert.equal(handled, 1)
  assert.equal((await readFile(path, 'utf8')).trim().split('\n').length, 3)
})
