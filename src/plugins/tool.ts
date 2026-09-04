import type { Event, Plugin, PluginContext } from '../core.js'
import { events, type ToolCall } from '../protocol.js'

export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  execute(arguments_: Record<string, unknown>): Promise<unknown> | unknown
}

export class ToolPlugin implements Plugin {
  readonly name = 'tool'
  readonly subscriptions = [events.toolCall]
  readonly #tools: Map<string, ToolDefinition>

  constructor(tools: readonly ToolDefinition[]) {
    this.#tools = new Map(tools.map(tool => [tool.name, tool]))
    if (this.#tools.size !== tools.length) throw new Error('duplicate tool name')
  }

  get schemas(): readonly Record<string, unknown>[] {
    return [...this.#tools.values()].map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))
  }

  async handle(event: Event, context: PluginContext): Promise<void> {
    const call = event.data as ToolCall
    const tool = this.#tools.get(call.name)
    if (tool === undefined) throw new Error(`unknown tool: ${call.name}`)
    const output = await tool.execute(call.arguments)
    context.append(events.toolResult, {
      callId: call.callId,
      name: call.name,
      output,
    })
  }
}

export const demoLookupTool: ToolDefinition = {
  name: 'demo_lookup',
  description: 'Look up the deterministic status of a named project.',
  parameters: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
    additionalProperties: false,
  },
  execute(arguments_) {
    return {
      name: String(arguments_['name'] ?? 'unknown'),
      status: 'ready',
      detail: 'The journal-driven tool path completed successfully.',
    }
  },
}

