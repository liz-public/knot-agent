import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createWorkbenchRemote } from '../src/workbench-remote.ts'
import { projectKnotSnapshot } from '../src/knot-journal-projection.ts'

test('native history carries public file/image references, not Host paths or pixel bytes', () => {
  const image = { kind: 'image', attachmentId: 'sha256:image', name: 'a.webp', bytes: 3,
    path: '/workspace/.knot/attachments/s/a.webp', mediaType: 'image/webp', width: 1, height: 1 }
  const file = { kind: 'file', attachmentId: 'sha256:file', name: 'a.txt', bytes: 4, path: '/workspace/.knot/attachments/s/a.txt' }
  const projected = projectKnotSnapshot({ session: { id: 's', assembly: 'case2', title: 's', eventCount: 1, writable: true, runState: 'idle' },
    events: [{ position: 0, type: 'user.message', data: { turnId: 't', content: '', attachments: [file, image] } }] })
  const user = projected.records.find(record => record.event.type === 'user/message')!
  const { kind: _fileKind, path: _filePath, ...fileMeta } = file
  const { kind: _imageKind, path: _imagePath, ...imageMeta } = image
  assert.deepEqual((user.event.data as any).content, [{ type: 'file', attachment: fileMeta }, { type: 'image', attachment: imageMeta }])
  assert.equal(JSON.stringify(user).includes('/workspace'), false)
})

test('native upload and attachment RPC envelopes remain unchanged; mixed prompts reach the Host verbatim', async () => {
  const writes: any[] = [], reads: string[] = []
  const remote = createWorkbenchRemote((async (url: string, init?: RequestInit) => {
    if (init?.method) {
      const body = JSON.parse(init.body as string); writes.push({ url, body })
      return Response.json(url.endsWith('/upload') ? { ok: true, value: { receiptId: 'receipt', file: { attachmentId: 'sha256:test', name: 'a.txt', bytes: 3 } } } : { accepted: true })
    }
    reads.push(url)
    return Response.json(url.includes('/attachments?') ? { attachment: { attachmentId: 'sha256:image', mediaType: 'image/webp', bytes: 3, width: 1, height: 1 }, data: 'YWJj' }
      : { session: { id: 's', writable: true, runState: 'idle' }, events: [] })
  }) as typeof fetch)
  const call = (endpoint: string, input: any) => remote.call('$native', endpoint, { args: [input] }) as Promise<any>
  const upload = await call('fileUploads/upload', { agentId: 's', request: { name: 'a.txt', data: 'YWJj' } })
  assert.equal(upload.ok, true); assert.equal(upload.value.receiptId, 'receipt')
  assert.deepEqual(writes[0], { url: '/api/workbench/sessions/s/upload', body: { name: 'a.txt', data: 'YWJj' } })
  const content = [{ type: 'file', receiptId: 'receipt' }, { type: 'image', mediaType: 'image/png', data: 'YWJj' }]
  assert.equal((await call('session/prompt', { sessionId: 's', requestId: 'p', content })).ok, true)
  assert.deepEqual(writes[1].body.content, content)
  assert.equal((await call('session/attachment', { sessionId: 's', attachmentId: 'sha256:image' })).value.data, 'YWJj')
  assert.equal(reads.at(-1), '/api/workbench/sessions/s/attachments?id=sha256%3Aimage')
  const vite = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')
  assert.ok(vite.includes("'/api/session/uploadFileBinary'"))
  assert.ok(!vite.includes("'ui-attachment',"))
})
