/**
 * Adapted from DeepSeek Harness v0.2.0-rc.1's assembled Web fixture (MIT).
 * RemoteMock scenario for a real DSH client tree that does not own a Host.
 * The adjacent JSON is maintained with this module when Remote responses or
 * the current Session header version change.
 * Fixture Sessions have no retained Host terminals to restore.
 */

import { ok, openStream, RemoteMock, type RemoteTable } from '@deepseek-ai/dsh-remote-mock'
import fixture from './assembled-remote.fixture.json'
import type { DshEventRecord, ProjectedKnotSession } from './knot-journal-projection.ts'

/** Boot-time defaults copied from the rc.1 assembled-client test seam. */
const remoteDefaultResponses: RemoteTable = {
  unary: {
    'session/list': ok({ items: [] }),
    'workspace/initializeDefault': ok(undefined),
    'settings/describe': ok({ writable: true, hasDocument: false, namespaces: [] }),
    'session/modelCatalog': ok({
      default: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      routableProviders: [],
      groups: [],
      failures: [],
    }),
    'agentPresets/list': ok({ presets: [] }),
    'dynamicCordisRunner/syncInspectManifest': ok(null),
    'dynamicCordisRunner/inventory': ok([]),
    'credentials/describe': ok({}),
    'permissionPresets/catalog': ok({ options: [] }),
    'account/getProfile': ok(null),
    'account/getBalance': ok(null),
    'account/getUnnotifiedBonuses': ok(null),
    'account/ackBonusNotified': ok(true),
  },
  streams: ['session/follow'],
  stream: {
    'session/control': openStream([{ type: 'baseline', value: { projections: {} } }]),
    'account/watch': openStream([{
      status: 'signed-out',
      attempt: null,
      links: {
        usageUrl: 'https://platform.deepseek.com/usage',
        topUpUrl: 'https://platform.deepseek.com/top_up',
      },
    }]),
    'workspace/follow': openStream([{
      type: 'baseline',
      value: { items: [], archivedSessionIds: [], pinnedSessionIds: [] },
    }]),
  },
}

interface SessionSummary {
  readonly sessionId: string
  updatedAt: number
  running: boolean
  blank: boolean
  readonly parentSessionId?: string
  readonly origin?: 'subagent'
  readonly cwd?: string
  readonly projections?: {
    readonly kind: 'cached' | 'sequenced'
    readonly asOfSeq: number
    readonly values: Readonly<Record<string, unknown>>
  }
}

interface WorkspaceView {
  readonly workspaceId: string
  readonly path: string
  readonly title: string
  sessionIds: string[]
  readonly createdAt: string
  updatedAt: string
}

type EventRecord = DshEventRecord

interface FollowSnapshot {
  readonly type: 'snapshot'
  readonly header: Readonly<Record<string, unknown>>
  readonly cursor: number
  readonly records: readonly EventRecord[]
  readonly hasMore: boolean
  readonly projections: Readonly<Record<string, unknown>>
  readonly assistantStream?: Readonly<Record<string, unknown>>
}

interface ControlBaseline {
  readonly type: 'baseline'
  readonly value: {
    readonly queues: Readonly<Record<string, readonly unknown[]>>
    readonly approvals: readonly unknown[]
    readonly questions: readonly unknown[]
    readonly projections: Readonly<Record<string, {
      readonly asOfSeq: number
      readonly values: Readonly<Record<string, unknown>>
    }>>
  }
}

interface CapturedFixture {
  readonly sessionList: { readonly ok: true; readonly value: { readonly items: readonly SessionSummary[] } }
  readonly settingsDescribe: {
    readonly ok: true
    readonly value: {
      readonly writable: boolean
      readonly hasDocument: boolean
      readonly namespaces: readonly unknown[]
    }
  }
  readonly credentialsDescribe: unknown
  readonly modelCatalog: unknown
  readonly agentPresets: unknown
  readonly commands: unknown
  readonly workspace: {
    readonly type: 'baseline'
    readonly value: {
      readonly items: readonly WorkspaceView[]
      readonly archivedSessionIds: readonly string[]
      readonly pinnedSessionIds: readonly string[]
    }
  }
  readonly control: ControlBaseline
  readonly remoteEvents: readonly unknown[]
  readonly follow: FollowSnapshot
  readonly attachment: unknown
}

export interface AssembledRemoteOptions {
  /** Override the schema-resolved Host preference for developer-tool scenarios. */
  readonly developerTools?: boolean
  /** Return the fixture's image-dimension admission error from Session prompt. */
  readonly rejectPrompt?: boolean
  /** Optional real Knot Journal projected into the otherwise unchanged DSH client. */
  readonly journal?: ProjectedKnotSession
}

