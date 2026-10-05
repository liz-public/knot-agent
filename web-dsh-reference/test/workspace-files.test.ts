import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createWorkbenchRemote } from '../src/workbench-remote.ts'
import { formatFileMention } from '@deepseek-ai/dsh-file-reference/grammar'

test('native @ file candidates reuse one bounded directory read, scoped to the Session, with no contents or Journal reads', async () => {
  const reads: string[] = []
  const remote = createWorkbenchRemote((async (url: string, options?: RequestInit) => {
    reads.push(url)
    assert.equal(options?.method, undefined)
    const path = new URL(url, 'http://test').searchParams.get('path')
    return Response.json({ path: path?.replace(/\/$/, '') ?? '', absolutePath: '/workspace/' + (path ?? ''), entries: [
      { name: 'README.md', type: 'file' }, { name: 'read me.md', type: 'file' },
      { name: 'src', type: 'directory' }, { name: 'link', type: 'other' },
    ] })
  }) as typeof fetch)
  const list = async (query: string, agentId = 'session id') => {
    const response = await remote.call('$native', 'fileReferences/list', { args: [{ agentId, query }] }) as any
    assert.equal(response.ok, true)
    return response.value
  }
  assert.deepEqual(await list(''), [
    { path: '/workspace/README.md', kind: 'file' }, { path: '/workspace/read me.md', kind: 'file' }, { path: 'src', kind: 'directory' },
  ])
  assert.deepEqual(await list('READ'), [{ path: '/workspace/README.md', kind: 'file' }, { path: '/workspace/read me.md', kind: 'file' }])
  assert.deepEqual(await list('src/read', 'other'), [{ path: '/workspace/src/README.md', kind: 'file' }, { path: '/workspace/src/read me.md', kind: 'file' }])
  assert.equal(reads.length, 3)
  assert.equal(reads[0], '/api/workbench/sessions/session%20id/files/list?path=')
  assert.equal(reads[2], '/api/workbench/sessions/other/files/list?path=src%2F')
  assert.equal(formatFileMention({ path: '/workspace/src/read me.md', kind: 'file' }, false), '@"/workspace/src/read me.md"')
  assert.equal(formatFileMention({ path: 'src', kind: 'directory' }, false), '@src/')
  const before = reads.length
  const sessions = await remote.call('$native', 'sessionReferenceResolver/candidates', { args: [{ agentId: 'other', query: '' }] }) as any
  assert.equal(sessions.ok, false)
  assert.equal(sessions.error.code, 'knot/unconnected')
  assert.equal(reads.length, before)
})

test('file reference discovery preserves cancellation and never disguises Host rejection as successful candidates', async () => {
  const control = new AbortController()
  const remote = createWorkbenchRemote((async (_url: string, options?: RequestInit) => {
    assert.equal(options?.signal, control.signal)
    return Response.json({ error: { code: 'workspace-file/outside-workspace', message: 'Outside workspace' } }, { status: 400 })
  }) as typeof fetch)
  const response = await remote.call('$native', 'fileReferences/list', { args: [{ agentId: 's', query: '../' }] }, control.signal) as any
  assert.equal(response.ok, false)
  assert.match(response.error.message, /Outside workspace/)
})

test('native file selection sends the concrete Host path, not a basename, without reading the file into the prompt', async () => {
  const requests: string[] = [], messages: string[] = []
  const remote = createWorkbenchRemote((async (url: string, options?: RequestInit) => {
    requests.push(url)
    if (url.includes('/files/list?')) return Response.json({ path: '', absolutePath: '/workspace/real path',
      entries: [{ name: 'README.md', type: 'file' }] })
    if (url.endsWith('/messages')) {
      messages.push(JSON.parse(options!.body as string).content)
      return Response.json({ accepted: true })
    }
    return Response.json({ session: { id: 's', writable: true, runState: 'idle' }, events: [] })
  }) as typeof fetch)
  const candidates = await remote.call('$native', 'fileReferences/list', { args: [{ agentId: 's', query: 'READ' }] }) as any
  const ref = formatFileMention(candidates.value[0], false)
  const result = await remote.call('$native', 'session/prompt', { args: [{ sessionId: 's', requestId: 'input-1',
    content: [{ type: 'text', text: `看下 ${ref}` }], mode: 'queue' }] }) as any
  assert.equal(result.ok, true)
  assert.deepEqual(messages, ['看下 @"/workspace/real path/README.md"'])
  assert.ok(!requests.some(url => url.includes('/files/read')))
})

test('native workspace RPC carries Session identity, range, and typed failures without Journal reads', async () => {
  const paths: string[] = []
  const remote = createWorkbenchRemote((async (url: string) => {
    paths.push(url)
    return url.includes('missing')
      ? Response.json({ error: { code: 'workspace-file/not-found', message: 'Missing' } }, { status: 404 })
      : Response.json({ text: 'Hello', offset: 201, lines: 1, eof: true, absolutePath: '/workspace/a.ts', version: 'v' })
  }) as typeof fetch, () => () => {})
  for (const endpoint of ['read', 'stat', 'list']) {
    const result = await remote.call('$test', 'workspaceFiles/' + endpoint, { args: [{
      workspaceFileScopeId: 'session id', path: 'a.ts', ...(endpoint === 'read' ? { range: { offset: 201 } } : {}),
    }] }) as any
    assert.equal(result.ok, true)
    assert.ok(paths.at(-1)!.startsWith('/api/workbench/sessions/session%20id/files/' + endpoint + '?'))
  }
  assert.ok(paths[0]!.includes('offset=201'))
  const result = await remote.call('$test', 'workspaceFiles/read', { args: [{ workspaceFileScopeId: 's', path: 'missing' }] }) as any
  assert.equal(result.error.code, 'workspace-file/not-found')
  await assert.rejects(async () => {
    for await (const _ of remote.open('$test', 'workspaceFiles/changes', { args: [{ workspaceFileScopeId: 's', path: '' }] }, new AbortController().signal)) {}
  }, { code: 'workspace-file/watch-unsupported' })
})

test('input dock does not duplicate live Bash output; native final tool cards stay wired', () => {
  const configuration = readFileSync(new URL('../src/configuration-client.tsx', import.meta.url), 'utf8')
  assert.ok(!configuration.includes('knot-runtime-tool'))
  assert.ok(!configuration.includes("event.kind === 'tool.update'"))
  const business = readFileSync(new URL('../src/business-client.tsx', import.meta.url), 'utf8')
  assert.ok(business.includes("['bash', 'bash']"))
})
