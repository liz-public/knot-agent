import type { ReadEvent } from '../api/workbench-api'

export interface UsageSummary { readonly input: number; readonly output: number; readonly total: number; readonly window: number; readonly outputRate?: number }
export interface TodoItem { readonly id: string; readonly content: string; readonly status: string }
export interface GoalState { readonly objective: string; readonly status: string; readonly successCriteria: readonly string[] }

export function formatElapsed(value?: number): string {
  if (value === undefined) return '—'
  return value < 1_000 ? `+${value}ms` : `+${(value / 1_000).toFixed(2)}s`
}

export function eventTone(type: string): 'neutral' | 'model' | 'tool' | 'success' {
  if (type.startsWith('llm.') || type === 'assistant.reasoning') return 'model'
  if (type.startsWith('tool.')) return 'tool'
  if (type === 'assistant.message') return 'success'
  return 'neutral'
}

export function ownerFor(type: string): string {
  if (type === 'user.message') return 'Input'
  if (type === 'context.dynamic') return 'WorkspaceContext'
  if (type === 'content.request') return 'CodingFlow'
  if (type === 'llm.request') return 'ContentSources'
  if (type === 'llm.invoke') return 'ContextAssembler'
  if (type.startsWith('llm.') || type === 'assistant.reasoning') return 'LLMProvider'
  if (type.startsWith('tool.')) return 'Tools'
  if (type === 'assistant.message') return 'Output'
  if (type === 'system.prompt') return 'SystemPrompt'
  return 'Runtime'
}

export function eventPreview(event: ReadEvent): string {
  const data = typeof event.data === 'object' && event.data !== null ? event.data as Record<string, unknown> : {}
  if (typeof data['content'] === 'string') return data['content']
  if (typeof data['query'] === 'string') return data['query']
  if (typeof data['purpose'] === 'string') return data['purpose']
  if (Array.isArray(data['calls'])) return data['calls'].map(item => String((item as Record<string, unknown>)['name'] ?? 'tool')).join(', ')
  if (Array.isArray(data['results'])) return data['results'].map(item => String((item as Record<string, unknown>)['name'] ?? 'result')).join(', ')
  if (data['usage'] !== undefined) return 'generation complete · usage recorded'
  return Object.keys(data).slice(0, 4).join(' · ') || 'empty payload'
}

export function usageFrom(events: readonly ReadEvent[]): UsageSummary | undefined {
  const generated = [...events].reverse().find(event => event.type === 'llm.generated')
  if (generated === undefined || typeof generated.data !== 'object' || generated.data === null) return undefined
  const usage = (generated.data as Record<string, unknown>)['usage']
  if (typeof usage !== 'object' || usage === null) return undefined
  const value = usage as Record<string, unknown>
  const input = Number(value['inputTokens']); const output = Number(value['outputTokens']); const total = Number(value['totalTokens']); const window = Number(value['contextWindow'])
  if (![input, output, total, window].every(Number.isFinite)) return undefined
  const requestId = (generated.data as Record<string, unknown>)['requestId']
  const invoke = typeof requestId === 'string' ? [...events].reverse().find(event => event.type === 'llm.invoke' && typeof event.data === 'object' && event.data !== null && (event.data as Record<string, unknown>)['requestId'] === requestId) : undefined
  const startedAt = invoke?.observedAt === undefined ? Number.NaN : Date.parse(invoke.observedAt)
  const completedAt = generated.observedAt === undefined ? Number.NaN : Date.parse(generated.observedAt)
  const durationSeconds = (completedAt - startedAt) / 1_000
  const outputRate = Number.isFinite(durationSeconds) && durationSeconds > 0 ? output / durationSeconds : undefined
  return { input, output, total, window, ...(outputRate === undefined ? {} : { outputRate }) }
}

export function todosFrom(events: readonly ReadEvent[]): readonly TodoItem[] {
  for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex -= 1) {
    const event = events[eventIndex]
    if (event?.type !== 'tool.result' || typeof event.data !== 'object' || event.data === null) continue
    const results = (event.data as Record<string, unknown>)['results']
    if (!Array.isArray(results)) continue
    for (let resultIndex = results.length - 1; resultIndex >= 0; resultIndex -= 1) {
      const result = results[resultIndex]
      if (typeof result !== 'object' || result === null) continue
      const state = (result as Record<string, unknown>)['state']
      if (typeof state !== 'object' || state === null) continue
      const record = state as Record<string, unknown>
      if (record['key'] !== 'todo' || !Array.isArray(record['value'])) continue
      return record['value'].flatMap((item, index) => {
        if (typeof item !== 'object' || item === null) return []
        const candidate = item as Record<string, unknown>
        if (typeof candidate['content'] !== 'string' || typeof candidate['status'] !== 'string') return []
        return [{ id: typeof candidate['id'] === 'string' ? candidate['id'] : String(index + 1), content: candidate['content'], status: candidate['status'] }]
      })
    }
  }
  return []
}

export function goalFrom(events: readonly ReadEvent[]): GoalState | undefined {
  for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex -= 1) {
    const event = events[eventIndex]
    if (event?.type !== 'tool.result' || typeof event.data !== 'object' || event.data === null) continue
    const results = (event.data as Record<string, unknown>)['results']
    if (!Array.isArray(results)) continue
    for (let resultIndex = results.length - 1; resultIndex >= 0; resultIndex -= 1) {
      const result = results[resultIndex]
      if (typeof result !== 'object' || result === null) continue
      const state = (result as Record<string, unknown>)['state']
      if (typeof state !== 'object' || state === null) continue
      const record = state as Record<string, unknown>
      if (record['key'] !== 'goal' || typeof record['value'] !== 'object' || record['value'] === null) continue
      const value = record['value'] as Record<string, unknown>
      if (typeof value['objective'] !== 'string' || typeof value['status'] !== 'string') continue
      return { objective: value['objective'], status: value['status'], successCriteria: Array.isArray(value['successCriteria']) ? value['successCriteria'].filter((item): item is string => typeof item === 'string') : [] }
    }
  }
  return undefined
}

export function workspaceFrom(events: readonly ReadEvent[], fallback: string): string {
  const context = [...events].reverse().find(event => event.type === 'context.dynamic')
  if (context === undefined || typeof context.data !== 'object' || context.data === null) return fallback
  const content = (context.data as Record<string, unknown>)['content']
  return typeof content === 'string' ? content.match(/Current workspace:\s*(.+)/)?.[1] ?? fallback : fallback
}