export interface AssembledRemote {
  readonly mock: RemoteMock
}

/** Create one isolated RemoteMock world for an assembled built-client case. */
export function createAssembledRemote(options: AssembledRemoteOptions = {}): AssembledRemote {
  const captured = fixture as CapturedFixture
  const sessions = options.journal === undefined
    ? [...structuredClone(captured.sessionList.value.items)]
    : [{
        sessionId: options.journal.sessionId,
        updatedAt: options.journal.updatedAt,
        running: false,
        blank: options.journal.records.length === 0,
        cwd: options.journal.cwd,
      }]
  const workspaces = options.journal === undefined
    ? [...structuredClone(captured.workspace.value.items)]
    : [{
        workspaceId: 'knot-journal-workspace',
        path: options.journal.cwd ?? '',
        title: options.journal.cwd?.split('/').filter(Boolean).at(-1) ?? options.journal.sessionId,
        sessionIds: [options.journal.sessionId],
        createdAt: new Date(options.journal.updatedAt).toISOString(),
        updatedAt: new Date(options.journal.updatedAt).toISOString(),
      }]
  const records = new Map<string, EventRecord[]>(options.journal === undefined
    ? [['fx-alpha', structuredClone(captured.follow.records) as EventRecord[]]]
    : [[options.journal.sessionId, structuredClone(options.journal.records) as EventRecord[]]])
  const nextTurns = new Map([...records].map(([sessionId, sessionRecords]) => {
    let next = 0
    for (const { event } of sessionRecords) {
      if (event.type !== 'turn/start' || !isRecord(event.data)) continue
      const turn = event.data['turn']
      if (typeof turn === 'number') next = Math.max(next, turn + 1)
    }
    return [sessionId, next] as const
  }))
  const attachments = new Map<string, unknown>([['fixture:image', structuredClone(captured.attachment)]])
  const blankSessionProjections = captured.control.value.projections['fx-gamma']
  if (blankSessionProjections === undefined) {
    throw new Error('assembled fixture: blank Session projections missing')
  }
  let nextSession = 1

  const mock = RemoteMock.create().load(remoteDefaultResponses)
  mock.load({
    unary: {
      'settings/describe': ok({
        ...captured.settingsDescribe.value,
        namespaces: [
          ...captured.settingsDescribe.value.namespaces,
          {
            ns: 'ui-settings',
            schema: { type: 'object', dict: { enabled: { type: 'boolean' } } },
            value: { enabled: options.developerTools ?? true },
            autoGenerate: false,
            applies: 'live',
            secrets: [],
            revision: 0,
          },
          {
            ns: 'ui-settings-general',
            schema: { type: 'object', dict: { welcomeNoticeVersion: { type: 'string' } } },
            value: { welcomeNoticeVersion: '2026-09-28.1' },
            autoGenerate: false,
            applies: 'live',
            secrets: [],
            revision: 0,
          },
        ],
      }),
      'credentials/describe': structuredClone(captured.credentialsDescribe),
      'session/modelCatalog': structuredClone(captured.modelCatalog),
      'agentPresets/list': structuredClone(captured.agentPresets),
      'commands/list': structuredClone(captured.commands),
      'settings/openSettingsDocument': ok({ opened: true }),
      'subagents/list': ok({ entries: [], parentAvailable: true }),
      'terminal/list': ok([]),
      'skills/list': ok({ skills: [] }),
      'session/canOpenWorkspacePath': ok(true),
      'session/openWorkspacePath': ok({ opened: true }),
      'session/updateQueue': {
        ok: false,
        error: {
          code: 'session/queue-item-not-found',
          message: 'assembled fixture has no pending queue item',
          details: {},
        },
      },
      'session/cancel': ok({ accepted: true }),
    },
  })

  mock.stream('$events', (_args, stream) => {
    for (const frame of captured.remoteEvents) stream.push(structuredClone(frame))
  })
  mock.stream('session/control', (_args, stream) => {
    stream.push(structuredClone(captured.control))
  })
  mock.stream('job/list', (_args, stream) => {
    stream.push({ type: 'rows', jobs: [] })
  })
  mock.stream('workspace/follow', (_args, stream) => {
    stream.push({
      type: 'baseline',
      value: {
        items: structuredClone(workspaces),
        archivedSessionIds: structuredClone(captured.workspace.value.archivedSessionIds),
        pinnedSessionIds: structuredClone(captured.workspace.value.pinnedSessionIds),
      },
    })
  })
  mock.stream('session/follow', ([args], stream) => {
    const request = recordValue(args, 'request')
    const sessionId = followedSessionId(request)
    if (options.journal === undefined && sessionId === 'fx-alpha') {
      stream.push(structuredClone(captured.follow))
      return
    }
    const summary = sessions.find(candidate => candidate.sessionId === sessionId)
    if (summary === undefined) throw new Error(`assembled fixture: no Session ${sessionId}`)
    const sessionRecords = records.get(sessionId) ?? []
    stream.push({
      type: 'snapshot',
      header: {
        version: 3,
        id: sessionId,
        createdAt: summary.updatedAt,
        cwd: summary.cwd,
        isSeeded: false,
      },
      cursor: sessionRecords.at(-1)?.event.seq ?? -1,
      records: structuredClone(sessionRecords),
      hasMore: false,
      projections: structuredClone(options.journal?.sessionId === sessionId ? options.journal.projections : blankSessionProjections),
      ...isAssistantStreamRequested(request) ? { assistantStream: { revision: 0 } } : {},
    })
  })

  mock.unary('$events/result', (result: unknown) => {
    const eventId = recordString(result, 'eventId')
    mock.streams.push('$events', { type: 'cancel', eventId })
    return ok(undefined)
  })
  mock.unary('session/list', () => ok({ items: structuredClone(sessions) }))
  // The shipped bundle layers this graph composes carry the `ui-schedule` row
  // disabled, so the Schedule client does not mount and no case here reads the
  // catalog or the per-Session list. Both stay declared so an enabled
  // composition reads empty lists instead of a missing-rule failure.
  mock.unary('schedule/catalog', () => ok([]))
  mock.unary('schedule/list', () => ok([]))
  mock.unary('session/projections', (request: unknown) => {
    const sessionId = recordString(recordValue(request, 'request'), 'sessionId')
    const summary = sessions.find(candidate => candidate.sessionId === sessionId)
    return ok(structuredClone(summary?.projections ?? captured.control.value.projections[sessionId] ?? null))
  })
  mock.unary('workspace/create', (request: unknown) => {
    const path = recordString(recordValue(request, 'request'), 'path')
    const existing = workspaces.find(workspace => workspace.path === path)
    if (existing !== undefined) return ok({ workspace: structuredClone(existing), created: false })
    const now = new Date().toISOString()
    const workspace = {
      workspaceId: `fx-ws-${String(workspaces.length + 1)}`,
      path,
      title: path.split('/').filter(Boolean).at(-1) ?? path,
      sessionIds: [],
      createdAt: now,
      updatedAt: now,
    }
    workspaces.unshift(workspace)
    mock.streams.push('workspace/follow', { type: 'upsert', workspace: structuredClone(workspace) })
    return ok({ workspace: structuredClone(workspace), created: true })
  })
  mock.unary('session/create', (request: unknown) => {
    request = recordValue(request, 'request')
    const requestedId = optionalRecordString(request, 'sessionId')
    const sessionId = requestedId ?? `fx-${String(nextSession++)}`
    const existing = sessions.find(candidate => candidate.sessionId === sessionId)
    if (existing !== undefined) return ok({ sessionId })
    const workspaceId = optionalRecordString(request, 'workspaceId')
    const workspace = workspaces.find(candidate => candidate.workspaceId === workspaceId)
    const cwd = workspace?.path ?? optionalRecordString(request, 'cwd') ?? '/tmp/fixture'
    const summary: SessionSummary = {
      sessionId,
      updatedAt: Date.now(),
      running: false,
      blank: true,
      cwd,
      // The created Session is live on this fixture Host: its list block is
      // sequenced, like the block the real live registry would serve.
      projections: { kind: 'sequenced', ...structuredClone(blankSessionProjections) },
    }
    sessions.push(summary)
    records.set(sessionId, [])
    nextTurns.set(sessionId, 0)
    if (workspace !== undefined && !workspace.sessionIds.includes(sessionId)) {
      workspace.sessionIds = [sessionId, ...workspace.sessionIds]
      workspace.updatedAt = new Date().toISOString()
      mock.streams.push('workspace/follow', {
        type: 'upsert',
        workspace: structuredClone(workspace),
      })
    }
    mock.streams.push('$events', { type: 'emit', event: 'api-session/added', args: [structuredClone(summary)] })
    return ok({ sessionId })
  })
  mock.unary('session/attachment', (request: unknown) => {
    request = recordValue(request, 'request')
    const attachmentId = recordString(request, 'attachmentId')
    return attachments.get(attachmentId) ?? {
      ok: false,
      error: {
        code: 'session/attachment-invalid',
        message: `assembled fixture attachment ${attachmentId} is missing`,
        details: { reason: 'ATTACHMENT_NOT_FOUND' },
      },
    }
  })
  mock.unary('session/prompt', (request: unknown) => {
    request = recordValue(request, 'request')
    if (options.rejectPrompt === true) {
      return {
        ok: false,
        error: {
          code: 'session/attachment-invalid',
          message: 'assembled fixture: image side exceeds the deployment limit',
          details: { reason: 'IMAGE_DIMENSION_TOO_LARGE' },
        },
      }
    }
    const sessionId = recordString(request, 'sessionId')
    const requestId = recordString(request, 'requestId')
    const sessionRecords = records.get(sessionId) ?? []
    const summary = sessions.find(candidate => candidate.sessionId === sessionId)
    if (summary === undefined) throw new Error(`assembled fixture: no Session ${sessionId}`)
    const content = recordArray(request, 'content').map((part) => {
      if (!isRecord(part) || part.type !== 'image') return part
      const attachmentId = `assembled:${crypto.randomUUID()}`
      const data = recordString(part, 'data')
      const attachment = {
        attachmentId,
        mediaType: recordString(part, 'mediaType'),
        bytes: Math.max(1, Math.floor(data.length * 3 / 4)),
        width: 160,
        height: 90,
        ...optionalRecordString(part, 'name') === undefined
          ? {}
          : { name: optionalRecordString(part, 'name') },
      }
      attachments.set(attachmentId, ok({ attachment, data }))
      return { type: 'image', attachment }
    })
    const turn = nextTurns.get(sessionId) ?? 0
    nextTurns.set(sessionId, turn + 1)
    summary.updatedAt = Date.now()
    summary.blank = false
    if (!summary.running) {
      summary.running = true
      mock.streams.push('$events', { type: 'emit', event: 'api-session/status', args: [sessionId, true] })
    }
    const turnEvent = eventOf(sessionRecords.length, 'turn/start', { turn })
    const userEvent = eventOf(sessionRecords.length + 1, 'user/message', {
      content,
      source: { kind: 'user', rpcId: requestId },
      role: 'user',
      id: crypto.randomUUID(),
    }, 'append')
    sessionRecords.push(turnEvent, userEvent)
    records.set(sessionId, sessionRecords)
    mock.streams.push('session/follow', turnEvent, follows(sessionId))
    mock.streams.push('session/follow', userEvent, follows(sessionId))
    return ok({ accepted: true })
  })
  mock.unary('commands/execute', (args: unknown) => {
    const line = optionalRecordString(args, 'line') ?? ''
    const name = /^\/(\S+)/u.exec(line.trim())?.[1]
    if (name === undefined || !['compact', 'echo', 'goal', 'permission', 'plan'].includes(name)) {
      return ok(undefined)
    }
    return ok({
      commandId: `assembled-command-${crypto.randomUUID()}`,
      result: {
        kind: 'success',
        ...name === 'echo' ? { text: line.replace(/^\/echo\s*/u, '') } : {},
      },
    })
  })

  return { mock }
}

