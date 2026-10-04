import type { SessionSnapshotDto } from './session.js'
import { projectSessionConfiguration } from '../agent/session-configuration.js'
import { projectSessionFacts } from './session-facts.js'
import { projectToolAnalytics } from './tool-analytics.js'
import type { InferenceConfigured } from '../agent/protocol.js'

/** A directory over existing facts, not a generated summary or another persisted Session. */
export function projectSessionCover(snapshot: SessionSnapshotDto) {
  const queries: { position: number; turnId?: string; content: string; observedAt?: string }[] = []
  let latestReply: typeof queries[number] | undefined
  let firstObservedAt: string | undefined, lastObservedAt: string | undefined
  let inference: InferenceConfigured | undefined, runStart: number | undefined, runEnd: number | undefined
  let runDurationMs = 0, timedRuns = 0, runDurationPartial = false
  let compactionCount = 0
  const invokes = new Map<string, { inference?: InferenceConfigured; startedAt?: number }>()
  const models = new Map<string, { model?: string; provider?: string; reasoningEffort?: string;
    calls: number; outputKnownCalls: number; outputTokens: number; timedCalls: number; timedOutputTokens: number; durationMs: number }>()
  for (const event of snapshot.events) {
    const data = event.data as any
    if (event.type === 'history.checkpoint') compactionCount++
    const timestamp = Date.parse(event.observedAt ?? '')
    if (event.observedAt && Number.isFinite(timestamp)) {
      firstObservedAt ??= event.observedAt; lastObservedAt = event.observedAt
      if (runStart !== undefined) runEnd = timestamp
    }
    if (event.type === 'inference.configured') inference = data as InferenceConfigured
    if (event.type === 'llm.invoke') invokes.set(data.requestId, { inference,
      ...(Number.isFinite(timestamp) ? { startedAt: timestamp } : {}) })
    if (event.type === 'llm.generated') {
      const invoke = invokes.get(data.requestId), config = invoke?.inference
      // Historical calls without a recorded configuration stay unknown, never use today's default.
      const key = JSON.stringify([config?.provider, config?.model, config?.reasoningEffort])
      let row = models.get(key)
      if (!row) { row = { model: config?.model, provider: config?.provider, reasoningEffort: config?.reasoningEffort,
        calls: 0, outputKnownCalls: 0, outputTokens: 0, timedCalls: 0, timedOutputTokens: 0, durationMs: 0 }; models.set(key, row) }
      row.calls++
      const output = data.usage?.outputTokens
      if (typeof output === 'number' && Number.isFinite(output) && output >= 0) {
        row.outputKnownCalls++; row.outputTokens += output
        const duration = data.timing?.durationMs ?? (timestamp - (invoke?.startedAt ?? NaN))
        if (Number.isFinite(duration) && duration > 0) {
          row.timedCalls++; row.timedOutputTokens += output; row.durationMs += duration
        }
      }
    }
    if (event.type !== 'user.message' && event.type !== 'assistant.message') continue
    if (typeof data?.content !== 'string') continue
    const row = { position: event.position, content: data.content,
      ...(typeof data.turnId === 'string' ? { turnId: data.turnId } : {}),
      ...(event.observedAt && Number.isFinite(Date.parse(event.observedAt)) ? { observedAt: event.observedAt } : {}) }
    if (event.type === 'user.message') {
      queries.push(row)
      if (runStart === undefined && Number.isFinite(timestamp)) runStart = runEnd = timestamp
      else if (runStart === undefined) runDurationPartial = true
    } else {
      latestReply = row
      if (runStart !== undefined && Number.isFinite(timestamp)) {
        runDurationMs += Math.max(0, timestamp - runStart); timedRuns++
      } else if (runStart !== undefined) runDurationPartial = true
      runStart = runEnd = undefined
    }
  }
  if (runStart !== undefined && runEnd !== undefined) runDurationMs += Math.max(0, runEnd - runStart)
  const outputTokens = [...models.values()].reduce((sum, row) => sum + row.outputTokens, 0)
  const tools = projectToolAnalytics(snapshot.events)
  return { session: snapshot.session, eventCount: snapshot.events.length,
    recordedConfiguration: projectSessionConfiguration(snapshot.events),
    firstObservedAt, lastObservedAt, queries, latestReply, compactionCount,
    ...projectSessionFacts(snapshot.events),
    runDurationMs: timedRuns || runStart !== undefined ? runDurationMs : undefined,
    runDurationPartial: runDurationPartial || runStart !== undefined,
    modelUsage: [...models.values()].sort((a, b) => b.outputTokens - a.outputTokens).map(row => ({ ...row,
      outputShare: row.outputKnownCalls && outputTokens > 0 ? row.outputTokens / outputTokens : undefined,
      outputRate: row.durationMs > 0 ? row.timedOutputTokens / (row.durationMs / 1000) : undefined,
    })),
    toolCalls: tools.totalCalls, unfinishedToolCalls: tools.tools.reduce((n, tool) => n + tool.unfinished, 0),
  }
}
export type SessionCoverDto = ReturnType<typeof projectSessionCover>
