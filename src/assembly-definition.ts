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

export interface PluginToolDescription {
  readonly name: string
  readonly description: string
}

/** Read-only facets derived from the same declaration that creates the plugin. */
export interface PluginInspection {
  readonly systemPrompts?: readonly string[]
  readonly tools?: readonly PluginToolDescription[]
}

/** Internal declaration helper. The Journal still installs only `Plugin`. */
export interface PluginDefinition<Context> {
  readonly metadata: PluginMetadata
  readonly create: (context: Context) => Plugin
  readonly inspect?: () => PluginInspection
}

export function definePlugin<Context>(definition: PluginDefinition<Context>): PluginDefinition<Context> {
  return definition
}

export function pluginTools(
  definitions: readonly { readonly schema: Readonly<Record<string, unknown>> }[],
): readonly PluginToolDescription[] {
  return definitions.map(definition => {
    const fn = definition.schema['function'] as Record<string, unknown>
    return {
      name: String(fn['name']),
      description: typeof fn['description'] === 'string' ? fn['description'] : '',
    }
  })
}

/** Internal assembly value. It does not replace the minimal Plugin contract. */
export interface PluginNode {
  readonly plugin: Plugin
  readonly metadata: PluginMetadata
}
