import assert from 'node:assert/strict'
import test from 'node:test'
import { callTerminal, openTerminal } from '../src/terminal-remote.ts'

test('native terminal RPC preserves wire owner and creation request without changing Journal', async () => {
  const seen: any[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    seen.push({ url, ...init })
    return Response.json(url.endsWith('/create') ? { id: 't' } : null)
  }) as typeof fetch
  await callTerminal(fetcher, 'create', { args: [{ agentId: 's', request: { id: 't', cols: 80, rows: 24 } }] })
  assert.equal(seen[0].url, '/api/workbench/sessions/s/terminals/create')
  assert.deepEqual(JSON.parse(seen[0].body), { id: 't', cols: 80, rows: 24 })
  assert.deepEqual(await callTerminal(fetcher, 'write', { args: [{ agentId: 's', id: 't', attachmentId: 'a', data: '\x03' }] }), { ok: true, value: undefined })
  assert.equal(JSON.parse(seen[1].body).data, '\x03')
  await callTerminal(fetcher, 'list', { args: [{ sessionId: 's' }] })
  assert.equal(seen[2].method, 'GET')
})

test('native terminal stream decodes split UTF8 frames and closes its reader', async () => {
  const bytes = new TextEncoder().encode('data: {"type":"output","data":"中文"}\n\n: keepalive\n\ndata: {"type":"state","info":{}}\n\n')
  const fetcher = (async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(bytes.slice(0, 36)); controller.enqueue(bytes.slice(36)); controller.close()
  } }))) as typeof fetch
  const frames = []
  for await (const frame of openTerminal(fetcher, 'follow', { args: [{ agentId: 's', id: 't', attachmentId: 'a' }] }, new AbortController().signal)) frames.push(frame)
  assert.deepEqual(frames, [{ type: 'output', data: '中文' }, { type: 'state', info: {} }])
})

test('native terminal unavailable errors keep their domain and window hold waits only locally', async () => {
  const controller = new AbortController()
  const hold = openTerminal((async () => Response.json({ type: 'retained' })) as typeof fetch,
    'retain', { args: [{ sessionId: 's', id: 't' }] }, controller.signal)
  assert.deepEqual((await hold.next()).value, { type: 'retained' })
  const ending = hold.next(); controller.abort(); assert.equal((await ending).done, true)
  await assert.rejects(callTerminal((async () => Response.json({ error: {
    code: 'terminal/unavailable', message: 'Gone', details: {},
  } }, { status: 400 })) as typeof fetch, 'write', { args: [{ agentId: 's' }] }),
  (error: any) => error.isDSHRemoteError && error.code === 'terminal/unavailable')
})
