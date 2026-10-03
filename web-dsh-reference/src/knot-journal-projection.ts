/** Disposable DSH history read model. Does not execute or mutate a Journal. */
import type { SessionSnapshotDto } from '../../src/workbench/session.js'
import type { ReadEvent } from '../../src/workbench/read-journal.js'

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
  const closedTurns = new Set<number>()
  const generatedTurns = new Set<string>()
  let nextTurn = 0
  let active: number | undefined
  let latestInference: Record<string, any> | undefined
  let latestUsed: Record<string, any> | undefined
  let latestUsage: Record<string, any> | undefined
  const stats = { turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 }
  const tokens = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  let usageKnown = true
  let cacheKnown = true
  let usageCount = 0

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
    const step = stepCounts.get(turn) ?? 0
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
    closedTurns.add(step.turn)
    emit(event, 'step/end', { turn: step.turn, step: step.step })
  }

  for (const event of events) {
    const data = object(event.data)
    switch (event.type) {
      case 'inference.configured':
        latestInference = data
        break
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
        }
        break
      case 'llm.generated': {
        if (data.request?.purpose !== 'agent') break
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
        usageCount++
        usageKnown &&= typeof usage.inputTokens === 'number' && typeof usage.outputTokens === 'number'
        cacheKnown &&= typeof usage.cachedInputTokens === 'number'
        if (typeof usage.inputTokens === 'number') {
          tokens.cacheReadTokens += usage.cachedInputTokens ?? 0
          tokens.uncachedInputTokens += usage.inputTokens - (usage.cachedInputTokens ?? 0)
        }
        tokens.outputTokens += usage.outputTokens ?? 0
        stats.llmMs += duration(step.start, event)
        emit(event, 'assistant/message', {
          turn: step.turn, step: step.step,
          message: { role: 'assistant', content, id: 'knot-assistant-' + data.requestId,
            source: { kind: 'model', provider: step.inference?.providerProfileId ?? 'unknown', model: step.inference?.model ?? 'unknown' } },
          ...(typeof usage.inputTokens === 'number' && typeof usage.outputTokens === 'number' ? {
            usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
              ...(typeof usage.cachedInputTokens === 'number' ? { cacheReadTokens: usage.cachedInputTokens } : {}) },
          } : {}),
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
        if (active === turn) active = undefined
        break
      }
    }
  }
  stats.turns = closedTurns.size
  const values: Record<string, unknown> = {
    title: session.title,
    sessionStats: stats,
    knotEventCount: events.length,
    modelSelection: {
      lastUsed: latestUsed === undefined ? null : selection(latestUsed),
      next: session.providerProfileId && session.model ? { provider: session.providerProfileId, model: session.model,
        ...(session.reasoningEffort ? { reasoningEffort: session.reasoningEffort } : {}) } : null,
    },
  }
  // DSH's accounting component assumes all cache buckets are known; omit the
  // aggregate rather than show a fictitious 0% cache hit for older logs.
  if (usageCount > 0 && usageKnown && cacheKnown) values.tokenUsage = tokens
  if (typeof latestUsage?.inputTokens === 'number' && typeof latestUsage.contextWindow === 'number') {
    values.contextPressure = { pressureTokens: latestUsage.inputTokens, contextWindow: latestUsage.contextWindow }
  }
  const timestamps = events.map(time).filter(value => value > 0)
  return {
    sessionId: session.id, cwd: session.workspace, title: session.title,
    createdAt: timestamps[0] ?? 0,
    updatedAt: Date.parse(session.updatedAt ?? '') || timestamps.at(-1) || 0,
    records, projections: { asOfSeq: records.length - 1, values },
  }
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