function eventOf(
  seq: number,
  type: string,
  data: unknown,
  surfaceOp?: string,
): EventRecord {
  return {
    type: 'event',
    event: {
      seq,
      time: Date.now(),
      type,
      data,
      ...(surfaceOp === undefined ? {} : { surfaceOp }),
    },
  }
}

function follows(sessionId: string): (args: readonly unknown[]) => boolean {
  return ([args]) => followedSessionId(recordValue(args, 'request')) === sessionId
}

function followedSessionId(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.address)) throw new TypeError('assembled fixture follow request is invalid')
  return value.address.kind === 'session'
    ? recordString(value.address, 'sessionId')
    : recordString(value.address, 'childSessionId')
}

function isAssistantStreamRequested(value: unknown): boolean {
  return isRecord(value) && value.assistantStream === true
}

function recordString(value: unknown, key: string): string {
  const selected = isRecord(value) ? value[key] : undefined
  if (typeof selected !== 'string') throw new TypeError(`assembled fixture ${key} must be a string`)
  return selected
}

function optionalRecordString(value: unknown, key: string): string | undefined {
  const selected = isRecord(value) ? value[key] : undefined
  if (selected === undefined) return undefined
  if (typeof selected !== 'string') throw new TypeError(`assembled fixture ${key} must be a string`)
  return selected
}

function recordArray(value: unknown, key: string): readonly unknown[] {
  const selected = isRecord(value) ? value[key] : undefined
  if (!Array.isArray(selected)) throw new TypeError(`assembled fixture ${key} must be an array`)
  return selected
}

function recordValue(value: unknown, key: string): unknown {
  if (!isRecord(value) || !(key in value)) throw new TypeError(`assembled fixture ${key} is missing`)
  return value[key]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
