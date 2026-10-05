/** Native terminal transport only: no Agent requests, tool dispatch or Journal reads. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SessionRegistry } from './session-registry.js'
import { terminalLimits, terminalShells, UserTerminalError, type createUserTerminals } from './user-terminal.js'

export async function serveUserTerminal(
  request: IncomingMessage, response: ServerResponse, url: URL, registry: SessionRegistry,
  terminals: ReturnType<typeof createUserTerminals>, readBody: () => Promise<Record<string, unknown>>,
  send: (value: unknown) => void,
): Promise<boolean> {
  const match = /^\/api\/workbench\/sessions\/([^/]+)\/terminals\/([a-z]+)$/.exec(url.pathname)
  if (!match) return false
  const sessionId = decodeURIComponent(match[1]!), action = match[2]!
  const session = registry.get(sessionId)
  if (!session) throw new UserTerminalError('terminal/unavailable', 'Session was not found')
  const input = request.method === 'GET' ? Object.fromEntries(url.searchParams) : await readBody()
  const id = String(input['id'] ?? '')
  if (request.method === 'GET') {
    if (action === 'list') send(terminals.list(sessionId))
    else if (action === 'shells') send(terminalShells())
    else if (action === 'environment') {
      const { workspace } = await session.summary()
      if (!workspace) throw new UserTerminalError('terminal/unavailable', 'Session has no workspace')
      send({ cwd: workspace, ...terminalLimits })
    } else if (action === 'retain') {
      // Processes are retained by this Host, not by browser leases. Validate the
      // native window hold without allocating a second long-lived HTTP stream.
      terminals.get(sessionId, id); send({ type: 'retained' })
    } else if (action === 'follow') {
      const terminal = terminals.get(sessionId, id)
      const attachmentId = input['attachmentId']
      if (typeof attachmentId !== 'string' || !/^[\w-]{1,128}$/.test(attachmentId)) {
        throw new UserTerminalError('terminal/invalid-id', 'Invalid terminal attachment')
      }
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      response.write(': connected\n\n')
      const detach = await terminal.follow(attachmentId, frame => {
        if (response.destroyed) return
        // A stalled client reconnects from the bounded screen instead of retaining
        // unlimited stdout in an HTTP output queue.
        if (response.writableLength > 2 * 1024 * 1024) { response.destroy(); return }
        response.write(`data: ${JSON.stringify(frame)}\n\n`)
      })
      if (response.destroyed) detach()
      else {
        const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15_000)
        response.once('close', () => { clearInterval(heartbeat); detach() })
      }
    } else return false
  } else if (request.method === 'POST') {
    if (action === 'create') {
      const { workspace } = await session.summary()
      if (!workspace) throw new UserTerminalError('terminal/unavailable', 'Session has no workspace')
      send(terminals.create(sessionId, workspace, input as unknown as Parameters<typeof terminals.create>[2]))
    } else if (action === 'close') { await terminals.close(sessionId, id); send(null) }
    else {
      const terminal = terminals.get(sessionId, id)
      if (action === 'write') terminal.write(input['attachmentId'], input['data'])
      else if (action === 'resize') await terminal.resize(input['attachmentId'], input['cols'] as number, input['rows'] as number)
      else if (action === 'rename') terminal.rename(input['title'])
      else return false
      send(null)
    }
  } else return false
  return true
}
