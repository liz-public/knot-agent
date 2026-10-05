import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkbenchRemote } from '../src/workbench-remote.ts'

test('native rename, pin, archive and restore use Host metadata with native stream echoes', async () => {
  let notify: (() => void) | undefined
  const session: any = { id: 's', title: 'Original', assembly: 'case2', workspace: '/test',
    eventCount: 0, runState: 'idle', writable: true }
  const writes: any[] = []
  const remote = createWorkbenchRemote((async (url: string, options?: RequestInit) => {
    if (options?.method) {
      assert.equal(url, '/api/workbench/sessions/s')
      assert.equal(options.method, 'PATCH')
      const body = JSON.parse(options.body as string)
      writes.push(body)
      if (body.title === '') return Response.json({ error: { message: 'Invalid title' } }, { status: 400 })
      if (body.title !== undefined) { session.title = body.title.trim(); session.titleVersion = (session.titleVersion ?? 1000) + 1 }
      if (body.archived !== undefined) session.archived = body.archived
      if (body.pinned !== undefined) session.pinnedAt = body.pinned ? 42 : 0
      if (session.archived) session.pinnedAt = 0
      return Response.json({ session })
    }
    assert.equal(url, '/api/workbench/sessions')
    return Response.json({ sessions: [session] })
  }) as typeof fetch, () => () => {}, listener => { notify = listener; return () => { notify = undefined } })
  const controller = new AbortController()
  const open = (endpoint: string) => remote.open('$control', endpoint, {}, controller.signal)
  const events = open('$events'), workspace = open('workspace/follow'), control = open('session/control')
  await events.next()
  assert.deepEqual((await workspace.next()).value, { type: 'baseline', value: {
    items: [{ workspaceId: '/test', path: '/test', title: 'test', sessionIds: ['s'],
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() }],
    archivedSessionIds: [], pinnedSessionIds: [],
  } })
  await control.next()
  const call = (endpoint: string, input: object = {}) => remote.call('$control', endpoint,
    { args: [{ sessionId: 's', ...input }] }, controller.signal) as Promise<any>
  const renamed = await call('session/rename', { title: '  Renamed  ' })
  assert.deepEqual(renamed.value, { title: 'Renamed', seq: 1001 })
  const added = (await events.next()).value
  assert.equal(added.args[0].blank, false)
  // Native forwarded events require lossless JSON: optional fields must be absent, not undefined.
  assert.deepEqual(added, JSON.parse(JSON.stringify(added)))
  assert.deepEqual((await control.next()).value, { type: 'projection', sessionId: 's', key: 'title', value: 'Renamed', seq: 1001 })
  assert.deepEqual((await call('workspace/pinSession')).value, { pinnedSessionIds: ['s'] })
  assert.deepEqual((await call('workspace/archiveSession')).value, { archivedSessionIds: ['s'] })
  assert.equal(session.pinnedAt, 0)
  assert.deepEqual((await call('workspace/unarchiveSession')).value, { archivedSessionIds: [] })
  await call('workspace/pinSession')
  assert.deepEqual((await call('workspace/unpinSession')).value, { pinnedSessionIds: [] })
  assert.deepEqual(writes.slice(1), [{ pinned: true }, { archived: true }, { archived: false }, { pinned: true }, { pinned: false }])
  assert.equal((await call('session/rename', { title: '' })).ok, false)
  const before = writes.length
  assert.equal((await call('workspace/archiveSession', { stopActivity: true })).ok, false)
  assert.equal(writes.length, before) // never claim to stop when only archiving
  // Another Client changed metadata: the Host catalog signal also updates existing rows.
  session.title = 'Other Client'; session.titleVersion = 2000; session.archived = true
  notify!()
  let found = false
  for (let i = 0; i < 6; i++) {
    const frame = (await control.next()).value
    if (frame.value === 'Other Client') { found = true; assert.equal(frame.seq, 2000); break }
  }
  assert.equal(found, true)
  controller.abort()
  await Promise.all([events.return?.(), workspace.return?.(), control.return?.()])
  assert.equal(notify, undefined)
  const restored = remote.open('$control', 'workspace/follow', {}, new AbortController().signal)
  assert.deepEqual((await restored.next()).value.value.archivedSessionIds, ['s'])
  await restored.return?.()
})
