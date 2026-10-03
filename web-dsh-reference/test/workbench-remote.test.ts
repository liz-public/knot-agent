import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWorkbenchRemote } from '../src/workbench-remote.ts'

test('carrier reads Knot snapshots, exposes child history and refuses unconnected actions', async () => {
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
  }) as typeof fetch, () => () => {})
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
  for (const endpoint of ['session/send', 'settings/update', 'permission/resolve']) {
    const response = await call(endpoint, {}) as any
    assert.equal(response.ok, false)
    assert.equal(response.error.code, 'knot/unconnected')
  }
  assert.equal(reads.length, before)
  control.abort()
  await stream.return?.()
})

test('B2 changes pending configuration through Host, preserving unrelated choices', async () => {
  let session: any = { id: 's', title: 'test', assembly: 'case2', providerProfileId: 'one', model: 'm',
    reasoningEffort: 'low', approvalMode: 'ask', writable: true, runState: 'idle', eventCount: 2 }
  const profiles = [{ id: 'one', model: 'm', adapter: 'deepseek', configured: true },
    { id: 'two', model: 'm', adapter: 'deepseek', configured: true, defaultReasoningEffort: 'high' }]
  const writes: any[] = []
  const remote = createWorkbenchRemote((async (url: string, options?: RequestInit) => {
    if (url.endsWith('/providers')) return Response.json({ providers: profiles })
    if (url.endsWith('/configuration')) {
      writes.push(JSON.parse(options!.body as string)); session = { ...session, ...writes.at(-1) }
      return Response.json({ session })
    }
    return Response.json({ session, events: [] })
  }) as typeof fetch)
  const call = (input: unknown) => remote.call('$knot', 'knot/session/configure', { args: [input] })
  assert.equal((await call({ sessionId: 's', approvalMode: 'auto' }) as any).ok, true)
  assert.deepEqual(writes[0], { providerProfileId: 'one', reasoningEffort: 'low', approvalMode: 'auto' })
  await call({ sessionId: 's', providerProfileId: 'two' })
  assert.deepEqual(writes[1], { providerProfileId: 'two', reasoningEffort: 'high', approvalMode: 'auto' })
  await call({ sessionId: 's', reasoningEffort: '' })
  assert.deepEqual(writes[2], { providerProfileId: 'two', approvalMode: 'auto' })
  assert.equal(session.eventCount, 2)
  session.runState = 'running'
  assert.equal((await call({ sessionId: 's', approvalMode: 'ask' }) as any).ok, false)
  assert.equal(writes.length, 3)
})

test('B2 catalog, provider management and explicit Assembly creation use existing HTTP routes', async () => {
  const writes: any[] = []
  const session = { id: 'new', title: 'New', assembly: 'case1', workspace: '/mock', eventCount: 2, runState: 'idle' }
  const remote = createWorkbenchRemote((async (url: string, options?: RequestInit) => {
    if (!options?.method) {
      if (url.endsWith('/providers')) return Response.json({ providers: [{ id: 'profile', label: 'Public', configured: true }] })
      if (url.endsWith('/studio')) return Response.json({ projects: [{ assembly: { id: 'case1', title: 'Mobile' } }, { assembly: { id: 'case1', title: 'Mobile' } }] })
      return Response.json({ sessions: [session] })
    }
    writes.push({ url, method: options.method, body: options.body ? JSON.parse(options.body as string) : undefined })
    return Response.json(url.endsWith('/sessions') ? { session } : { provider: { id: 'profile' } })
  }) as typeof fetch)
  const call = (endpoint: string, args: unknown = {}) => remote.call('$knot', endpoint, { args: [args] }) as Promise<any>
  const catalog = (await call('knot/catalog')).value
  assert.equal(catalog.assemblies.length, 1)
  assert.equal(catalog.providers[0].apiKey, undefined)
  const controller = new AbortController()
  const stream = remote.open('$control', '$events', {}, controller.signal)
  assert.equal((await stream.next()).value.type, 'ready')
  const next = stream.next()
  const input = { assemblyId: 'case1', cwd: '/mock', providerProfileId: 'profile', approvalMode: 'ask', title: 'New' }
  assert.equal((await call('knot/session/create', input)).value.id, 'new')
  assert.deepEqual(writes[0].body, input)
  assert.equal((await next).value.event, 'api-session/added')
  await call('knot/providers/save', { label: 'Test', adapter: 'deepseek', model: 'm', apiKey: 'test-only' })
  await call('knot/providers/save', { id: 'profile', label: 'Updated', adapter: 'deepseek', model: 'm' })
  for (const action of ['test', 'default', 'delete']) await call('knot/providers/' + action, { id: 'profile' })
  assert.deepEqual(writes.map(item => item.method), ['POST', 'POST', 'PATCH', 'POST', 'POST', 'DELETE'])
  assert.equal(writes[2].body.id, undefined)
  assert.equal(writes[3].url, '/api/workbench/providers/profile/test')
  assert.equal(writes[4].url, '/api/workbench/providers/profile/default')
  controller.abort(); await stream.return?.()
})

test('B2 does not disguise Host failure as successful configuration', async () => {
  const remote = createWorkbenchRemote((async () => Response.json({ error: { message: 'Provider is in use' } }, { status: 400 })) as typeof fetch)
  const result = await remote.call('$knot', 'knot/providers/delete', { args: [{ id: 'p' }] }) as any
  assert.equal(result.ok, false)
  assert.match(result.error.message, /Provider is in use/)
})
