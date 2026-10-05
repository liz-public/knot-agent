import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createWorkbenchServer } from '../src/workbench/http-server.js'
import type { WorkbenchSession } from '../src/workbench/session.js'
import { createUserTerminals } from '../src/workbench/user-terminal.js'

test('native terminal HTTP runs a real PTY, restores screen/control and never loads Journal', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'knot-terminal-'))
  const session: WorkbenchSession = { id: 's', summary: async () => ({
    id: 's', title: 'S', assembly: 'case2', workspace: cwd, writable: true, eventCount: 0, runState: 'idle',
  }), snapshot: async () => { throw new Error('User terminal must not read Journal') } }
  const server = createWorkbenchServer({ sessions: [session, { ...session, id: 'other' }] })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const aborts: AbortController[] = []
  t.after(async () => {
    for (const abort of aborts) abort.abort()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(cwd, { recursive: true, force: true })
  })
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/workbench/sessions/`
  const get = async (action: string, owner = 's') => (await fetch(base + owner + '/terminals/' + action)).json()
  const post = async (action: string, body: object, owner = 's') => {
    const response = await fetch(base + owner + '/terminals/' + action, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    return { status: response.status, value: await response.json() }
  }
  assert.equal((await get('environment')).cwd, cwd)
  const shells = await get('shells')
  assert.ok(shells.length)
  const created = await post('create', { id: 't', cols: 80, rows: 24 })
  assert.equal(created.value.state, 'running')
  assert.equal((await post('create', { id: 't', cols: 80, rows: 24 })).value.id, 't')
  assert.equal((await get('list')).length, 1)
  assert.equal((await post('write', { id: 't', attachmentId: 'a', data: 'bad' }, 'other')).value.error.code, 'terminal/unavailable')
  const follow = async (attachment: string) => {
    const abort = new AbortController(); aborts.push(abort)
    const response = await fetch(base + `s/terminals/follow?id=t&attachmentId=${attachment}`, { signal: abort.signal })
    const frames: any[] = []
    let wake: (() => void) | undefined
    const read = (async () => {
      let buffer = ''
      const decoder = new TextDecoder()
      for await (const bytes of response.body!) {
        buffer += decoder.decode(bytes, { stream: true })
        let boundary: number
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const text = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2)
          if (text.startsWith('data: ')) { frames.push(JSON.parse(text.slice(6))); wake?.() }
        }
      }
    })().catch(error => { if (!abort.signal.aborted) throw error })
    const until = async (predicate: (frames: any[]) => boolean) => {
      while (!predicate(frames)) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Terminal frame timed out: ' + JSON.stringify(frames))), 8000)
          wake = () => { clearTimeout(timeout); resolve() }
        })
      }
    }
    return { frames, until, stop: async () => { abort.abort(); await read } }
  }
  const first = await follow('a')
  await first.until(frames => frames.some(f => f.type === 'snapshot'))
  const output = (frames: any[]) => frames.filter(f => f.type === 'output').map(f => f.data).join('')
  await post('write', { id: 't', attachmentId: 'a', data: String.raw`printf '\nPTY_CHECK:'; test -t 0 && printf 'yes\n'; pwd; printf '\033[31mCOLOR_OK\033[0m\n'` + '\r' })
  await first.until(frames => output(frames).includes('PTY_CHECK:yes') && output(frames).includes('\x1b[31mCOLOR_OK'))
  assert.ok(output(first.frames).includes(cwd))
  await post('resize', { id: 't', attachmentId: 'a', cols: 100, rows: 30 })
  await post('write', { id: 't', attachmentId: 'a', data: 'stty size\r' })
  await first.until(frames => output(frames).includes('30 100'))
  await post('write', { id: 't', attachmentId: 'a', data: `"${process.execPath}" -e "console.log('SLEEP_STARTED');setTimeout(()=>{},30000)"\r` })
  await first.until(frames => output(frames).includes('\r\nSLEEP_STARTED\r\n'))
  await post('write', { id: 't', attachmentId: 'a', data: '\x03' })
  await post('write', { id: 't', attachmentId: 'a', data: String.raw`printf '\nINTERRUPT_OK\n'` + '\r' })
  await first.until(frames => output(frames).includes('\r\nINTERRUPT_OK\r\n'))
  const second = await follow('b')
  await second.until(frames => frames.some(f => f.type === 'snapshot'))
  const restored = second.frames.find(f => f.type === 'snapshot')
  assert.ok(restored.screen.includes('COLOR_OK'))
  assert.equal(restored.info.cols, 100)
  assert.equal(restored.info.controllerId, 'b')
  assert.equal((await post('write', { id: 't', attachmentId: 'a', data: 'not allowed' })).value.error.code, 'terminal/control-unavailable')
  await first.stop() // Old view detach cannot revoke the new controller.
  assert.equal((await post('rename', { id: 't', title: 'My shell' })).status, 200)
  assert.equal((await get('list'))[0].title, 'My shell')
  await post('write', { id: 't', attachmentId: 'b', data: 'exit 7\r' })
  await second.until(frames => frames.some(f => f.type === 'state' && f.info.state === 'exited' && f.info.exitCode === 7))
  await second.stop()
  assert.equal((await post('close', { id: 't' })).status, 200)
  assert.equal((await post('close', { id: 't' })).status, 200)
  assert.deepEqual(await get('list'), [])
  assert.equal((await post('create', { id: 'bad', cols: 0, rows: 24 })).status, 400)
  assert.equal((await post('create', { id: 'bad', cols: 80, rows: 24, shellPath: '/missing-shell' })).value.error.code, 'terminal/unavailable')
})

test('closing a running terminal and disposing its Host reclaim real PTY processes', async () => {
  const terminals = createUserTerminals()
  terminals.create('s', tmpdir(), { id: 'live', cols: 80, rows: 24 })
  const live = terminals.get('s', 'live')
  await Promise.all([terminals.close('s', 'live'), terminals.close('s', 'live')])
  assert.equal(live.info.state, 'exited')
  assert.deepEqual(terminals.list('s'), [])
  terminals.create('s', tmpdir(), { id: 'host', cols: 80, rows: 24 })
  const host = terminals.get('s', 'host')
  await terminals.dispose()
  assert.equal(host.info.state, 'exited')
  assert.deepEqual(terminals.list('s'), [])
})
