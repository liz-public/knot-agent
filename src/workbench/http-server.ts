import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { JournalReadError } from './read-journal.js'
import type { WorkbenchSession } from './session.js'

export interface WorkbenchServerOptions {
  readonly sessions: readonly WorkbenchSession[]
  readonly createSession?: (input: { title?: string; cwd?: string }) => Promise<WorkbenchSession>
  readonly webRoot?: string
}

const contentTypes: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

async function serveWeb(response: ServerResponse, root: string, pathname: string): Promise<boolean> {
  const requested = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
  const fromRoot = relative(root, requested)
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) return false
  let body: Buffer
  let served = requested
  try {
    body = await readFile(requested)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    try {
      served = resolve(root, 'index.html')
      body = await readFile(served)
    } catch (fallbackError) {
      if ((fallbackError as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw fallbackError
    }
  }
  response.writeHead(200, {
    'content-type': contentTypes[extname(served)] ?? 'application/octet-stream',
    'content-length': body.byteLength,
    'cache-control': served.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
  })
  response.end(body)
  return true
}

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let text = ''
  for await (const chunk of request) {
    text += String(chunk)
    if (Buffer.byteLength(text) > 64 * 1024) throw new Error('request body is too large')
  }
  if (text.length === 0) return {}
  const value = JSON.parse(text) as unknown
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('request body must be a JSON object')
  }
  return value as Record<string, unknown>
}

function pathMatch(pathname: string, suffix: string): string | undefined {
  const expression = new RegExp(`^/api/workbench/sessions/([^/]+)${suffix}$`)
  const match = expression.exec(pathname)
  return match === null ? undefined : decodeURIComponent(match[1]!)
}

export function createWorkbenchServer(options: WorkbenchServerOptions): Server {
  const byId = new Map(options.sessions.map(session => [session.id, session]))
  if (byId.size !== options.sessions.length) throw new Error('duplicate workbench session id')

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')

      if (request.method === 'GET' && !url.pathname.startsWith('/api/') && options.webRoot !== undefined) {
        if (await serveWeb(response, options.webRoot, decodeURIComponent(url.pathname))) return
      }

      if (request.method === 'GET' && url.pathname === '/api/workbench/sessions') {
        sendJson(response, 200, { sessions: await Promise.all([...byId.values()].map(session => session.summary())) })
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/workbench/sessions') {
        if (options.createSession === undefined) {
          sendJson(response, 405, { error: { code: 'read_only', message: 'Session creation is unavailable' } })
          return
        }
        const body = await readBody(request)
        const session = await options.createSession({
          ...(typeof body['title'] === 'string' ? { title: body['title'] } : {}),
          ...(typeof body['cwd'] === 'string' ? { cwd: body['cwd'] } : {}),
        })
        if (byId.has(session.id)) throw new Error(`duplicate workbench session id ${session.id}`)
        byId.set(session.id, session)
        sendJson(response, 201, { session: await session.summary() })
        return
      }

      const snapshotId = pathMatch(url.pathname, '')
      if (request.method === 'GET' && snapshotId !== undefined) {
        const session = byId.get(snapshotId)
        if (session === undefined) {
          sendJson(response, 404, { error: { code: 'session_not_found', message: 'Session was not found' } })
          return
        }
        sendJson(response, 200, await session.snapshot())
        return
      }

      const streamId = pathMatch(url.pathname, '/stream')
      if (request.method === 'GET' && streamId !== undefined) {
        const session = byId.get(streamId)
        if (session?.subscribe === undefined) {
          sendJson(response, session === undefined ? 404 : 405, {
            error: {
              code: session === undefined ? 'session_not_found' : 'session_not_live',
              message: session === undefined ? 'Session was not found' : 'Session has no live stream',
            },
          })
          return
        }
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        })
        response.write(': connected\n\n')
        const unsubscribe = session.subscribe(event => {
          response.write(`event: session\ndata: ${JSON.stringify({ ...event, emittedAt: new Date().toISOString() })}\n\n`)
        })
        const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15_000)
        request.once('close', () => {
          clearInterval(heartbeat)
          unsubscribe()
        })
        return
      }

      const messageId = pathMatch(url.pathname, '/messages')
      if (request.method === 'POST' && messageId !== undefined) {
        const session = byId.get(messageId)
        if (session?.submit === undefined) {
          sendJson(response, session === undefined ? 404 : 405, { error: { code: 'session_not_writable', message: 'Session is not writable' } })
          return
        }
        const body = await readBody(request)
        const content = body['content']
        if (typeof content !== 'string' || content.trim().length === 0) {
          sendJson(response, 400, { error: { code: 'invalid_message', message: 'content must be a non-empty string' } })
          return
        }
        session.submit(content)
        sendJson(response, 202, { accepted: true })
        return
      }

      const pauseId = pathMatch(url.pathname, '/pause')
      if (request.method === 'POST' && pauseId !== undefined) {
        const session = byId.get(pauseId)
        if (session?.pause === undefined) {
          sendJson(response, 405, { error: { code: 'session_not_controllable', message: 'Session cannot pause' } })
          return
        }
        session.pause()
        sendJson(response, 202, { accepted: true })
        return
      }

      const resumeId = pathMatch(url.pathname, '/resume')
      if (request.method === 'POST' && resumeId !== undefined) {
        const session = byId.get(resumeId)
        if (session?.resume === undefined) {
          sendJson(response, 405, { error: { code: 'session_not_controllable', message: 'Session cannot resume' } })
          return
        }
        session.resume()
        sendJson(response, 202, { accepted: true })
        return
      }

      const interactionId = pathMatch(url.pathname, '/interactions')
      if (request.method === 'POST' && interactionId !== undefined) {
        const session = byId.get(interactionId)
        if (session?.respond === undefined) {
          sendJson(response, 405, { error: { code: 'session_not_interactive', message: 'Session has no interactions' } })
          return
        }
        const body = await readBody(request)
        const id = body['id']
        const value = body['value']
        if (typeof id !== 'string' || typeof value !== 'string' || !session.respond(id, value)) {
          sendJson(response, 404, { error: { code: 'interaction_not_found', message: 'Interaction was not found' } })
          return
        }
        sendJson(response, 200, { resolved: true })
        return
      }

      sendJson(response, 404, { error: { code: 'not_found', message: 'Route was not found' } })
    } catch (error) {
      if (error instanceof JournalReadError) {
        const status = error.code === 'source_not_found' ? 404 : error.code === 'read_failed' ? 500 : 422
        sendJson(response, status, { error: { code: error.code, message: error.message } })
        return
      }
      sendJson(response, 400, {
        error: { code: 'bad_request', message: error instanceof Error ? error.message : String(error) },
      })
    }
  })
}
