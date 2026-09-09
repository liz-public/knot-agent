import type { Plugin } from '../../journal.js'
import { contentProviderPlugin } from './content.js'

type ShortcutOutput =
  | { kind: 'message'; content: string }
  | { kind: 'tool'; name: string; arguments: Record<string, unknown> }

export interface ShortcutRule {
  readonly priority: number
  match(query: string): ShortcutOutput | undefined
}

export const androidCallRule: ShortcutRule = {
  priority: 110,
  match(query) {
    const matched = query.match(
      /^给(.+?)(?:打|拨打|拨|回|通)(?:个|一个|一通|一下|一次)?电话[。！？!?]?$/,
    )
    const name = matched?.[1]?.trim()
    if (name === undefined || name.length === 0) return undefined
    return {
      kind: 'tool',
      name: 'bash',
      arguments: { command: `contact call ${name}` },
    }
  },
}

export const shortcutPlugin = (rules: readonly ShortcutRule[]): Plugin => {
  const ordered = [...rules].sort((a, b) => b.priority - a.priority)
  return contentProviderPlugin(request => {
    for (const rule of ordered) {
      const output = rule.match(request.query)
      if (output === undefined) continue
      if (output.kind === 'message') return output
      return {
        kind: 'tools',
        calls: [{
          callId: `shortcut-${request.turnId}`,
          name: output.name,
          arguments: output.arguments,
        }],
      }
    }
    return undefined
  })
}
