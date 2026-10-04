import type { ReadEvent } from './read-journal.js'

/** Shared read-only facts for the native dock and Session cover; no DSH types. */
export function projectSessionFacts(events: readonly ReadEvent[]) {
  let todos: { id: string; content: string; status: string }[] | null = null
  let goal: { objective: string; successCriteria: string[]; status: string } | null = null
  let inputTokens = 0, outputTokens = 0, knownCalls = 0, calls = 0
  let cachedTokens = 0, cacheInputTokens = 0, cacheKnownCalls = 0
  let latest: { cacheHitRate?: number; outputRate?: number } = {}
  const starts = new Map<string, string | undefined>()
  for (const event of events) {
    const data = event.data as any
    if (!data || typeof data !== 'object') continue
    if (event.type === 'llm.invoke') starts.set(data.requestId, event.observedAt)
    if (event.type === 'tool.result') for (const result of data.results ?? []) {
      if (result.state?.key === 'todo') todos = result.state.value
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
  return { todos, goal, usage: {
    inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, knownCalls, calls, cacheKnownCalls, cachedInputTokens: cachedTokens,
    ...(cacheInputTokens > 0 ? { knownCacheHitRate: cachedTokens / cacheInputTokens } : {}), latest,
  } }
}
