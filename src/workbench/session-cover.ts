import type { SessionSnapshotDto } from './session.js'
import { projectSessionConfiguration } from '../agent/session-configuration.js'
import { projectSessionFacts } from './session-facts.js'
import { projectToolAnalytics } from './tool-analytics.js'

/** A directory over existing facts, not a generated summary or another persisted Session. */
export function projectSessionCover(snapshot: SessionSnapshotDto) {
  const queries: { position: number; turnId?: string; content: string; observedAt?: string }[] = []
  let latestReply: typeof queries[number] | undefined
  let firstObservedAt: string | undefined, lastObservedAt: string | undefined
  for (const event of snapshot.events) {
    if (event.observedAt && Number.isFinite(Date.parse(event.observedAt))) {
      firstObservedAt ??= event.observedAt; lastObservedAt = event.observedAt
    }
    if (event.type !== 'user.message' && event.type !== 'assistant.message') continue
    const data = event.data as { content?: unknown; turnId?: string }
    if (typeof data?.content !== 'string') continue
    const row = { position: event.position, content: data.content,
      ...(typeof data.turnId === 'string' ? { turnId: data.turnId } : {}),
      ...(event.observedAt && Number.isFinite(Date.parse(event.observedAt)) ? { observedAt: event.observedAt } : {}) }
    if (event.type === 'user.message') queries.push(row)
    else latestReply = row
  }
  const tools = projectToolAnalytics(snapshot.events)
  return { session: snapshot.session, eventCount: snapshot.events.length,
    recordedConfiguration: projectSessionConfiguration(snapshot.events),
    firstObservedAt, lastObservedAt, queries, latestReply,
    ...projectSessionFacts(snapshot.events),
    toolCalls: tools.totalCalls, unfinishedToolCalls: tools.tools.reduce((n, tool) => n + tool.unfinished, 0),
  }
}
export type SessionCoverDto = ReturnType<typeof projectSessionCover>
