/** DSH presentation carrier over existing Knot HTTP APIs; no DSH Host. */
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { InteractionRequestDto, LiveSessionEvent, SessionSnapshotDto, SessionSummaryDto } from '../../src/workbench/session.js'
import type { ProviderProfileSummary } from '../../src/workbench/provider-profile.js'
import type { StudioSnapshotDto } from '../../src/workbench/studio.js'
import { projectKnotSnapshot } from './knot-journal-projection.ts'
import { interactionAnswer, interactionFrame } from './interaction-projection.ts'
import { GenerationProjection } from './generation-projection.ts'

type SubscribeSession = (id: string, listener: (event: LiveSessionEvent) => void, reconnect?: () => void) => () => void
const subscribeSession: SubscribeSession = (id, listener, reconnect) => {
  const source = new EventSource(`/api/workbench/sessions/${encodeURIComponent(id)}/stream`)
  source.addEventListener('session', event => listener(JSON.parse((event as MessageEvent).data)))
  source.addEventListener('open', () => reconnect?.())
  return () => source.close()
}

const ok = (value: unknown) => ({ ok: true as const, value })
const object = (value: unknown): Record<string, any> =>
  typeof value === 'object' && value !== null ? value as Record<string, any> : {}
function request(payload: unknown): Record<string, any> {
  const args = object(payload).args
  const first = Array.isArray(args) ? args[0] : args
  return object(object(first).request ?? first)
}
const unsupported = () => ({ ok: false as const, error: {
  code: 'knot/unconnected', message: 'This action has not been connected to Knot.', details: {},
} })

