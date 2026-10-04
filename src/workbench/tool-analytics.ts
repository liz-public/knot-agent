import type { ReadEvent } from './read-journal.js'

export interface ToolAnalyticsDto {
  readonly eventCount: number
  readonly totalCalls: number
  readonly registeredTools: number
  readonly usedRegisteredTools: number
  readonly tools: readonly {
    readonly name: string
    readonly description?: string
    readonly registered: boolean
    readonly available: boolean
    readonly callShare?: number
    readonly successRate?: number
    readonly calls: number
    readonly returned: number
    readonly failed: number
    readonly succeeded: number
    readonly unknown: number
    readonly unfinished: number
    readonly timedBatches: number
    readonly totalBatchWaitMs: number
  }[]
  readonly limitations: readonly string[]
}

/** Counts facts, not handler executions or tool side effects. Batch time is not individual latency. */
export function projectToolAnalytics(events: readonly ReadEvent[]): ToolAnalyticsDto {
  const tools = new Map<string, ToolAnalyticsDto['tools'][number]>()
  let available = new Set<string>()
  const empty = (name: string) => ({ name, registered: false, available: false, calls: 0,
    returned: 0, failed: 0, succeeded: 0, unknown: 0, unfinished: 0, timedBatches: 0, totalBatchWaitMs: 0 })
  const calls = new Map<string, { name: string; at?: string; returned: boolean }>()
  for (const event of events) {
    const data = event.data as any
    if (event.type === 'tool.registry') {
      available = new Set<string>()
      for (const schema of data?.schemas ?? []) {
        const fn = schema.function
        if (typeof fn?.name !== 'string') continue
        available.add(fn.name)
        tools.set(fn.name, { ...(tools.get(fn.name) ?? empty(fn.name)), registered: true,
          ...(typeof fn.description === 'string' ? { description: fn.description } : {}) })
      }
    }
    if (event.type === 'tool.call') for (const call of data?.calls ?? []) {
      calls.set(call.callId, { name: call.name, at: event.observedAt, returned: false })
      const row = tools.get(call.name) ?? empty(call.name)
      tools.set(call.name, { ...row, calls: row.calls + 1, unfinished: row.unfinished + 1 })
    }
    if (event.type !== 'tool.result') continue
    const timed = new Set<string>()
    for (const result of data?.results ?? []) {
      const call = calls.get(result.callId)
      if (!call || call.returned) continue
      call.returned = true
      let outcome: any
      try { outcome = JSON.parse(result.content) } catch { /* Not every tool has a structured status. */ }
      const failed = outcome?.ok === false || (typeof outcome?.exitCode === 'number' && outcome.exitCode !== 0)
      const succeeded = !failed && (outcome?.ok === true || outcome?.exitCode === 0)
      const wait = Date.parse(event.observedAt ?? '') - Date.parse(call.at ?? '')
      const row = tools.get(call.name)!
      const knownWait = Number.isFinite(wait) && wait >= 0 && !timed.has(call.name)
      if (knownWait) timed.add(call.name)
      tools.set(call.name, { ...row, returned: row.returned + 1, unfinished: row.unfinished - 1,
        failed: row.failed + Number(failed), succeeded: row.succeeded + Number(succeeded),
        unknown: row.unknown + Number(!failed && !succeeded),
        timedBatches: row.timedBatches + Number(knownWait), totalBatchWaitMs: row.totalBatchWaitMs + (knownWait ? wait : 0) })
    }
  }
  const rows = [...tools.values()]
  const totalCalls = rows.reduce((sum, row) => sum + row.calls, 0)
  return { eventCount: events.length, totalCalls,
    registeredTools: rows.filter(row => row.registered).length,
    usedRegisteredTools: rows.filter(row => row.registered && row.calls > 0).length,
    tools: rows.map(row => ({ ...row, available: available.has(row.name),
      ...(totalCalls ? { callShare: row.calls / totalCalls } : {}),
      ...(row.succeeded + row.failed ? { successRate: row.succeeded / (row.succeeded + row.failed) } : {}),
    })), limitations: [
    'Tool roster and descriptions come from this Session’s registry history, including zero-call and removed tools; unregistered calls remain visible.',
    'Call share uses all calls; success rate uses only explicitly successful/failed returns. Unknown and unfinished results are separate, never failures.',
    'Counts describe recorded calls and results, not whether an external side effect succeeded.',
    'call→result time includes the whole parallel batch and approval waiting, not individual tool execution time.',
    'No result means unfinished in this snapshot, not failed. Unstructured results have unknown status.',
    'Journal facts cannot prove which subscribed handler ran or attribute its duration.',
  ] }
}
