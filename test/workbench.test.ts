import assert from 'node:assert/strict'
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createWorkbenchServer } from '../src/workbench/http-server.js'
import { JournalReadError, readJournalSnapshot } from '../src/workbench/read-journal.js'
import { storedSession } from '../src/workbench/stored-session.js'
import { createAssemblyCatalog } from '../src/workbench/assembly-catalog.js'
import { IMAGE_LIMITS } from '../src/workbench/attachments.js'

test('session reads have no retained history; missing live logs are empty, stored logs remain errors', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-session-read-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'session.jsonl')
  const session = storedSession({ id: 's', assembly: 'case2', journalPath: path })
  await assert.rejects(() => session.snapshot(), /source was not found/)
  assert.equal((await readJournalSnapshot(path, {}, 'empty')).eventCount, 0)
  await writeFile(path, JSON.stringify({ type: 'note', data: 'first' }) + '\n')
  const first = await session.snapshot()
  await appendFile(path, JSON.stringify({ type: 'note', data: 'second' }) + '\n')
  assert.equal((await session.snapshot()).events.length, 2)
  assert.equal(first.events.length, 1)
  await writeFile(path, JSON.stringify({ type: 'note', data: 'replacement' }) + '\n')
  assert.equal((await session.snapshot()).events[0]?.data, 'replacement')
})

test('owned Session history passes the import reader limits without weakening bounded imports', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-large-history-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'large.jsonl')
  await writeFile(path, JSON.stringify({ type: 'tool.result', data: 'x'.repeat(8 * 1024 * 1024) }) + '\n')
  await assert.rejects(() => readJournalSnapshot(path), /read limit/)
  const session = storedSession({ id: 'large', assembly: 'case2', journalPath: path })
  assert.equal((await session.snapshot()).events.length, 1)
  await writeFile(path, (JSON.stringify({ type: 'note', data: null }) + '\n').repeat(20_001))
  await assert.rejects(() => readJournalSnapshot(path), /event read limit/)
  assert.equal((await session.snapshot()).events.length, 20_001)
})

