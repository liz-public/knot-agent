import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createWorkbenchServer } from '../src/workbench/http-server.js'
import { loadSessionDescriptors, saveSessionDescriptor, sessionWithMetadata } from '../src/workbench/session-catalog.js'
import { createSessionRegistry } from '../src/workbench/session-registry.js'
import type { WorkbenchSession } from '../src/workbench/session.js'
import { storedSession } from '../src/workbench/stored-session.js'

test('rename uses Journal title facts; archive and pin remain Host metadata, including readonly sessions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-session-management-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const descriptor = { id: 'session', title: 'Original', cwd: directory,
    journalPath: join(directory, 'session.jsonl'), assembly: 'case2', parentSessionId: 'parent' }
  const journal = '{"type":"user.message","data":{"content":"hello"}}\n'
  await writeFile(descriptor.journalPath, journal)
  await saveSessionDescriptor(directory, descriptor)
  let stops = 0
  const stored = storedSession({ ...descriptor, workspace: directory })
  const runtime: WorkbenchSession = {
    ...stored,
    summary: async () => ({ ...await stored.summary(), runState: 'running', writable: true }),
    pause: () => { stops++ },
  }
  const session = sessionWithMetadata(directory, descriptor, runtime)
  const registry = createSessionRegistry([session])
  let notifications = 0
  registry.subscribe(() => notifications++)
  const server = createWorkbenchServer({ sessions: [], sessionRegistry: registry })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/workbench/sessions`
  const patch = async (body: unknown, id = 'session') => {
    const response = await fetch(`${base}/${id}`, { method: 'PATCH',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, value: await response.json() as any }
  }
  const renamed = await patch({ title: '  My session  ' })
  assert.equal(renamed.status, 200)
  assert.equal(renamed.value.session.title, 'My session')
  assert.ok(renamed.value.session.titleVersion > 0)
  await Promise.all([patch({ title: 'Final title' }), patch({ pinned: true })])
  assert.equal((await session.summary()).title, 'Final title')
  assert.ok((await session.summary()).pinnedAt)
  const firstPin = (await session.summary()).pinnedAt
  await patch({ pinned: true })
  assert.equal((await session.summary()).pinnedAt, firstPin)
  const archived = await patch({ archived: true })
  assert.equal(archived.value.session.archived, true)
  assert.equal(archived.value.session.pinnedAt, 0)
  assert.equal(archived.value.session.runState, 'running')
  assert.equal(stops, 0)
  assert.equal((await patch({ pinned: true })).status, 400)
  assert.equal((await patch({ title: ' ' })).status, 400)
  assert.equal((await patch({ archived: 'yes' })).status, 400)
  assert.equal((await patch({ model: 'not-metadata' })).status, 400)
  assert.equal((await patch({ pinned: true }, 'missing')).status, 404)
  assert.equal((await session.summary()).archived, true)
  assert.equal((await session.snapshot()).session.title, 'Final title')
  const renamedJournal = await readFile(descriptor.journalPath, 'utf8')
  assert.ok(renamedJournal.startsWith(journal))
  assert.equal(renamedJournal.trim().split('\n').length, 3)
  const [saved] = await loadSessionDescriptors(directory)
  assert.equal(saved!.parentSessionId, 'parent')
  assert.doesNotMatch(await readFile(join(directory, 'session.session.json'), 'utf8'), /"title"|titleVersion/)
  const restored = sessionWithMetadata(directory, saved!, storedSession({ ...saved!, workspace: directory }))
  assert.equal((await restored.summary()).title, 'Final title')
  assert.equal((await restored.summary()).archived, true)
  assert.equal((await restored.summary()).writable, false)
  await restored.updateMetadata!({ archived: false })
  await restored.updateMetadata!({ pinnedAt: 42 })
  await restored.updateMetadata!({ pinnedAt: 0 })
  assert.equal((await loadSessionDescriptors(directory))[0]!.archived, undefined)
  assert.equal((await loadSessionDescriptors(directory))[0]!.pinnedAt, undefined)
  assert.equal(await readFile(descriptor.journalPath, 'utf8'), renamedJournal)
  assert.equal(notifications, 5)
})

test('failed archive/pin persistence keeps product metadata unchanged and permits retry', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-session-metadata-failure-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const descriptor = { id: 's', title: 'original', cwd: directory, journalPath: join(directory, 's.jsonl'), assembly: 'case2' }
  await writeFile(descriptor.journalPath, JSON.stringify({ type: 'session.title.configured', data: { title: 'original', source: 'user' } }) + '\n')
  const session = sessionWithMetadata(join(directory, 'blocked'), descriptor, storedSession(descriptor))
  await writeFile(join(directory, 'blocked'), 'not a directory')
  await assert.rejects(session.updateMetadata!({ pinnedAt: 42 }))
  assert.equal((await session.summary()).title, 'original')
  await rm(join(directory, 'blocked'))
  assert.equal((await session.summary()).pinnedAt, 0)
  await session.updateMetadata!({ pinnedAt: 42 })
  assert.equal((await session.summary()).pinnedAt, 42)
})
