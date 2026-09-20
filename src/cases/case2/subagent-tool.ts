import type { ToolDefinition } from '../case1/tools.js'

export interface SubagentFactory {
  run(input: {
    task: string
    cwd: string
    model?: string
    reasoningEffort?: 'none' | 'low' | 'high' | 'max'
  }): Promise<{ summary: string; sessionId?: string }>
}

export function spawnAgentTool(cwd: string, factory: SubagentFactory): ToolDefinition {
  return {
    name: 'spawn_agent',
    schema: {
      type: 'function',
      function: {
        name: 'spawn_agent',
        description: 'Run one focused task in an independent child agent and wait for its summary.',
        parameters: {
          type: 'object',
          properties: {
            task: { type: 'string' },
            model: {
              type: 'string',
              description: 'Optional configured model name or provider profile id. Omit to inherit the parent model.',
            },
            reasoningEffort: {
              type: 'string',
              enum: ['none', 'low', 'high', 'max'],
              description: 'Optional reasoning effort. Omit to inherit the parent session.',
            },
          },
          required: ['task'],
          additionalProperties: false,
        },
      },
    },
    async execute(arguments_) {
      const task = arguments_['task']
      const model = arguments_['model']
      const reasoningEffort = arguments_['reasoningEffort']
      if (typeof task !== 'string') throw new TypeError('task must be a string')
      if (model !== undefined && typeof model !== 'string') throw new TypeError('model must be a string')
      if (reasoningEffort !== undefined && !['none', 'low', 'high', 'max'].includes(String(reasoningEffort))) {
        throw new TypeError('reasoningEffort must be none, low, high, or max')
      }
      const result = await factory.run({
        task,
        cwd,
        ...(model === undefined ? {} : { model }),
        ...(reasoningEffort === undefined
          ? {}
          : { reasoningEffort: reasoningEffort as 'none' | 'low' | 'high' | 'max' }),
      })
      return { content: JSON.stringify({ ok: true, summary: result.summary, ...(result.sessionId === undefined ? {} : { sessionId: result.sessionId }) }) }
    },
  }
}
