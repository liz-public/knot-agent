/** Disposable DSH history read model. Does not execute or mutate a Journal. */
import type { SessionSnapshotDto } from '../../src/workbench/session.js'
import type { ReadEvent } from '../../src/workbench/read-journal.js'
import { projectBusinessState } from './business-projection.ts'

export interface DshEventRecord {
  readonly type: 'event'
  readonly event: { readonly seq: number; readonly time: number; readonly type: string; readonly data: unknown; readonly surfaceOp?: string }
}
export interface ProjectedKnotSession {
  readonly sessionId: string
  readonly cwd?: string
  readonly title: string
  readonly updatedAt: number
  readonly createdAt: number
  readonly records: readonly DshEventRecord[]
  readonly attempts: Readonly<Record<string, { turn: number; step: number }>>
  readonly projections: { readonly asOfSeq: number; readonly values: Record<string, unknown> }
}
interface Step {
  turn: number
  step: number
  start: ReadEvent
  generated?: ReadEvent
  inference?: Record<string, any>
  pending: Set<string>
  closed: boolean
}
const object = (value: unknown): Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, any> : {}
const time = (event: ReadEvent): number => Date.parse(event.observedAt ?? '') || 0
const array = (value: unknown): Record<string, any>[] => Array.isArray(value) ? value.map(object) : []
const duration = (start: ReadEvent, end: ReadEvent): number =>
  time(start) > 0 && time(end) >= time(start) ? time(end) - time(start) : 0

