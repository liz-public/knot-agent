/** Read-only Knot facts; no DSH execution semantics or parallel persisted state. */
import type { SessionSnapshotDto } from '../../src/workbench/session.js'

export function projectBusinessState({ events }: SessionSnapshotDto) {
  let todo: unknown = null
  let goal: unknown = null
  let inputTokens = 0, outputTokens = 0, knownCalls = 0, calls = 0
  let cachedTokens = 0, cacheInputTokens = 0, cacheKnownCalls = 0
  let latest: { cacheHitRate?: number; outputRate?: number } = {}
  const starts = new Map<string, string | undefined>()
  for (const event of events) {
    const data = event.data as any
    if (!data || typeof data !== 'object') continue
    if (event.type === 'llm.invoke') starts.set(data.requestId, event.observedAt)
    if (event.type === 'tool.result') for (const result of data.results ?? []) {
      if (result.state?.key === 'todo') todo = result.state.value
      if (result.state?.key === 'goal') goal = result.state.value
    }
    if (event.type !== 'llm.generated') continue
    calls++
    const usage = data.usage
    if (typeof usage?.inputTokens === 'number' && typeof usage?.outputTokens === 'number') {
      inputTokens += usage.inputTokens; outputTokens += usage.outputTokens; knownCalls++
      if (typeof usage.cachedInputTokens === 'number') {
        cacheKnownCalls++; cachedTokens += usage.cachedInputTokens; cacheInputTokens += usage.inputTokens
      }
    }
    if (data.request?.purpose === 'agent') {
      const seconds = (Date.parse(event.observedAt ?? '') - Date.parse(starts.get(data.requestId) ?? '')) / 1000
      latest = {
        ...(usage?.inputTokens > 0 && typeof usage?.cachedInputTokens === 'number'
          ? { cacheHitRate: usage.cachedInputTokens / usage.inputTokens } : {}),
        ...(seconds > 0 && typeof usage?.outputTokens === 'number' ? { outputRate: usage.outputTokens / seconds } : {}),
      }
    }
  }
  return { knotTodo: todo, knotGoal: goal, knotUsage: {
    inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, knownCalls, calls, cacheKnownCalls, cachedInputTokens: cachedTokens,
    ...(cacheInputTokens > 0 ? { knownCacheHitRate: cachedTokens / cacheInputTokens } : {}), latest,
  } }
}
