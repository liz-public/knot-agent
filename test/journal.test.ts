import assert from 'node:assert/strict'
import test from 'node:test'
import { createJournal } from '../src/journal.js'

test('events are breadth-first and subscribers run in registration order', async () => {
  const calls: string[] = []
  const { journal, runUntilIdle } = createJournal()

  journal.subscribe('root', () => {
    calls.push('first')
    journal.append('left', {})
  })
  journal.subscribe('root', () => {
    calls.push('second')
    journal.append('right', {})
  })
  journal.subscribe('left', event => {
    calls.push(event.type)
  })
  journal.subscribe('right', event => {
    calls.push(event.type)
  })

  journal.append('root', {})
  await runUntilIdle()

  assert.deepEqual(calls, ['first', 'second', 'left', 'right'])
  assert.deepEqual(journal.read().map(event => event.type), ['root', 'left', 'right'])
})

test('a wildcard subscriber holds its registration position', async () => {
  const calls: string[] = []
  const { journal, runUntilIdle } = createJournal()

  journal.subscribe('ping', () => {
    calls.push('before')
  })
  journal.subscribe('*', () => {
    calls.push('wildcard')
  })
  journal.subscribe('ping', () => {
    calls.push('after')
  })

  journal.append('ping', {})
  await runUntilIdle()

  assert.deepEqual(calls, ['before', 'wildcard', 'after'])
})

test('an event with no subscriber is legal and stays in the journal', async () => {
  const { journal, runUntilIdle } = createJournal()

  journal.append('nobody.listens', { kept: true })
  await runUntilIdle()

  assert.deepEqual(journal.read().map(event => event.type), ['nobody.listens'])
})

test('a failing handler aborts the drain and propagates unchanged', async () => {
  const delivered: string[] = []
  const { journal, runUntilIdle } = createJournal()
  const failure = new Error('handler exploded')

  journal.subscribe('boom', () => {
    throw failure
  })
  journal.subscribe('later', () => {
    delivered.push('later')
  })

  journal.append('boom', {})
  journal.append('later', {})

  await assert.rejects(runUntilIdle(), error => error === failure)
  assert.deepEqual(delivered, [])
})

test('a drain resumes at the first undelivered event', async () => {
  const delivered: string[] = []
  const { journal, runUntilIdle } = createJournal()
  journal.subscribe('*', event => {
    delivered.push(event.type)
  })

  journal.append('one', {})
  await runUntilIdle()
  journal.append('two', {})
  await runUntilIdle()

  assert.deepEqual(delivered, ['one', 'two'])
})

test('a nested drain is rejected instead of corrupting delivery', async () => {
  const { journal, runUntilIdle } = createJournal()
  let nested: unknown
  journal.subscribe('start', async () => {
    nested = await runUntilIdle().catch((error: unknown) => error)
  })

  journal.append('start', {})
  await runUntilIdle()

  assert.match(String(nested), /already draining/)
})

test('a subscriber registered during delivery starts at the next event', async () => {
  const late: string[] = []
  const { journal, runUntilIdle } = createJournal()

  journal.subscribe('start', () => {
    journal.subscribe('*', event => {
      late.push(event.type)
    })
    journal.append('follow-up', {})
  })

  journal.append('start', {})
  await runUntilIdle()

  assert.deepEqual(late, ['follow-up'])
})

test('the event envelope cannot be replaced in place', () => {
  const { journal } = createJournal()
  const event = journal.append('frozen', { value: 1 })

  assert.throws(() => {
    ;(event as { type: string }).type = 'tampered'
  })
})