/** API snapshots, not the rendered Chat, remain the source of this projection. */
export function projectKnotSnapshot(snapshot: SessionSnapshotDto): ProjectedKnotSession {
  const { events, session } = snapshot
  const records: DshEventRecord[] = []
  const turns = new Map<string, number>()
  const stepCounts = new Map<number, number>()
  const steps = new Map<string, Step>()
  const calls = new Map<string, { step: Step; start: ReadEvent }>()
  const completedTurns = new Set<number>()
  const generatedTurns = new Set<string>()
  // Native DSH reserves step 0 for non-assistant requests (e.g. compaction).
  let nextTurn = 1
  let active: number | undefined
  let latestInference: Record<string, any> | undefined
  let latestUsed: Record<string, any> | undefined
  let latestUsage: Record<string, any> | undefined
  let titleRequest: { turnId: string; inference?: Record<string, any> } | undefined
  let tools: Record<string, any>[] = []
  const compactions = new Map<string, { provider?: Record<string, any>; generated?: Record<string, any> }>()
  const stats = { turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 }

  const emit = (source: ReadEvent, type: string, data: unknown, surfaceOp?: string) => {
    records.push({ type: 'event', event: { seq: records.length, time: time(source), type, data, ...(surfaceOp ? { surfaceOp } : {}) } })
  }
  const turnFor = (id: unknown, event: ReadEvent) => {
    if (typeof id === 'string' && turns.has(id)) return turns.get(id)!
    const turn = active ?? nextTurn++
    if (typeof id === 'string') turns.set(id, turn)
    if (active === undefined) { active = turn; emit(event, 'turn/start', { turn }) }
    return turn
  }
  const begin = (id: string, turnId: unknown, event: ReadEvent) => {
    const turn = turnFor(turnId, event)
    const step = stepCounts.get(turn) ?? 1
    stepCounts.set(turn, step + 1)
    const value: Step = { turn, step, start: event, inference: latestInference, pending: new Set(), closed: false }
    steps.set(id, value)
    emit(event, 'step/start', { turn, step })
    return value
  }
  const close = (step: Step, event: ReadEvent) => {
    if (step.closed) return
    step.closed = true
    stats.steps++
    emit(event, 'step/end', { turn: step.turn, step: step.step })
  }

  for (const event of events) {
    const data = object(event.data)
    switch (event.type) {
      case 'system.prompt':
        emit(event, 'system/message', { turn: active ?? 0, step: 0,
          message: { role: 'system', content: [{ type: 'text', text: data.content ?? '' }] } }, 'append')
        break
      case 'tool.registry':
        tools = array(data.schemas)
        break
      case 'context.fixed': case 'context.dynamic':
        // Observed injections, not a claim that every past context remains in the current input.
        emit(event, 'developer/message', { message: { role: 'developer',
          id: `knot-context-${event.position}`, source: { kind: event.type },
          content: [{ type: 'text', text: data.content ?? '' }] } }, 'append')
        break
      case 'history.compress.request':
        compactions.set(data.requirementId, { provider: latestInference })
        emit(event, 'compaction/start', { compactionId: data.requirementId, turn: active ?? null })
        break
      case 'history.checkpoint': {
        const compact = compactions.get(data.requirementId)
        if (!compact) break
        emit(event, 'compaction/summary', { compactionId: data.requirementId,
          summary: [{ type: 'text', text: data.summary }], provider: compact.provider?.providerProfileId ?? 'unknown',
          model: compact.provider?.model ?? 'unknown',
          ...(compact.generated?.usage ? { usage: nativeUsage(compact.generated.usage) } : {}) })
        emit(event, 'compaction/end', { compactionId: data.requirementId, turn: active ?? null })
        break
      }
      case 'inference.configured':
        latestInference = data
        break
      case 'title.request':
        titleRequest = { turnId: data.turnId, inference: latestInference }
        break
      case 'session.title.configured': {
        const query = titleRequest === undefined ? undefined : records.find(record =>
          record.event.type === 'user/message' && object(record.event.data).id === 'knot-user-' + titleRequest!.turnId)
        emit(event, 'session/title', {
          title: data.title,
          messageSeqs: data.source === 'generated' && query ? [query.event.seq] : [],
          source: data.source === 'generated' ? {
            kind: 'provider', provider: 'knot-session-title',
            ...(titleRequest?.inference ? { model: {
              provider: titleRequest.inference.providerProfileId, model: titleRequest.inference.model,
            } } : {}),
          } : { kind: 'user' },
        })
        break
      }
      case 'user.message': {
        // An input admitted before the prior assistant commits is steering, not a new completed turn.
        const turn = turnFor(data.turnId, event)
        if (typeof data.turnId === 'string') turns.set(data.turnId, turn)
        emit(event, 'user/message', {
          content: [{ type: 'text', text: data.content ?? '' }], source: { kind: 'user' }, role: 'user', id: 'knot-user-' + data.turnId,
        }, 'append')
        break
      }
      case 'llm.invoke':
        if (data.request?.purpose === 'agent') {
          begin(data.requestId, data.request.turnId, event)
          latestUsed = latestInference === undefined ? undefined : { ...latestInference }
          emit(event, 'request/header', { reason: 'initial', header: {
            config: { provider: latestInference?.providerProfileId ?? 'unknown', model: latestInference?.model ?? 'unknown',
              ...(latestInference?.reasoningEffort ? { reasoningEffort: latestInference.reasoningEffort } : {}) },
            ...(tools.length ? { tools: tools.map(tool => ({ name: tool.function?.name,
              description: tool.function?.description, parameters: tool.function?.parameters })) } : {}),
          } })
          if (data.request.instruction) emit(event, 'developer/message', { message: { role: 'developer',
            id: `knot-instruction-${data.requestId}`, source: { kind: 'agent.instruction' },
            content: [{ type: 'text', text: data.request.instruction }] } }, 'append')
        } else if (data.request?.purpose === 'history.compress') {
          const compact = compactions.get(data.request.requirementId)
          if (compact) compact.provider = latestInference
        }
        break
      case 'llm.generated': {
        if (data.request?.purpose !== 'agent') {
          const compact = compactions.get(data.request?.requirementId)
          if (compact) compact.generated = data
          break
        }
        const step = steps.get(data.requestId) ?? begin(data.requestId, data.request.turnId, event)
        step.generated = event
        generatedTurns.add(data.request.turnId)
        const generated = object(data.generated)
        const content: unknown[] = []
        if (generated.reasoning) content.push({ type: 'reasoning', text: generated.reasoning })
        if (generated.content) content.push({ type: 'text', text: generated.content })
        for (const call of array(generated.toolCalls)) {
          content.push({ type: 'tool-call', id: call.id, name: call.name, arguments: JSON.stringify(call.arguments ?? {}) })
          step.pending.add(call.id)
        }
        const usage = object(data.usage)
        latestUsage = usage
        const timing = data.timing
        const timed = typeof timing?.durationMs === 'number' && Number.isFinite(timing.durationMs) && timing.durationMs >= 0
        stats.llmMs += timed ? timing.durationMs : duration(step.start, event)
        if (timed && typeof timing.ttftMs === 'number' && timing.ttftMs >= 0 && timing.ttftMs <= timing.durationMs) {
          stats.ttftMs += timing.ttftMs; stats.ttftSteps++
          const decodeMs = timing.durationMs - timing.ttftMs
          if (decodeMs > 0 && typeof usage.outputTokens === 'number') {
            stats.decodeMs += decodeMs; stats.decodeTokens += usage.outputTokens
          }
        }
        emit(event, 'assistant/message', {
          turn: step.turn, step: step.step,
          message: { role: 'assistant', content, id: 'knot-assistant-' + data.requestId,
            source: { kind: 'model', provider: step.inference?.providerProfileId ?? 'unknown', model: step.inference?.model ?? 'unknown' } },
          ...(nativeUsage(usage) ? { usage: nativeUsage(usage) } : {}),
          ...(timed ? { knotTiming: timing } : {}),
          stream: [],
        }, 'append')
        if (step.pending.size === 0) close(step, event)
        break
      }
      case 'tool.call': {
        const step = steps.get(data.sourceRequestId)
          ?? begin('tool-' + array(data.calls)[0]?.callId, data.turnId, event)
        for (const call of array(data.calls)) {
          step.pending.add(call.callId)
          calls.set(call.callId, { step, start: event })
          emit(event, 'tool/call', { turn: step.turn, step: step.step, callId: call.callId, name: call.name, arguments: JSON.stringify(call.arguments ?? {}) })
        }
        break
      }
      case 'tool.result':
        for (const result of array(data.results)) {
          const call = calls.get(result.callId)
          if (call === undefined) continue
          const { step } = call
          emit(event, 'tool/result', {
            turn: step.turn, step: step.step,
            message: { id: 'knot-tool-' + result.callId, role: 'tool', toolCallId: result.callId,
              source: { kind: 'tool', callId: result.callId },
              content: [{ type: 'text', text: result.content ?? '' }], isError: toolFailed(result.content) },
          }, 'append')
          stats.toolMs += duration(call.start, event)
          step.pending.delete(result.callId)
          if (step.pending.size === 0) close(step, event)
        }
        break
      case 'assistant.message': {
        const turn = turns.get(data.turnId)
        if (turn === undefined) break
        // Shortcuts can produce a committed answer without an llm.generated.
        if (!generatedTurns.has(data.turnId)) {
          emit(event, 'assistant/message', {
            turn, step: stepCounts.get(turn) ?? 0, stream: [],
            message: { role: 'assistant', id: 'knot-answer-' + data.turnId,
              source: { kind: 'model', provider: 'shortcut', model: 'shortcut' }, content: [{ type: 'text', text: data.content }] },
          }, 'append')
        }
        emit(event, 'turn/end', { turn, reason: { kind: 'completed' } })
        completedTurns.add(turn)
        if (active === turn) active = undefined
        break
      }
    }
  }
  stats.turns = completedTurns.size
  const business = projectBusinessState(snapshot)
  const values: Record<string, unknown> = {
    title: session.title,
    sessionStats: stats,
    knotEventCount: events.length,
    knotRunState: session.runState,
    ...business,
    modelSelection: {
      lastUsed: latestUsed === undefined ? null : selection(latestUsed),
      next: session.providerProfileId && session.model ? { provider: session.providerProfileId, model: session.model,
        ...(session.reasoningEffort ? { reasoningEffort: session.reasoningEffort } : {}) } : null,
    },
  }
  // DSH's accounting component assumes all cache buckets are known; omit the
  // aggregate rather than show a fictitious 0% cache hit for older logs.
  const usage = business.knotUsage
  if (usage.calls > 0 && usage.knownCalls === usage.calls && usage.cacheKnownCalls === usage.calls) values.tokenUsage = {
    uncachedInputTokens: usage.inputTokens - usage.cachedInputTokens, outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cachedInputTokens, cacheWriteTokens: 0,
  }
  if (typeof latestUsage?.inputTokens === 'number' && typeof latestUsage.contextWindow === 'number') {
    values.contextPressure = { pressureTokens: latestUsage.inputTokens, contextWindow: latestUsage.contextWindow }
  }
  const timestamps = events.map(time).filter(value => value > 0)
  return {
    sessionId: session.id, cwd: session.workspace, title: session.title,
    createdAt: timestamps[0] ?? 0,
    updatedAt: Date.parse(session.updatedAt ?? '') || timestamps.at(-1) || 0,
    records, attempts: Object.fromEntries([...steps].map(([id, value]) => [id, { turn: value.turn, step: value.step }])),
    projections: { asOfSeq: records.length - 1, values },
  }
}
function nativeUsage(usage: Record<string, any>) {
  return typeof usage.inputTokens === 'number' && typeof usage.outputTokens === 'number' ? {
    // DSH bills uncached input separately; Knot's inputTokens already includes the cache.
    inputTokens: usage.inputTokens - (usage.cachedInputTokens ?? 0), outputTokens: usage.outputTokens,
    ...(typeof usage.cachedInputTokens === 'number' ? { cacheReadTokens: usage.cachedInputTokens } : {}),
  } : undefined
}
function selection(value: Record<string, any>) {
  return { provider: value.providerProfileId, model: value.model,
    ...(value.reasoningEffort ? { reasoningEffort: value.reasoningEffort } : {}) }
}
function toolFailed(content: unknown): boolean {
  if (typeof content !== 'string') return false
  try { return object(JSON.parse(content)).ok === false } catch { return false }
}

/** Local fixture spike only. Production reads Workbench snapshots over HTTP. */
export function projectKnotJournal(raw: string, path: string): ProjectedKnotSession {
  const events: ReadEvent[] = raw.split(/\r?\n/u).filter(line => line.trim()).map((line, position) => {
    const value = JSON.parse(line)
    return { position, type: value.type, data: value.data, observedAt: value.meta?.observedAt }
  })
  const id = path.split(/[\\/]/u).at(-1)?.replace(/\.jsonl$/u, '') ?? 'journal'
  const workspaceEvent = [...events].reverse().find(event => event.type === 'context.fixed' || event.type === 'context.dynamic')
  const workspace = /^Current workspace:\s*(.+)$/mu.exec(object(workspaceEvent?.data).content ?? '')?.[1]
  return projectKnotSnapshot({
    session: { id, title: id, assembly: 'unknown', workspace, eventCount: events.length, writable: false, runState: 'completed' },
    events,
  })
}
