import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { JournalReadError } from './read-journal.js'
import type { ProviderProfileSummary } from './provider-profile.js'
import type { ProviderProfileDraft } from './provider-profile-store.js'
import type { WorkbenchSession } from './session.js'
import type { ApprovalMode, ReasoningEffort } from './session.js'
import { createSessionRegistry, type SessionRegistry } from './session-registry.js'
import type { StudioController } from './studio.js'
import { projectModelContext } from './context-projection.js'

export interface WorkbenchServerOptions {
  readonly sessions: readonly WorkbenchSession[]
  readonly sessionRegistry?: SessionRegistry
  readonly providerProfiles?: readonly ProviderProfileSummary[] | (() => readonly ProviderProfileSummary[])
  readonly createProviderProfile?: (input: ProviderProfileDraft) => Promise<ProviderProfileSummary>
  readonly studio?: StudioController
  readonly createSession?: (input: {
    title?: string
    cwd?: string
    providerProfileId?: string
    reasoningEffort?: ReasoningEffort
    approvalMode?: ApprovalMode
    projectId?: string
    assemblyId?: string
    assemblyGenerationId?: string
  }) => Promise<WorkbenchSession>
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
  const registry = options.sessionRegistry ?? createSessionRegistry(options.sessions)
  const providerProfiles = () => typeof options.providerProfiles === 'function'
    ? options.providerProfiles()
    : options.providerProfiles ?? []

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')

      if (request.method === 'GET' && !url.pathname.startsWith('/api/') && options.webRoot !== undefined) {
        if (await serveWeb(response, options.webRoot, decodeURIComponent(url.pathname))) return
      }

