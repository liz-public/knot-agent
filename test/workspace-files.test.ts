import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createWorkbenchServer } from '../src/workbench/http-server.js'
import type { WorkbenchSession } from '../src/workbench/session.js'

test('workspace HTTP is Session-scoped, read-only, lazy and paged for native file views', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-files-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const workspace = join(directory, 'workspace')
  await mkdir(workspace)
  await mkdir(join(workspace, 'src'))
  await writeFile(join(workspace, 'README.md'), '# Hello\n中文\nlast')
  await writeFile(join(directory, 'outside.txt'), 'private')
  await symlink(join(directory, 'outside.txt'), join(workspace, 'outside-link'))
  await writeFile(join(workspace, 'binary'), Buffer.from([0, 255]))
  await writeFile(join(workspace, 'long'), 'a'.repeat(256 * 1024 + 1))
  const summary = { id: 's', title: 'S', assembly: 'case2', workspace, writable: true, runState: 'idle' as const, eventCount: 0 }
  const session: WorkbenchSession = { id: 's', summary: async () => summary,
    snapshot: async () => { throw new Error('File browsing must not load Journal history') } }
  const other: WorkbenchSession = { ...session, id: 'other', summary: async () => ({ ...summary, id: 'other', workspace: directory }) }
  const server = createWorkbenchServer({ sessions: [session, other] })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/workbench/sessions/`
  const get = async (action: string, path: string, range = '') => {
    const response = await fetch(base + 's/files/' + action + '?path=' + encodeURIComponent(path) + range)
    return { status: response.status, value: await response.json() }
  }
  const listing = (await get('list', '')).value
  assert.ok(listing.entries.some((entry: any) => entry.name === 'src' && entry.type === 'directory'))
  const first = (await get('read', 'README.md', '&limit=2')).value
  assert.equal(first.text, '# Hello\n中文'); assert.equal(first.lines, 2); assert.equal(first.eof, false)
  const last = (await get('read', join(workspace, 'README.md'), '&offset=3&limit=2')).value
  assert.equal(last.text, 'last'); assert.equal(last.eof, true)
  assert.equal((await get('read', 'README.md', '&offset=9')).value.lines, 0)
  assert.equal((await get('stat', 'README.md')).value.version, first.version)
  for (const path of ['../outside.txt', join(directory, 'outside.txt'), 'outside-link']) {
    assert.equal((await get('read', path)).value.error.code, 'workspace-file/outside-workspace')
  }
  assert.equal((await get('read', 'binary')).value.error.code, 'workspace-file/not-text')
  assert.equal((await get('read', 'long')).value.error.code, 'workspace-file/too-large')
  assert.equal((await get('read', 'README.md', '&offset=0')).status, 400)
  assert.equal((await get('read', 'missing')).status, 404)
  assert.equal((await fetch(base + 'missing/files/list')).status, 404)
  assert.equal((await (await fetch(base + 'other/files/read?path=outside.txt')).json()).text, 'private')
  assert.equal((await fetch(base + 's/files/read', { method: 'POST' })).status, 404)
  await writeFile(join(workspace, 'README.md'), 'new content\n')
  assert.equal((await get('read', 'README.md')).value.text, 'new content')
  assert.equal((await get('read', 'README.md')).value.lines, 1)
})
