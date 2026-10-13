import type { ContentSource } from './content.js'

type ShortcutOutput =
  | { kind: 'message'; content: string }
  | { kind: 'tool'; name: string; arguments: Record<string, unknown> }

export interface ShortcutRule {
  readonly priority: number
  match(query: string): ShortcutOutput | undefined
}

/** An explicit user choice, not a model routing decision or an approval. */
export const androidSelectionRule: ShortcutRule = {
  priority: 100,
  match(query) {
    const match = /^(?:select\s+([1-9]\d*)|选择第([1-9]\d*)项)$/.exec(query.trim())
    if (!match) return undefined
    const ordinal = Number(match[1] ?? match[2])
    if (!Number.isSafeInteger(ordinal)) return undefined
    return { kind: 'tool', name: 'bash', arguments: { command: `select ${ordinal}` } }
  },
}

/** Exact user stop intent, including the native recording card button. Not approval. */
export const androidRecordingStopRule: ShortcutRule = {
  priority: 100,
  match(query) {
    const matched = /^停止录(音|屏)$/.exec(query.trim())
    return matched ? { kind: 'tool', name: 'bash', arguments: { command: `record ${matched[1] === '音' ? 'audio' : 'screen'} stop` } } : undefined
  },
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

export const androidFlashlightRule: ShortcutRule = {
  priority: 120,
  match(query) {
    const matched = query.match(
      /^(?:请|麻烦|帮我)?(?:把)?(?:打开|开启|开|关闭|关掉|关)(?:一下)?(?:手机的)?(?:手电筒|闪光灯)[。！？!?]?$/,
    )
    if (matched === null) return undefined
    return {
      kind: 'tool',
      name: 'bash',
      arguments: { command: `flash ${/(?:关闭|关掉|关)/.test(query) ? 'off' : 'on'}` },
    }
  },
}

export const shortcutSource = (rules: readonly ShortcutRule[]): ContentSource => {
  const ordered = [...rules].sort((a, b) => b.priority - a.priority)
  return request => {
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
  }
}
