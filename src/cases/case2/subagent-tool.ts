import type { ToolDefinition } from '../case1/tools.js'

export interface SubagentFactory {
  run(input: { task: string; cwd: string }): Promise<{ summary: string }>
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
          properties: { task: { type: 'string' } },
          required: ['task'],
          additionalProperties: false,
        },
      },
    },
    async execute(arguments_) {
      const task = arguments_['task']
      if (typeof task !== 'string') throw new TypeError('task must be a string')
      const result = await factory.run({ task, cwd })
      return { content: JSON.stringify({ ok: true, summary: result.summary }) }
    },
  }
}
