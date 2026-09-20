import type { Plugin } from './journal.js'

export type PluginCategory = 'platform' | 'context' | 'flow' | 'content' | 'effect' | 'presentation'

export interface PluginMetadata {
  readonly id: string
  readonly name: string
  readonly category: PluginCategory
  readonly responsibility: string
  readonly listens: readonly string[]
  readonly emits: readonly string[]
  readonly source: string
}

/** Internal assembly value. It does not replace the minimal Plugin contract. */
export interface PluginNode {
  readonly plugin: Plugin
  readonly metadata: PluginMetadata
}
