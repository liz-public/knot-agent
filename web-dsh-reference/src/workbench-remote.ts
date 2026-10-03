/** Read-only DSH presentation carrier over the existing Knot HTTP API. */
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionSnapshotDto, SessionSummaryDto } from '../../src/workbench/session.js'
import { projectKnotSnapshot } from './knot-journal-projection.ts'

const ok = (value: unknown) => ({ ok: true as const, value })
const object = (value: unknown): Record<string, any> =>
  typeof value === 'object' && value !== null ? value as Record<string, any> : {}
function request(payload: unknown): Record<string, any> {
  const args = object(payload).args
  const first = Array.isArray(args) ? args[0] : args
  return object(object(first).request ?? first)
}
const unsupported = () => ({ ok: false as const, error: {
  code: 'knot/read-only', message: 'B1 is read-only. This action has not been connected to Knot.', details: {},
} })

export function createWorkbenchRemote(
  fetcher: typeof fetch = fetch,
): ClientConnectionRpc {
  const get = async <T>(path: string, signal?: AbortSignal): Promise<T> => {
    const response = await fetcher('/api/workbench/' + path, { signal })
    if (!response.ok) throw new Error(`Knot HTTP ${response.status}: ${path}`)
    return await response.json() as T
  }
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
    return projected
  }
  const row = (session: SessionSummaryDto) => ({
    sessionId: session.id, updatedAt: Date.parse(session.updatedAt ?? '') || 0,
    running: session.runState === 'running', blank: session.eventCount === 0,
    cwd: session.workspace, parentSessionId: session.parentSessionId,
    ...(session.parentSessionId ? { origin: 'subagent' } : {}),
    projections: { kind: 'cached', asOfSeq: -1, values: { title: session.title, knotEventCount: session.eventCount } },
  })

  return {
    async call(_channel, endpoint, payload, signal) {
      try {
        const input = request(payload)
        switch (endpoint) {
          case 'session/list': return ok({ items: (await list(signal)).map(row) })
          case 'session/projections': return ok((await project(input.sessionId, signal)).projections)
          case 'subagents/list': {
            const sessions = await list(signal)
            return ok({ parentAvailable: sessions.some(session => session.id === input.parentSessionId),
              entries: children(sessions, input.parentSessionId) })
          }
          case 'workspace/initializeDefault': return ok(undefined)
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
        return { ok: false, error: { code: 'knot/read-failed', message: String(error), details: {} } }
      }
    },
    async *open(_channel, endpoint, payload, signal) {
      const input = request(payload)
      switch (endpoint) {
        case '$events':
          // No DSH Host: this only establishes the Client's read connection.
          yield { type: 'ready', clientId: 'knot-readonly', host: { home: '' } }
          break
        case 'session/control':
          yield { type: 'baseline', value: { projections: {} } }
          break
        case 'workspace/follow': {
          const sessions = await list(signal)
          const paths = [...new Set(sessions.map(session => session.workspace).filter((path): path is string => !!path))]
          yield { type: 'baseline', value: {
            items: paths.map(path => ({ workspaceId: path, path, title: path.split('/').filter(Boolean).at(-1) ?? path,
              sessionIds: sessions.filter(session => session.workspace === path && !session.parentSessionId).map(session => session.id),
              createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() })),
            archivedSessionIds: [], pinnedSessionIds: [],
          } }
          break
        }
        case 'session/follow': {
          const address = object(input.address)
          const id = address.kind === 'session' ? address.sessionId : address.childSessionId
          const projected = await project(id, signal)
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
      // B1 is snapshot-only, not a simulated live stream. Dispose on navigation.
      if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    },
  }
}
