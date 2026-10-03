import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWorkbenchRemote } from '../src/workbench-remote.ts'

test('carrier reads Knot snapshots, exposes child history and refuses all writes', async () => {
  const reads: string[] = []
  const sessions = [
    { id: 'parent', title: 'Parent', assembly: 'case2', workspace: '/test', eventCount: 1, runState: 'idle', writable: true },
    { id: 'child', title: 'Child', assembly: 'case2', workspace: '/test', parentSessionId: 'parent', eventCount: 1, runState: 'idle', writable: true },
  ]
  const remote = createWorkbenchRemote((async (url: string, options?: RequestInit) => {
    assert.equal(options?.method, undefined)
    reads.push(url)
    return Response.json(url.endsWith('/sessions') ? { sessions } : {
      session: sessions.find(session => url.endsWith(session.id)),
      events: [{ position: 0, type: 'user.message', data: { turnId: 't1', content: url.endsWith('child') ? 'Child text' : 'Parent text' } }],
    })
  }) as typeof fetch)
  const control = new AbortController()
  const call = (endpoint: string, args: unknown) => remote.call('$control', endpoint, { args: [args] }, control.signal)
  const listing = await call('session/list', {}) as any
  assert.equal(listing.value.items[1].parentSessionId, 'parent')
  const projections = await call('session/projections', { sessionId: 'parent' }) as any
  assert.equal(projections.value.values.subagentCatalog[0].id, 'child')
  const stream = remote.open('$session', 'session/follow', { args: [{ address: {
    kind: 'subagent', parentSessionId: 'parent', childSessionId: 'child', mode: 'unknown',
  } }] }, control.signal)
  const frame = (await stream.next()).value as any
  assert.equal(frame.header.id, 'child')
  assert.equal(frame.records.find((record: any) => record.event.type === 'user/message').event.data.content[0].text, 'Child text')
  const before = reads.length
  for (const endpoint of ['session/create', 'session/send', 'settings/update', 'permission/resolve']) {
    const response = await call(endpoint, {}) as any
    assert.equal(response.ok, false)
    assert.equal(response.error.code, 'knot/read-only')
  }
  assert.equal(reads.length, before)
  control.abort()
  await stream.return?.()
})
