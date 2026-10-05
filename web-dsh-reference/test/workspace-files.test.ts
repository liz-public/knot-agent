import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createWorkbenchRemote } from '../src/workbench-remote.ts'

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
