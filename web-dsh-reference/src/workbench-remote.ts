/** DSH presentation carrier over existing Knot HTTP APIs; no DSH Host. */
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { InteractionRequestDto, LiveSessionEvent, SessionSnapshotDto, SessionSummaryDto } from '../../src/workbench/session.js'
import type { ProviderProfileSummary } from '../../src/workbench/provider-profile.js'
import type { StudioSnapshotDto } from '../../src/workbench/studio.js'
import { projectKnotSnapshot } from './knot-journal-projection.ts'
import { interactionAnswer, interactionFrame } from './interaction-projection.ts'

type SubscribeSession = (id: string, listener: (event: LiveSessionEvent) => void) => () => void
const subscribeSession: SubscribeSession = (id, listener) => {
  const source = new EventSource(`/api/workbench/sessions/${encodeURIComponent(id)}/stream`)
  source.addEventListener('session', event => listener(JSON.parse((event as MessageEvent).data)))
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
    projected.projections.values.subagentCatalog = children(sessions, id)
    return { ...projected, writable: source.session.writable }
  }
  const row = (session: SessionSummaryDto) => ({
    sessionId: session.id, updatedAt: Date.parse(session.updatedAt ?? '') || 0,
    running: session.runState === 'running', blank: session.eventCount === 0,
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
          case 'knot/session/create': return ok(await created(input, signal))
          case 'knot/session/configure': {
            const current = (await snapshot(input.sessionId, signal)).session
            if (!current.writable || current.runState === 'running') throw new Error('Session is not idle and configurable')
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
        if (target !== endpoint) return
        queue.push(frame); wake?.()
      }
      const aborted = () => wake?.()
      listeners.add(receive)
      signal.addEventListener('abort', aborted, { once: true })
      let unsubscribe: (() => void) | undefined
      let followedId: string | undefined
      let generationId: string | undefined
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
          const projected = await project(id, signal)
          followedId = id
          if (projected.writable) unsubscribe = subscribe(id, event => {
            if (event.kind !== 'interaction.request') return
            const frame = interactionFrame(id, event.interaction)
            if (pending.has(frame.eventId)) return
            pending.set(frame.eventId, { sessionId: id, interaction: event.interaction })
            publish('$events', frame)
          })
          yield { type: 'snapshot', header: { version: 3, id, cwd: projected.cwd, createdAt: projected.createdAt, isSeeded: false },
            cursor: projected.records.length - 1, records: projected.records, hasMore: false, projections: projected.projections,
            ...(input.assistantStream ? { assistantStream: { revision: 0 } } : {}),
          }
          break
        }
        case 'job/list': yield { type: 'rows', jobs: [] }; break
        case 'account/watch': yield { status: 'signed-out', attempt: null, links: {} }; break
        default: throw new Error(`Unconnected Knot read stream: ${endpoint}`)
      }
      // B3 forwards interaction ports only; execution/history live updates wait for B4.
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
