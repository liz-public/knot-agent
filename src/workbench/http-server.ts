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
import { projectContextTimeline, projectModelContext } from './context-projection.js'
import type { AssemblyCatalog } from './assembly-catalog.js'
import { projectToolAnalytics } from './tool-analytics.js'
import { projectPluginAnalytics } from './plugin-analytics.js'
import { projectSessionCover } from './session-cover.js'
import { readWorkspaceFile, WorkspaceFileError } from './workspace-files.js'
import { createUserTerminals, UserTerminalError } from './user-terminal.js'
import { serveUserTerminal } from './terminal-http.js'
import { AttachmentError, ATTACHMENT_MESSAGE_BYTES, createAttachmentStore, IMAGE_LIMITS } from './attachments.js'
import type { AttachmentRef } from '../agent/protocol.js'

export interface WorkbenchServerOptions {
  readonly sessions: readonly WorkbenchSession[]
  readonly sessionRegistry?: SessionRegistry
  readonly providerProfiles?: readonly ProviderProfileSummary[] | (() => readonly ProviderProfileSummary[])
  readonly createProviderProfile?: (input: ProviderProfileDraft) => Promise<ProviderProfileSummary>
  readonly updateProviderProfile?: (id: string, input: ProviderProfileDraft) => Promise<ProviderProfileSummary>
  readonly deleteProviderProfile?: (id: string) => Promise<void>
  readonly setDefaultProviderProfile?: (id: string) => Promise<ProviderProfileSummary>
  readonly testProviderProfile?: (id: string) => Promise<void>
  readonly studio?: StudioController
  readonly assemblies?: AssemblyCatalog
  readonly createSession?: (input: {
    title?: string
    cwd?: string
    providerProfileId?: string
    reasoningEffort?: ReasoningEffort
    approvalMode?: ApprovalMode
    projectId?: string
    assemblyId?: string
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

async function readBody(request: IncomingMessage, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > maxBytes) throw new Error('request body is too large')
    chunks.push(Buffer.from(chunk))
  }
  const text = Buffer.concat(chunks).toString('utf8')
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

function providerPathMatch(pathname: string, suffix = ''): string | undefined {
  const match = new RegExp(`^/api/workbench/providers/([^/]+)${suffix}$`).exec(pathname)
  return match === null ? undefined : decodeURIComponent(match[1]!)
}

function providerDraft(body: Record<string, unknown>): ProviderProfileDraft {
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
  return {
    label: body['label'],
    adapter,
    model: body['model'],
    ...(typeof body['baseUrl'] === 'string' ? { baseUrl: body['baseUrl'] } : {}),
    ...(typeof body['apiKey'] === 'string' ? { apiKey: body['apiKey'] } : {}),
    ...(typeof contextWindow === 'number' ? { contextWindow } : {}),
    ...(effort === undefined ? {} : { defaultReasoningEffort: effort as ReasoningEffort }),
  }
}

export function createWorkbenchServer(options: WorkbenchServerOptions): Server {
  const registry = options.sessionRegistry ?? createSessionRegistry(options.sessions)
  const terminals = createUserTerminals()
  const attachments = new Map<string, ReturnType<typeof createAttachmentStore>>()
  const attachmentStore = async (session: WorkbenchSession) => {
    let store = attachments.get(session.id)
    if (!store) {
      const workspace = (await session.summary()).workspace
      if (!workspace) throw new AttachmentError('Session has no workspace', 'UNKNOWN_WORKSPACE')
      store = attachments.get(session.id)
      if (!store) {
        store = createAttachmentStore(workspace, session.id)
        attachments.set(session.id, store)
      }
    }
    return store
  }
  const providerProfiles = () => typeof options.providerProfiles === 'function'
    ? options.providerProfiles()
    : options.providerProfiles ?? []

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const encodedUpload = pathMatch(url.pathname, '/upload')
      if (request.method === 'POST' && (url.pathname === '/api/session/uploadFileBinary' || encodedUpload !== undefined)) {
        const id = encodedUpload ?? url.searchParams.get('sessionId') ?? ''
        const session = registry.get(id)
        if (!session?.submit) { sendJson(response, 404, { ok: false, error: { code: 'session/not-found', message: 'Writable Session was not found', details: {} } }); return }
        try {
          if ((await session.summary()).parentSessionId) throw new AttachmentError('Subagent file uploads are not supported', 'SUBAGENT_FILE_UNSUPPORTED')
          const store = await attachmentStore(session)
          let value
          if (encodedUpload !== undefined) {
            const body = await readBody(request, ATTACHMENT_MESSAGE_BYTES)
            if (typeof body['data'] !== 'string') throw new AttachmentError('Expected encoded file bytes', 'INVALID_FILE')
            value = await store.upload((async function* () { yield Buffer.from(body['data'] as string, 'base64') })(), typeof body['name'] === 'string' ? body['name'] : undefined)
          } else {
            if (request.headers['content-type']?.split(';')[0] !== 'application/octet-stream') { sendJson(response, 415, { error: { message: 'Expected application/octet-stream' } }); return }
            value = await store.upload(request, url.searchParams.get('name') ?? undefined)
          }
          sendJson(response, 200, { ok: true, value })
        } catch (error) {
          sendJson(response, 200, { ok: false, error: { code: error instanceof AttachmentError ? error.code : 'gateway/internal',
            message: error instanceof Error ? error.message : String(error), details: { reason: error instanceof AttachmentError ? error.reason : 'STORE_FAILED' } } })
        }
        return
      }
      const imageId = pathMatch(url.pathname, '/attachments')
      if (request.method === 'GET' && imageId !== undefined) {
        const session = registry.get(imageId)
        if (!session) { sendJson(response, 404, { error: { code: 'session/not-found', message: 'Session was not found' } }); return }
        const snapshot = await session.snapshot()
        const refs = [...snapshot.events.filter(event => event.type === 'user.message').flatMap(event =>
          (event.data as { attachments?: readonly AttachmentRef[] }).attachments ?? []),
          ...(snapshot.pendingInputs ?? []).flatMap(input => input.attachments ?? [])]
        const ref = refs.find(ref => ref.kind === 'image' && ref.attachmentId === url.searchParams.get('id'))
        if (!ref) throw new AttachmentError('Image is not referenced by this Session', 'INVALID_ATTACHMENT_REF')
        sendJson(response, 200, await (await attachmentStore(session)).read(ref))
        return
      }
      if (await serveUserTerminal(request, response, url, registry, terminals,
        () => readBody(request), value => sendJson(response, 200, value))) return

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
        const profile = await options.createProviderProfile(providerDraft(await readBody(request)))
        sendJson(response, 201, { provider: profile })
        return
      }

      const providerId = providerPathMatch(url.pathname)
      if (request.method === 'PATCH' && providerId !== undefined) {
        if (options.updateProviderProfile === undefined) {
          sendJson(response, 405, { error: { code: 'provider_configuration_unavailable', message: 'Provider configuration is unavailable' } })
          return
        }
        sendJson(response, 200, { provider: await options.updateProviderProfile(providerId, providerDraft(await readBody(request))) })
        return
      }
      if (request.method === 'DELETE' && providerId !== undefined) {
        if (options.deleteProviderProfile === undefined) {
          sendJson(response, 405, { error: { code: 'provider_configuration_unavailable', message: 'Provider configuration is unavailable' } })
          return
        }
        await options.deleteProviderProfile(providerId)
        sendJson(response, 200, { deleted: true })
        return
      }
      const defaultProviderId = providerPathMatch(url.pathname, '/default')
      if (request.method === 'POST' && defaultProviderId !== undefined) {
        if (options.setDefaultProviderProfile === undefined) {
          sendJson(response, 405, { error: { code: 'provider_configuration_unavailable', message: 'Provider configuration is unavailable' } })
          return
        }
        sendJson(response, 200, { provider: await options.setDefaultProviderProfile(defaultProviderId) })
        return
      }
      const testProviderId = providerPathMatch(url.pathname, '/test')
      if (request.method === 'POST' && testProviderId !== undefined) {
        if (options.testProviderProfile === undefined) {
          sendJson(response, 405, { error: { code: 'provider_test_unavailable', message: 'Provider testing is unavailable' } })
          return
        }
        await options.testProviderProfile(testProviderId)
        sendJson(response, 200, { ok: true })
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
        })
        registry.add(session)
        sendJson(response, 201, { session: await session.summary() })
        return
      }

      const filesMatch = /^\/api\/workbench\/sessions\/([^/]+)\/files\/(list|stat|read)$/.exec(url.pathname)
      if (request.method === 'GET' && filesMatch !== null) {
        const session = registry.get(decodeURIComponent(filesMatch[1]!))
        if (!session) { sendJson(response, 404, { error: { code: 'session_not_found', message: 'Session was not found' } }); return }
        const value = await readWorkspaceFile((await session.summary()).workspace, url.searchParams.get('path') ?? '',
          filesMatch[2] as 'list' | 'stat' | 'read', Number(url.searchParams.get('offset') ?? 1), Number(url.searchParams.get('limit') ?? 200))
        sendJson(response, 200, value)
        return
      }

      const snapshotId = pathMatch(url.pathname, '')
      if (request.method === 'PATCH' && snapshotId !== undefined) {
        const session = registry.get(snapshotId)
        if (!session) { sendJson(response, 404, { error: { code: 'session_not_found', message: 'Session was not found' } }); return }
        if (!session.updateMetadata) { sendJson(response, 405, { error: { code: 'session_metadata_unavailable', message: 'Session metadata cannot be changed' } }); return }
        const body = await readBody(request)
        if (Object.keys(body).some(key => !['title', 'archived', 'pinned'].includes(key)) || !Object.keys(body).length) throw new Error('Expected title, archived or pinned')
        if (body['title'] !== undefined && (typeof body['title'] !== 'string' || !body['title'].trim() || body['title'].trim().length > 200)) throw new Error('title must be 1–200 characters')
        for (const key of ['archived', 'pinned']) if (body[key] !== undefined && typeof body[key] !== 'boolean') throw new Error(`${key} must be a boolean`)
        await registry.updateMetadata(snapshotId, {
          ...(typeof body['title'] === 'string' ? { title: body['title'].trim() } : {}),
          ...(typeof body['archived'] === 'boolean' ? { archived: body['archived'] } : {}),
          ...(body['archived'] === true || body['pinned'] === false ? { pinnedAt: 0 }
            : body['pinned'] === true ? { pinnedAt: (await session.summary()).pinnedAt || Date.now() } : {}),
        })
        sendJson(response, 200, { session: await session.summary() })
        return
      }
      if (request.method === 'GET' && snapshotId !== undefined) {
        const session = registry.get(snapshotId)
        if (session === undefined) {
          sendJson(response, 404, { error: { code: 'session_not_found', message: 'Session was not found' } })
          return
        }
        const source = await session.snapshot()
        const snapshot = { ...source, session: { ...source.session, imageLimits: IMAGE_LIMITS } }
        const cursor = url.searchParams.get('after')
        if (cursor === null) sendJson(response, 200, snapshot)
        else {
          const after = Number(cursor)
          if (!/^-?\d+$/.test(cursor) || !Number.isSafeInteger(after) || after < -1) throw new Error('after must be an event position >= -1')
          const base = after < snapshot.events.length ? after : -1
          sendJson(response, 200, { ...snapshot, after: base, events: snapshot.events.slice(base + 1) })
        }
        return
      }

      const coverId = pathMatch(url.pathname, '/cover')
      if (request.method === 'GET' && coverId !== undefined) {
        const session = registry.get(coverId)
        if (session === undefined) {
          sendJson(response, 404, { error: { code: 'session_not_found', message: 'Session was not found' } })
          return
        }
        sendJson(response, 200, projectSessionCover(await session.snapshot()))
        return
      }

      const analyticsId = pathMatch(url.pathname, '/analytics/tools')
      if (request.method === 'GET' && analyticsId !== undefined) {
        const session = registry.get(analyticsId)
        if (session === undefined) {
          sendJson(response, 404, { error: { code: 'session_not_found', message: 'Session was not found' } })
          return
        }
        sendJson(response, 200, projectToolAnalytics((await session.snapshot()).events))
        return
      }

      const pluginsId = pathMatch(url.pathname, '/analytics/plugins')
      if (request.method === 'GET' && pluginsId !== undefined) {
        const session = registry.get(pluginsId)
        if (session === undefined) {
          sendJson(response, 404, { error: { code: 'session_not_found', message: 'Session was not found' } })
          return
        }
        const snapshot = await session.snapshot()
        const assembly = options.assemblies?.get(snapshot.session.assembly)?.description
        sendJson(response, 200, projectPluginAnalytics(snapshot.events, assembly))
        return
      }

      const contextTimelineId = pathMatch(url.pathname, '/analytics/context')
      if (request.method === 'GET' && contextTimelineId !== undefined) {
        const session = registry.get(contextTimelineId)
        if (session === undefined) {
          sendJson(response, 404, { error: { code: 'session_not_found', message: 'Session was not found' } })
          return
        }
        sendJson(response, 200, projectContextTimeline((await session.snapshot()).events))
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
        const body = await readBody(request, ATTACHMENT_MESSAGE_BYTES)
        const content = body['content']
        if (body['mode'] !== undefined && body['mode'] !== 'queue' && body['mode'] !== 'steer') throw new Error('mode must be queue or steer')
        const submission = { mode: body['mode'] as 'queue' | 'steer' | undefined,
          ...(typeof body['requestId'] === 'string' ? { requestId: body['requestId'] } : {}) }
        if (typeof content !== 'string' && !Array.isArray(content) || typeof content === 'string' && content.trim().length === 0) {
          sendJson(response, 400, { error: { code: 'invalid_message', message: 'content must be a non-empty string' } })
          return
        }
        if (Array.isArray(content)) {
          const store = await attachmentStore(session)
          const admitted = await store.admit(content)
          if (!admitted.content.trim() && !admitted.attachments.length) throw new AttachmentError('Message is empty', 'EMPTY_MESSAGE')
          session.submit(admitted.content, admitted.attachments, submission)
          store.retire(content)
        } else session.submit(content as string, undefined, submission)
        sendJson(response, 202, { accepted: true })
        return
      }

      const queueId = pathMatch(url.pathname, '/queue')
      if (request.method === 'PATCH' && queueId !== undefined) {
        const session = registry.get(queueId)
        if (!session?.updateQueued) throw new Error('Queued input is unavailable')
        const body = await readBody(request)
        const action = body['action'] as { kind?: unknown; content?: unknown } | undefined
        if (typeof body['itemId'] !== 'string' || !action || !['remove', 'steer', 'edit'].includes(String(action.kind))) throw new Error('Invalid queue action')
        if (action.kind === 'edit' && typeof action.content !== 'string') throw new Error('Queue edit requires text')
        session.updateQueued(body['itemId'], action.kind === 'edit' ? { kind: 'edit', content: action.content as string } : { kind: action.kind as 'remove' | 'steer' })
        sendJson(response, 200, { accepted: true }); return
      }

      const configurationId = pathMatch(url.pathname, '/configuration')
      if (request.method === 'PATCH' && configurationId !== undefined) {
        const session = registry.get(configurationId)
        if (session?.configure === undefined) {
          sendJson(response, session === undefined ? 404 : 405, {
            error: {
              code: session === undefined ? 'session_not_found' : 'session_not_configurable',
              message: session === undefined ? 'Session was not found' : 'Session cannot be configured',
            },
          })
          return
        }
        const body = await readBody(request)
        const providerProfileId = body['providerProfileId']
        const approvalMode = body['approvalMode']
        const reasoningEffort = body['reasoningEffort']
        if (typeof providerProfileId !== 'string') throw new Error('providerProfileId must be a string')
        if (approvalMode !== 'ask' && approvalMode !== 'auto') throw new Error('approvalMode must be ask or auto')
        if (reasoningEffort !== undefined && !['none', 'low', 'high', 'max'].includes(String(reasoningEffort))) {
          throw new Error('reasoningEffort must be none, low, high, or max')
        }
        const profile = providerProfiles().find(item => item.id === providerProfileId)
        if (profile?.configured !== true) throw new Error(`Unknown configured Provider profile ${providerProfileId}`)
        if (reasoningEffort !== undefined && !profile.reasoningEfforts?.includes(reasoningEffort as ReasoningEffort)) {
          throw new Error(`Provider profile ${providerProfileId} does not support reasoning effort ${String(reasoningEffort)}`)
        }
        await session.configure({
          inference: {
            providerProfileId,
            provider: profile.adapter,
            model: profile.model,
            ...(reasoningEffort === undefined ? {} : { reasoningEffort: reasoningEffort as ReasoningEffort }),
          },
          approvalMode,
        })
        sendJson(response, 200, { session: await session.summary() })
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
      if (error instanceof Error && 'code' in error && ['session/queue-item-not-found', 'session/steer-unavailable'].includes(String(error.code))) {
        sendJson(response, 400, { error: { code: error.code, message: error.message, details: {} } }); return
      }
      if (error instanceof AttachmentError) {
        sendJson(response, 400, { error: { code: error.code, message: error.message, details: { reason: error.reason } } })
        return
      }
      if (error instanceof UserTerminalError) {
        sendJson(response, 400, { error: { code: error.code, message: error.message, details: error.details } })
        return
      }
      if (error instanceof WorkspaceFileError) {
        sendJson(response, error.code.endsWith('/not-found') ? 404 : 400, { error: { code: error.code, message: error.message } })
        return
      }
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
  server.once('close', () => { void terminals.dispose() })
  return server
}