test('HTTP deltas preserve positions and plugin analytics works without Studio', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-delta-http-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'session.jsonl')
  await writeFile(path, JSON.stringify({ type: 'user.message', data: { content: 'Hello' } }) + '\n')
  const server = createWorkbenchServer({
    assemblies: createAssemblyCatalog(),
    sessions: [storedSession({ id: 's', assembly: 'case2', journalPath: path })],
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/workbench/sessions/s`
  const get = async (suffix: string) => (await fetch(base + suffix)).json()
  assert.equal((await get('')).events.length, 1)
  assert.deepEqual((await get('?after=0')).events, [])
  await appendFile(path, JSON.stringify({ type: 'assistant.message', data: { content: 'Done' } }) + '\n')
  const delta = await get('?after=0')
  assert.equal(delta.after, 0); assert.equal(delta.session.eventCount, 2)
  assert.equal(delta.events[0].position, 1); assert.equal(delta.events.length, 1)
  assert.equal((await get('?after=99')).after, -1)
  assert.ok((await get('/analytics/plugins')).plugins.some((plugin: { id: string }) => plugin.id === 'coding-flow'))
  assert.equal((await fetch(base + '?after=wrong')).status, 400)
})

test('workbench reader returns ordered detached Journal events without changing the source', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-workbench-'))
  const path = join(directory, 'session.jsonl')
  const source = [
    JSON.stringify({ type: 'user.message', data: { content: '<script>not executable</script>' }, meta: { observedAt: '2026-09-17T10:00:00.000Z' } }),
    JSON.stringify({ type: 'assistant.message', data: { content: 'done' }, meta: { observedAt: '2026-09-17T10:00:01.250Z' } }),
    '',
  ].join('\n')
  await writeFile(path, source, 'utf8')
  t.after(() => rm(directory, { recursive: true, force: true }))

  const snapshot = await readJournalSnapshot(path)

  assert.equal(snapshot.source.name, 'session.jsonl')
  assert.equal(snapshot.source.readOnly, true)
  assert.deepEqual(snapshot.events, [
    { position: 0, type: 'user.message', data: { content: '<script>not executable</script>' }, observedAt: '2026-09-17T10:00:00.000Z' },
    { position: 1, type: 'assistant.message', data: { content: 'done' }, observedAt: '2026-09-17T10:00:01.250Z', elapsedMs: 1250 },
  ])
  assert.equal(await readFile(path, 'utf8'), source)
})

test('workbench reader rejects malformed and oversized sources explicitly', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-workbench-errors-'))
  const malformed = join(directory, 'malformed.jsonl')
  const oversized = join(directory, 'oversized.jsonl')
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(malformed, '{"type":"one","data":{}}\nnot-json\n', 'utf8')
  await writeFile(oversized, '{"type":"one","data":{}}\n', 'utf8')

  await assert.rejects(
    readJournalSnapshot(malformed),
    (error: unknown) => error instanceof JournalReadError
      && error.code === 'invalid_jsonl'
      && error.message.includes('line 2'),
  )
  await assert.rejects(
    readJournalSnapshot(oversized, { maxBytes: 1 }),
    (error: unknown) => error instanceof JournalReadError && error.code === 'source_too_large',
  )
})

test('workbench HTTP endpoint exposes only the configured read-only snapshot', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-workbench-http-'))
  const path = join(directory, 'session.jsonl')
  await writeFile(path, '{"type":"session.start","data":{}}\n', 'utf8')
  t.after(() => rm(directory, { recursive: true, force: true }))

  const server = createWorkbenchServer({ sessions: [storedSession({
    id: 'case2-main',
    projectId: 'case2',
    assembly: 'case2',
    journalPath: path,
  })] })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error === undefined ? resolve() : reject(error))
  }))
  const address = server.address()
  assert.notEqual(address, null)
  assert.equal(typeof address, 'object')
  if (address === null || typeof address === 'string') throw new Error('expected TCP address')

  const catalog = await fetch(`http://127.0.0.1:${address.port}/api/workbench/sessions`)
  assert.equal(catalog.status, 200)
  assert.deepEqual(await catalog.json(), { sessions: [{
    id: 'case2-main',
    title: 'New session',
    projectId: 'case2',
    assembly: 'case2',
    runState: 'completed',
    eventCount: 1,
    writable: false,
  }] })

  const response = await fetch(`http://127.0.0.1:${address.port}/api/workbench/sessions/case2-main`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/)
  assert.deepEqual(await response.json(), {
    session: {
      id: 'case2-main',
      imageLimits: IMAGE_LIMITS,
      title: 'New session',
      projectId: 'case2',
      assembly: 'case2',
      runState: 'completed',
      eventCount: 1,
      writable: false,
    },
    events: [{ position: 0, type: 'session.start', data: {} }],
  })

  const unknown = await fetch(`http://127.0.0.1:${address.port}/api/workbench/other`)
  assert.equal(unknown.status, 404)
})

test('workbench host serves the built web shell without changing API routing', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-workbench-web-'))
  await writeFile(join(directory, 'index.html'), '<main>Knot Workbench</main>', 'utf8')
  await writeFile(join(directory, 'app.js'), 'globalThis.knot = true', 'utf8')
  t.after(() => rm(directory, { recursive: true, force: true }))

  const server = createWorkbenchServer({ sessions: [], webRoot: directory })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error === undefined ? resolve() : reject(error))
  }))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected TCP address')
  const base = `http://127.0.0.1:${address.port}`

  const shell = await fetch(`${base}/sessions/case2`)
  assert.equal(shell.status, 200)
  assert.match(shell.headers.get('content-type') ?? '', /^text\/html/)
  assert.equal(await shell.text(), '<main>Knot Workbench</main>')
  const asset = await fetch(`${base}/app.js`)
  assert.match(asset.headers.get('content-type') ?? '', /^text\/javascript/)
  const api = await fetch(`${base}/api/workbench/sessions`)
  assert.deepEqual(await api.json(), { sessions: [] })
})