export function createWorkbenchRemote(
  fetcher: typeof fetch = fetch,
  subscribe: SubscribeSession = subscribeSession,
): ClientConnectionRpc {
  const pending = new Map<string, { sessionId: string; interaction: InteractionRequestDto }>()
  // Browser receipt identities only: never persisted into the Knot Journal.
  const prompts = new Map<string, { id: string; content: string; after: number; turnId?: string }[]>()
  let clientId: string | undefined
  const listeners = new Set<(endpoint: string, frame: unknown) => void>()
  const publish = (endpoint: string, frame: unknown) => {
    for (const listener of listeners) listener(endpoint, frame)
  }
  const http = async <T>(path: string, signal?: AbortSignal, method?: string, body?: unknown): Promise<T> => {
    const response = await fetcher('/api/workbench/' + path, { signal,
      ...(method ? { method } : {}), ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
    })
    const value = await response.json()
    if (!response.ok) throw new Error(value.error?.message ?? `Knot HTTP ${response.status}: ${path}`)
    return value as T
  }
  const get = <T>(path: string, signal?: AbortSignal) => http<T>(path, signal)
  const list = async (signal?: AbortSignal) =>
    (await get<{ sessions: SessionSummaryDto[] }>('sessions', signal)).sessions
  const snapshot = (id: string, signal?: AbortSignal) =>
    get<SessionSnapshotDto>('sessions/' + encodeURIComponent(id), signal)
  const children = (sessions: SessionSummaryDto[], id: string) => sessions
    .filter(session => session.parentSessionId === id)
    .map(session => ({ id: session.id, label: session.title,
      createdAt: 0, mode: 'unknown' as const }))
  const project = async (id: string, signal?: AbortSignal) => {
    const [source, sessions] = await Promise.all([snapshot(id, signal), list(signal)])
    const projected = projectKnotSnapshot(source)
    for (const prompt of prompts.get(id) ?? []) {
      const admitted = source.events.find(event => event.position >= prompt.after && event.type === 'user.message'
        && object(event.data).content === prompt.content && (prompt.turnId === undefined || object(event.data).turnId === prompt.turnId))
      if (!admitted) continue
      prompt.turnId = object(admitted.data).turnId
      const record = projected.records.find(record => record.event.type === 'user/message' && object(record.event.data).id === 'knot-user-' + prompt.turnId)
      if (record) object(record.event.data).source.rpcId = prompt.id
    }
    projected.projections.values.subagentCatalog = children(sessions, id)
    return { ...projected, writable: source.session.writable, runState: source.session.runState }
  }
  const row = (session: SessionSummaryDto) => ({
    sessionId: session.id, updatedAt: Date.parse(session.updatedAt ?? '') || 0,
    running: session.runState === 'running', blank: session.eventCount === 0,
    agentAvailable: session.writable,
    cwd: session.workspace, parentSessionId: session.parentSessionId,
    ...(session.parentSessionId ? { origin: 'subagent' } : {}),
    projections: { kind: 'cached', asOfSeq: -1, values: { title: session.title, knotEventCount: session.eventCount } },
  })
  const workspaces = (sessions: SessionSummaryDto[]) => {
    const paths = [...new Set(sessions.map(session => session.workspace).filter((path): path is string => !!path))]
    return paths.map(path => ({ workspaceId: path, path, title: path.split('/').filter(Boolean).at(-1) ?? path,
      sessionIds: sessions.filter(session => session.workspace === path && !session.parentSessionId).map(session => session.id),
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() }))
  }
  const created = async (input: Record<string, any>, signal?: AbortSignal) => {
    const { session } = await http<{ session: SessionSummaryDto }>('sessions', signal, 'POST', input)
    publish('$events', { type: 'emit', event: 'api-session/added', args: [row(session)] })
    for (const workspace of workspaces(await list(signal))) publish('workspace/follow', { type: 'upsert', workspace })
    return session
  }

  return {
    async call(_channel, endpoint, payload, signal) {
      try {
        const input = request(payload)
        switch (endpoint) {
          case '$events/result': {
            const outcome = object(input.outcome)
            // Withdrawal is not a user decision: never resolve the Host broker on scope loss or Ask close.
            if (outcome.kind === 'rejected') {
              if (object(outcome.error).code === 'ASK_CANCELLED') return ok(undefined)
              throw new Error(object(outcome.error).message ?? 'Client interaction failed')
            }
            const item = pending.get(input.eventId)
            if (input.clientId !== clientId || !item) throw new Error('Interaction delivery is no longer active')
            if (outcome.kind !== 'result') throw new Error('Interaction was not handled by this Client')
            const value = interactionAnswer(item.interaction, outcome.value)
            await http(`sessions/${encodeURIComponent(item.sessionId)}/interactions`, signal, 'POST', { id: item.interaction.id, value })
            pending.delete(input.eventId)
            publish('$events', { type: 'cancel', eventId: input.eventId })
            return ok(undefined)
          }
          case 'session/list': return ok({ items: (await list(signal)).map(row) })
          case 'session/prompt': {
            const id = input.sessionId
            const current = await snapshot(id, signal)
            if (!current.session.writable) throw new Error('Session is read-only')
            if (!Array.isArray(input.content) || input.content.some((part: any) => part.type !== 'text')) throw new Error('Attachments are not connected in B4')
            const content = input.content.map((part: any) => part.text).join('\n')
            if (!content.trim()) throw new Error('Message is empty')
            if (current.session.runState === 'paused') throw new Error('请先恢复 Session，再发送消息')
            if (current.session.runState === 'running' && input.mode !== 'steer') throw new Error('运行中仅支持 Steering；请使用 Cmd/Ctrl+Enter，或等待 idle 后发送')
            const receipts = prompts.get(id) ?? []
            const receipt = { id: input.requestId, content, after: current.events.length }
            receipts.push(receipt); prompts.set(id, receipts)
            try { await http(`sessions/${encodeURIComponent(id)}/messages`, signal, 'POST', { content }) }
            catch (error) { receipts.splice(receipts.indexOf(receipt), 1); throw error }
            return ok({ accepted: true })
          }
          case 'session/cancel': case 'knot/session/pause': case 'knot/session/resume': {
            const action = endpoint.endsWith('resume') ? 'resume' : 'pause'
            await http(`sessions/${encodeURIComponent(input.sessionId)}/${action}`, signal, 'POST')
            return ok({ accepted: true })
          }
          case 'session/projections': return ok((await project(input.sessionId, signal)).projections)
          case 'subagents/list': {
            const sessions = await list(signal)
            return ok({ parentAvailable: sessions.some(session => session.id === input.parentSessionId),
              entries: children(sessions, input.parentSessionId) })
          }
          case 'workspace/initializeDefault': return ok(undefined)
          case 'session/create': {
            // DSH can reconnect a blank Session through create(sessionId).
            if (input.sessionId) return ok({ sessionId: (await snapshot(input.sessionId, signal)).session.id })
            const session = await created({ ...(input.cwd || input.workspaceId ? { cwd: input.cwd ?? input.workspaceId } : {}) }, signal)
            return ok({ sessionId: session.id })
          }
          case 'knot/catalog': {
            const [profiles, studio] = await Promise.all([
              get<{ providers: ProviderProfileSummary[] }>('providers', signal), get<StudioSnapshotDto>('studio', signal),
            ])
            // Assembly roster comes from the Host, not another frontend manifest.
            const assemblies = [...new Map(studio.projects.map(project => [project.assembly.id, {
              id: project.assembly.id, title: project.assembly.title,
            }])).values()]
            return ok({ providers: profiles.providers, assemblies })
          }
          case 'knot/providers': return ok(await get('providers', signal))
          case 'knot/session': return ok((await snapshot(input.sessionId, signal)).session)
          case 'knot/inspection': {
            const [source, studio, sessions] = await Promise.all([
              snapshot(input.sessionId, signal), get<StudioSnapshotDto>('studio', signal), list(signal),
            ])
            return ok({ ...source, assembly: studio.projects.find(item => item.assembly.id === source.session.assembly)?.assembly,
              children: sessions.filter(item => item.parentSessionId === source.session.id) })
          }
          case 'knot/context': return ok(await get(`sessions/${encodeURIComponent(input.sessionId)}/context${input.requestId ? '?requestId=' + encodeURIComponent(input.requestId) : ''}`, signal))
          case 'knot/session/create': return ok(await created(input, signal))
          case 'knot/session/configure': {
            const current = (await snapshot(input.sessionId, signal)).session
            if (!current.writable || current.runState !== 'idle') throw new Error('Session is not idle and configurable')
            const profiles = (await get<{ providers: ProviderProfileSummary[] }>('providers', signal)).providers
            const profile = profiles.find(item => item.id === (input.providerProfileId ?? current.providerProfileId))
            if (!profile?.configured) throw new Error('Choose a configured Provider')
            const changed = profile.id !== current.providerProfileId
            const effort = Object.hasOwn(input, 'reasoningEffort') ? input.reasoningEffort
              : changed ? profile.defaultReasoningEffort : current.reasoningEffort
            const { session } = await http<{ session: SessionSummaryDto }>(`sessions/${encodeURIComponent(input.sessionId)}/configuration`, signal, 'PATCH', {
              providerProfileId: profile.id, approvalMode: input.approvalMode ?? current.approvalMode ?? 'ask',
              ...(effort === undefined || effort === '' ? {} : { reasoningEffort: effort }),
            })
            return ok(session)
          }
          case 'knot/providers/save': {
            const { id, ...draft } = input
            return ok(await http('providers' + (id ? '/' + encodeURIComponent(id) : ''), signal, id ? 'PATCH' : 'POST', draft))
          }
          case 'knot/providers/delete': case 'knot/providers/default': case 'knot/providers/test': {
            const action = endpoint.split('/').at(-1)!
            return ok(await http(`providers/${encodeURIComponent(input.id)}${action === 'delete' ? '' : '/' + action}`, signal,
              action === 'delete' ? 'DELETE' : 'POST'))
          }
          case 'settings/describe': return ok({ writable: false, hasDocument: false, namespaces: [{
            // Client presentation policy: diagnostic views on, no Host settings persisted.
            ns: 'ui-settings', schema: { type: 'object', dict: { enabled: { type: 'boolean' } } },
            value: { enabled: true }, autoGenerate: false, applies: 'live', secrets: [], revision: 0,
          }] })
          case 'credentials/describe': return ok({})
          case 'agentPresets/list': return ok({ presets: [] })
          case 'commands/list': return ok([])
          case 'permissionPresets/catalog': return ok({ options: [] })
          case 'dynamicCordisRunner/syncInspectManifest': return ok(null)
          case 'dynamicCordisRunner/inventory': return ok([])
          case 'terminal/list': return ok([])
          case 'skills/list': return ok({ skills: [] })
          case 'schedule/catalog': case 'schedule/list': return ok([])
          case 'account/getProfile': case 'account/getBalance': return ok(null)
          case 'account/getUnnotifiedBonuses': return ok(null)
          case 'session/canOpenWorkspacePath': return ok(false)
          default: return unsupported()
        }
      } catch (error) {
        return { ok: false, error: { code: 'knot/request-failed', message: String(error), details: {} } }
      }
    },
    async *open(_channel, endpoint, payload, signal) {
      const input = request(payload)
      const queue: unknown[] = []
      let wake: (() => void) | undefined
      const receive = (target: string, frame: unknown) => {
        if (target !== (endpoint === 'knot/live' ? 'knot/live/' + input.sessionId : endpoint)) return
        queue.push(frame); wake?.()
      }
      const aborted = () => wake?.()
      listeners.add(receive)
      signal.addEventListener('abort', aborted, { once: true })
      let unsubscribe: (() => void) | undefined
      let followedId: string | undefined
      let generationId: string | undefined
      let processing = Promise.resolve()
      try {
      switch (endpoint) {
        case '$events': {
          // No DSH Host: this only establishes the Client's read connection.
          generationId = clientId = crypto.randomUUID()
          const replay = [...pending.values()]
          yield { type: 'ready', clientId, host: { home: '' } }
          for (const item of replay) yield interactionFrame(item.sessionId, item.interaction)
          break
        }
        case 'session/control':
          yield { type: 'baseline', value: { projections: {} } }
          break
        case 'workspace/follow': {
          const sessions = await list(signal)
          yield { type: 'baseline', value: {
            items: workspaces(sessions),
            archivedSessionIds: [], pinnedSessionIds: [],
          } }
          break
        }
        case 'session/follow': {
          const address = object(input.address)
          const id = address.kind === 'session' ? address.sessionId : address.childSessionId
          followedId = id
          const generation = new GenerationProjection()
          const enqueue = (frame: unknown) => { if (!signal.aborted) { queue.push(frame); wake?.() } }
          let projected: Awaited<ReturnType<typeof project>>
          let cursor = -1
          const ready = new Promise<void>(resolve => { wake = resolve })
          const refresh = async () => {
            const next = await project(id, signal)
            for (const record of next.records.slice(cursor + 1)) {
              enqueue(record); cursor = record.event.seq
              if (record.event.type === 'assistant/message' && object(record.event.data).message?.id === 'knot-assistant-' + generation.active?.id) {
                const end = generation.end(cursor)
                if (end && input.assistantStream) enqueue(end)
              }
            }
            projected = next
            publish('knot/live/' + id, { kind: 'projection', values: next.projections.values })
            if (cursor >= 0) for (const [key, value] of Object.entries(next.projections.values)) publish('session/control', {
              type: 'projection', sessionId: id, key, value, seq: cursor,
            })
          }
          const handle = async (event: LiveSessionEvent) => {
            if (signal.aborted) return
            switch (event.kind) {
              case 'interaction.request': {
                const frame = interactionFrame(id, event.interaction)
                if (pending.has(frame.eventId)) break
                pending.set(frame.eventId, { sessionId: id, interaction: event.interaction })
                publish('$events', frame); break
              }
              case 'journal.changed': await refresh(); break
              case 'generation.open': {
                if (event.purpose !== 'agent') break
                await refresh()
                const coordinates = projected.attempts[event.requestId]
                const settled = projected.records.some(record => object(record.event.data).message?.id === 'knot-assistant-' + event.requestId)
                if (coordinates && !settled && input.assistantStream) {
                  // No stream prefix exists on Host reload. Only attempts whose open we saw are streamed.
                  const previous = generation.end(); if (previous) enqueue(previous)
                  enqueue(generation.start(event.requestId, coordinates, cursor))
                }
                break
              }
              case 'generation.update':
                for (const frame of generation.update(event.requestId, event.update, Date.parse((event as any).emittedAt ?? '') || Date.now())) enqueue(frame)
                break
              case 'generation.close': await refresh(); break
              case 'state.changed':
                publish('$events', { type: 'emit', event: 'api-session/status', args: [id, event.runState === 'running'] })
                publish('knot/live/' + id, event)
                if (event.runState === 'idle') {
                  await refresh()
                  const end = generation.end(); if (end) enqueue(end)
                }
                break
              case 'run.error': {
                const end = generation.end(); if (end) enqueue(end)
                publish('$events', { type: 'emit', event: 'api-session/error', args: [id, event.message] })
                publish('knot/live/' + id, event); break
              }
              default: publish('knot/live/' + id, event)
            }
          }
          const schedule = (event: LiveSessionEvent) => {
            processing = processing.then(() => ready).then(() => handle(event)).catch(error => {
              if (signal.aborted) return
              const end = generation.end(); if (end) enqueue(end)
              publish('$events', { type: 'emit', event: 'api-session/error', args: [id, String(error)] })
              publish('knot/live/' + id, { kind: 'run.error', message: String(error) })
            })
          }
          // Subscribe before the snapshot read; queued events cannot fall into a read/subscribe gap.
          unsubscribe = subscribe(id, schedule, () => schedule({ kind: 'journal.changed' }))
          projected = await project(id, signal)
          cursor = projected.records.length - 1
          const initialized = wake!; wake = undefined; initialized()
          if (!projected.writable) { unsubscribe(); unsubscribe = undefined }
          yield { type: 'snapshot', header: { version: 3, id, cwd: projected.cwd, createdAt: projected.createdAt, isSeeded: false },
            cursor: projected.records.length - 1, records: projected.records, hasMore: false, projections: projected.projections,
            ...(input.assistantStream ? { assistantStream: { revision: 0 } } : {}),
          }
          break
        }
        case 'knot/live': {
          const source = await snapshot(input.sessionId, signal)
          yield { kind: 'state.changed', runState: source.session.runState }
          yield { kind: 'projection', values: projectKnotSnapshot(source).projections.values }
          break
        }
        case 'job/list': yield { type: 'rows', jobs: [] }; break
        case 'account/watch': yield { status: 'signed-out', attempt: null, links: {} }; break
        default: throw new Error(`Unconnected Knot read stream: ${endpoint}`)
      }
      while (!signal.aborted) {
        if (queue.length === 0) await new Promise<void>(resolve => { wake = resolve })
        wake = undefined
        while (queue.length && !signal.aborted) yield queue.shift()
      }
      } finally {
        unsubscribe?.()
        if (followedId !== undefined) for (const [eventId, item] of pending) {
          if (item.sessionId !== followedId) continue
          pending.delete(eventId)
          publish('$events', { type: 'cancel', eventId })
        }
        if (generationId === clientId) clientId = undefined
        listeners.delete(receive)
        signal.removeEventListener('abort', aborted)
      }
    },
  }
}
