import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { createAttachmentStore } from '../src/workbench/attachments.js'
import { createLiveSession } from '../src/workbench/live-session.js'
import { createWorkbenchServer } from '../src/workbench/http-server.js'
import { case2Assembly } from '../src/workbench/case2-assembly.js'
import { openAiLlmProvider } from '../src/agent/providers/openai.js'
import type { ChatMessage } from '../src/agent/protocol.js'

test('native upload receipts are Session-scoped; image normalization is durable and rejects invalid input', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'knot-attachments-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const store = createAttachmentStore(cwd, 's')
  const upload = await store.upload((async function* () { yield Buffer.from('first'); yield Buffer.from(' second') })(), '../notes.txt')
  const parts = [{ type: 'file', receiptId: upload.receiptId }]
  const admitted = await store.admit(parts)
  assert.equal(await readFile(admitted.attachments[0]!.path, 'utf8'), 'first second')
  assert.equal(upload.file.name, 'notes.txt')
  assert.equal('path' in upload.file, false)
  await assert.rejects(createAttachmentStore(cwd, 'other').admit(parts), /not uploaded/)
  store.retire(parts)
  await assert.rejects(store.admit(parts), /not uploaded/)
  // Retiring a draft receipt never removes the durable bytes.
  assert.equal(await readFile(admitted.attachments[0]!.path, 'utf8'), 'first second')
  const png = await sharp({ create: { width: 2500, height: 2500, channels: 3, background: '#ff0000' } }).png().toBuffer()
  const image = (await store.admit([{ type: 'image', name: 'original.png', mediaType: 'image/png', data: png.toString('base64') }])).attachments[0]!
  assert.equal(image.kind, 'image'); assert.equal(image.mediaType, 'image/webp')
  assert.equal(image.name, 'original.png'); assert.ok(image.path.endsWith('/original.webp'))
  assert.ok(image.width! * image.height! <= 2048 * 2048)
  const restored = await createAttachmentStore(cwd, 's').read(image)
  assert.equal(restored.data, (await readFile(image.path)).toString('base64'))
  await assert.rejects(store.admit([{ type: 'image', mediaType: 'image/jpeg', data: png.toString('base64') }]), /type does not match/)
  await assert.rejects(store.admit([{ type: 'image', mediaType: 'image/png', data: 'not an image' }]), /unsupported|corrupt|image/i)
  await chmod(image.path, 0o600)
  await writeFile(image.path, 'changed')
  await assert.rejects(store.read(image), /changed|match|integrity/i)
})

test('native raw uploads, mixed prompts, historical images and Provider image bytes form one Host-to-Agent loop', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'knot-attachment-http-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  let messages: readonly ChatMessage[] = []
  const session = await createLiveSession({ id: 's', cwd, journalPath: join(cwd, 's.jsonl'), assembly: case2Assembly,
    llm: { async generate(call) { messages = call.messages; return { generated: { content: 'Seen', toolCalls: [] }, usage: { contextWindow: 10000 } } } } })
  const server = createWorkbenchServer({ sessions: [session] })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const receipts = await Promise.all(['a.txt', 'b.txt'].map(async name => {
    const response = await fetch(base + '/api/session/uploadFileBinary?sessionId=s&name=' + name,
      { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: name })
    const result = await response.json(); assert.equal(result.ok, true); return result.value.receiptId
  }))
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#00ff00' } }).png().toBuffer()
  const idle = new Promise<void>(resolve => {
    const unsubscribe = session.subscribe!(event => { if (event.kind === 'state.changed' && event.runState === 'idle') { unsubscribe(); resolve() } })
  })
  const response = await fetch(base + '/api/workbench/sessions/s/messages', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: [...receipts.map(receiptId => ({ type: 'file', receiptId })),
      { type: 'image', mediaType: 'image/png', data: png.toString('base64') }, { type: 'text', text: 'Inspect these' }] }) })
  assert.equal(response.status, 202)
  await idle
  const snapshot = await session.snapshot()
  const user = snapshot.events.find(event => event.type === 'user.message')!.data as any
  assert.equal(user.attachments.length, 3)
  assert.ok(!JSON.stringify(user).includes(png.toString('base64')))
  assert.ok(messages.some(message => message.role === 'user' && message.content?.includes(user.attachments[0].path)))
  const image = user.attachments[2]
  const history = await fetch(base + '/api/workbench/sessions/s/attachments?id=' + encodeURIComponent(image.attachmentId))
  const asset = await history.json(); assert.equal(asset.data, (await readFile(image.path)).toString('base64'))
  assert.equal('path' in asset.attachment, false)
  assert.equal((await fetch(base + '/api/workbench/sessions/s/attachments?id=foreign')).status, 400)
  let wire: any
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    wire = JSON.parse(init.body as string)
    return Response.json({ choices: [{ message: { content: 'green' } }] })
  })
  await openAiLlmProvider({ model: 'vision', baseUrl: 'https://test.invalid' }).generate({ request: { purpose: 'agent', turnId: 't' }, messages, tools: [] })
  const imageMessage = wire.messages.find((message: any) => Array.isArray(message.content))
  assert.equal(imageMessage.content.find((part: any) => part.type === 'image_url').image_url.url, 'data:image/webp;base64,' + asset.data)
  assert.equal('images' in imageMessage, false)
})
