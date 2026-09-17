import { createServer, type Server, type ServerResponse } from 'node:http'
import { JournalReadError, readJournalSnapshot, type JournalReadLimits } from './read-journal.js'

export interface StoredSessionConfig {
  readonly id: string
  readonly title: string
  readonly assembly: string
  readonly journalPath: string
}

export interface WorkbenchServerOptions extends JournalReadLimits {
  readonly sessions: readonly StoredSessionConfig[]
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

function errorStatus(error: JournalReadError): number {
  return error.code === 'source_not_found' ? 404 : error.code === 'read_failed' ? 500 : 422
}

export function createWorkbenchServer(options: WorkbenchServerOptions): Server {
  const byId = new Map(options.sessions.map(session => [session.id, session]))
  if (byId.size !== options.sessions.length) throw new Error('duplicate workbench session id')

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method === 'GET' && url.pathname === '/api/workbench/sessions') {
      const sessions = await Promise.all(options.sessions.map(async session => {
        try {
          const snapshot = await readJournalSnapshot(session.journalPath, options)
          const updatedAt = snapshot.events.at(-1)?.observedAt
          return {
            id: session.id,
            title: session.title,
            assembly: session.assembly,
            runState: 'completed' as const,
            eventCount: snapshot.eventCount,
            ...(updatedAt === undefined ? {} : { updatedAt }),
          }
        } catch {
          return {
            id: session.id,
            title: session.title,
            assembly: session.assembly,
            runState: 'completed' as const,
            eventCount: 0,
          }
        }
      }))
      sendJson(response, 200, { sessions })
      return
    }

    const match = /^\/api\/workbench\/sessions\/([^/]+)$/.exec(url.pathname)
    if (request.method !== 'GET' || match === null) {
      sendJson(response, 404, { error: { code: 'not_found', message: 'Route was not found' } })
      return
    }
    const sessionId = decodeURIComponent(match[1]!)
    const session = byId.get(sessionId)
    if (session === undefined) {
      sendJson(response, 404, { error: { code: 'session_not_found', message: 'Session was not found' } })
      return
    }

    try {
      const snapshot = await readJournalSnapshot(session.journalPath, options)
      const updatedAt = snapshot.events.at(-1)?.observedAt
      sendJson(response, 200, {
        session: {
          id: session.id,
          title: session.title,
          assembly: session.assembly,
          runState: 'completed',
          eventCount: snapshot.eventCount,
          ...(updatedAt === undefined ? {} : { updatedAt }),
        },
        events: snapshot.events,
      })
    } catch (error) {
      if (error instanceof JournalReadError) {
        sendJson(response, errorStatus(error), { error: { code: error.code, message: error.message } })
        return
      }
      sendJson(response, 500, {
        error: { code: 'read_failed', message: 'Journal source could not be read' },
      })
    }
  })
}