      if (request.method === 'GET' && url.pathname === '/api/workbench/sessions') {
        sendJson(response, 200, { sessions: await Promise.all(registry.list().map(session => session.summary())) })
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/workbench/sessions/stream') {
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        })
        response.write(': connected\n\n')
        const unsubscribe = registry.subscribe(() => {
          response.write(`event: catalog\ndata: ${JSON.stringify({ kind: 'catalog.changed', emittedAt: new Date().toISOString() })}\n\n`)
        })
        const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15_000)
        request.once('close', () => {
          clearInterval(heartbeat)
          unsubscribe()
        })
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/workbench/providers') {
        sendJson(response, 200, { providers: providerProfiles() })
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/workbench/providers') {
        if (options.createProviderProfile === undefined) {
          sendJson(response, 405, { error: { code: 'provider_configuration_unavailable', message: 'Provider configuration is unavailable' } })
          return
        }
        const body = await readBody(request)
        const adapter = body['adapter']
        if (adapter !== 'openai-compatible' && adapter !== 'deepseek') {
          throw new Error('adapter must be openai-compatible or deepseek')
        }
        if (typeof body['label'] !== 'string') throw new Error('label must be a string')
        if (typeof body['model'] !== 'string') throw new Error('model must be a string')
        const contextWindow = body['contextWindow']
        if (contextWindow !== undefined && typeof contextWindow !== 'number') {
          throw new Error('contextWindow must be a number')
        }
        const effort = body['defaultReasoningEffort']
        if (effort !== undefined && !['none', 'low', 'high', 'max'].includes(String(effort))) {
          throw new Error('defaultReasoningEffort must be none, low, high, or max')
        }
        const profile = await options.createProviderProfile({
          label: body['label'],
          adapter,
          model: body['model'],
          ...(typeof body['baseUrl'] === 'string' ? { baseUrl: body['baseUrl'] } : {}),
          ...(typeof body['apiKey'] === 'string' ? { apiKey: body['apiKey'] } : {}),
          ...(typeof contextWindow === 'number' ? { contextWindow } : {}),
          ...(effort === undefined ? {} : { defaultReasoningEffort: effort as ReasoningEffort }),
        })
        sendJson(response, 201, { provider: profile })
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/workbench/studio') {
        if (options.studio === undefined) {
          sendJson(response, 404, { error: { code: 'studio_unavailable', message: 'Studio is unavailable' } })
          return
        }
        sendJson(response, 200, await options.studio.snapshot())
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/workbench/studio/projects') {
        if (options.studio === undefined) {
          sendJson(response, 404, { error: { code: 'studio_unavailable', message: 'Studio is unavailable' } })
          return
        }
        const body = await readBody(request)
        if (typeof body['title'] !== 'string') throw new Error('title must be a string')
        const project = await options.studio.createProject({
          title: body['title'],
          ...(typeof body['projectRoot'] === 'string' ? { projectRoot: body['projectRoot'] } : {}),
          ...(typeof body['assemblyId'] === 'string' ? { assemblyId: body['assemblyId'] } : {}),
        })
        sendJson(response, 201, { project })
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/workbench/studio/cases') {
        if (options.studio === undefined) {
          sendJson(response, 404, { error: { code: 'studio_unavailable', message: 'Studio is unavailable' } })
          return
        }
        const body = await readBody(request)
        if (typeof body['title'] !== 'string') throw new Error('title must be a string')
        const value = await options.studio.createCase({
          title: body['title'],
          ...(typeof body['projectId'] === 'string' ? { projectId: body['projectId'] } : {}),
          ...(typeof body['workspace'] === 'string' ? { workspace: body['workspace'] } : {}),
          ...(typeof body['prompt'] === 'string' ? { prompt: body['prompt'] } : {}),
        })
        sendJson(response, 201, { case: value })
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/workbench/studio/check') {
        if (options.studio === undefined) {
          sendJson(response, 404, { error: { code: 'studio_unavailable', message: 'Studio is unavailable' } })
          return
        }
        const body = await readBody(request)
        if (typeof body['caseId'] !== 'string') throw new Error('caseId must be a string')
        sendJson(response, 200, { validation: await options.studio.check(body['caseId']) })
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/workbench/studio/publish') {
        if (options.studio === undefined) {
          sendJson(response, 404, { error: { code: 'studio_unavailable', message: 'Studio is unavailable' } })
          return
        }
        const body = await readBody(request)
        if (typeof body['caseId'] !== 'string') throw new Error('caseId must be a string')
        sendJson(response, 201, { generation: await options.studio.publish(body['caseId']) })
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/workbench/studio/runs') {
        if (options.studio === undefined) {
          sendJson(response, 404, { error: { code: 'studio_unavailable', message: 'Studio is unavailable' } })
          return
        }
        const body = await readBody(request)
        if (typeof body['caseId'] !== 'string') throw new Error('caseId must be a string')
        if (body['mode'] !== 'mock' && body['mode'] !== 'real') throw new Error('mode must be mock or real')
        const run = await options.studio.run({
          caseId: body['caseId'],
          mode: body['mode'],
          ...(typeof body['providerProfileId'] === 'string'
            ? { providerProfileId: body['providerProfileId'] }
            : {}),
          ...(['none', 'low', 'high', 'max'].includes(String(body['reasoningEffort']))
            ? { reasoningEffort: body['reasoningEffort'] as ReasoningEffort }
            : {}),
        })
        sendJson(response, 201, { run })
        return
      }


      const flowMatch = /^\/api\/workbench\/studio\/runs\/([^/]+)\/flow$/.exec(url.pathname)
      if (request.method === 'GET' && flowMatch !== null) {
        if (options.studio === undefined) {
          sendJson(response, 404, { error: { code: 'studio_unavailable', message: 'Studio is unavailable' } })
          return
        }
        sendJson(response, 200, await options.studio.flow(decodeURIComponent(flowMatch[1]!)))
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
          ...(typeof body['projectId'] === 'string' ? { projectId: body['projectId'] } : {}),
          ...(typeof body['assemblyId'] === 'string' ? { assemblyId: body['assemblyId'] } : {}),
          ...(typeof body['providerProfileId'] === 'string'
            ? { providerProfileId: body['providerProfileId'] }
            : {}),
          ...(['none', 'low', 'high', 'max'].includes(String(body['reasoningEffort']))
            ? { reasoningEffort: body['reasoningEffort'] as ReasoningEffort }
            : {}),
          ...(['ask', 'auto'].includes(String(body['approvalMode']))
            ? { approvalMode: body['approvalMode'] as ApprovalMode }
            : {}),
          ...(typeof body['assemblyGenerationId'] === 'string'
            ? { assemblyGenerationId: body['assemblyGenerationId'] }
            : {}),
        })
        registry.add(session)
        sendJson(response, 201, { session: await session.summary() })
        return
      }

      const snapshotId = pathMatch(url.pathname, '')
      if (request.method === 'GET' && snapshotId !== undefined) {
        const session = registry.get(snapshotId)
        if (session === undefined) {
          sendJson(response, 404, { error: { code: 'session_not_found', message: 'Session was not found' } })
          return
        }
        sendJson(response, 200, await session.snapshot())
        return
      }

      const contextId = pathMatch(url.pathname, '/context')
      if (request.method === 'GET' && contextId !== undefined) {
        const session = registry.get(contextId)
        if (session === undefined) {
          sendJson(response, 404, { error: { code: 'session_not_found', message: 'Session was not found' } })
          return
        }
        const projection = projectModelContext(
          (await session.snapshot()).events,
          url.searchParams.get('requestId') ?? undefined,
        )
        if (projection === undefined) {
          sendJson(response, 404, { error: { code: 'context_not_found', message: 'Model context was not found' } })
          return
        }
        sendJson(response, 200, projection)
        return
      }

      const streamId = pathMatch(url.pathname, '/stream')
      if (request.method === 'GET' && streamId !== undefined) {
        const session = registry.get(streamId)
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
        const session = registry.get(messageId)
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
        const session = registry.get(pauseId)
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
        const session = registry.get(resumeId)
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
        const session = registry.get(interactionId)
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
