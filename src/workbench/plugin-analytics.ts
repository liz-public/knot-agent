import type { Event } from '../journal.js'
import type { PluginMetadata } from '../assembly-definition.js'
import type { AssemblyDescription } from './assembly.js'

export interface PluginAnalyticsDto {
  readonly eventCount: number
  readonly assembly?: { readonly id: string; readonly title: string }
  readonly plugins: readonly (PluginMetadata & {
    readonly matchedEvents: number
    readonly subscriptions: readonly { readonly type: string; readonly count: number }[]
  })[]
  readonly protocols: readonly {
    readonly type: string; readonly events: number; readonly subscribers: readonly string[]
  }[]
}

/** Current declaration × recorded facts: eligibility, never handler executions or output attribution. */
export function projectPluginAnalytics(events: readonly Event[], assembly?: AssemblyDescription): PluginAnalyticsDto {
  const counts = new Map<string, number>()
  for (const event of events) counts.set(event.type, (counts.get(event.type) ?? 0) + 1)
  const plugins = (assembly?.plugins ?? []).map(plugin => {
    const listens = [...new Set(plugin.listens)]
    return { ...plugin, subscriptions: listens.map(type => ({ type, count: type === '*' ? events.length : counts.get(type) ?? 0 })),
      matchedEvents: listens.includes('*') ? events.length : listens.reduce((sum, type) => sum + (counts.get(type) ?? 0), 0) }
  })
  const types = [...new Set([...(assembly?.protocols ?? []), ...counts.keys()])]
  return { eventCount: events.length,
    ...(assembly ? { assembly: { id: assembly.id, title: assembly.title } } : {}), plugins,
    protocols: types.map(type => ({ type, events: counts.get(type) ?? 0,
      subscribers: plugins.filter(plugin => plugin.listens.includes(type) || plugin.listens.includes('*')).map(plugin => plugin.id) })) }
}
