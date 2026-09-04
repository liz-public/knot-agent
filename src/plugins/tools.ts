import type { Plugin } from '../journal.js'
import { TOOL_CALL, TOOL_RESULT, type ToolCall } from '../protocol.js'

export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  execute(arguments_: Record<string, unknown>): Promise<unknown> | unknown
}

export const toolSchemas = (
  tools: readonly ToolDefinition[],
): Record<string, unknown>[] =>
  tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))

export const toolsPlugin = (tools: readonly ToolDefinition[]): Plugin => {
  const byName = new Map(tools.map(tool => [tool.name, tool]))
  if (byName.size !== tools.length) throw new Error('duplicate tool name')

  return journal =>
    journal.subscribe(TOOL_CALL, async event => {
      const call = event.data as ToolCall
      const tool = byName.get(call.name)
      if (tool === undefined) throw new Error(`unknown tool: ${call.name}`)
      journal.append(TOOL_RESULT, {
        callId: call.callId,
        name: call.name,
        output: await tool.execute(call.arguments),
      })
    })
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
