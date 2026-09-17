import type { ToolDefinition, ToolExecution } from '../case1/tools.js'

export type PermissionDecision = 'allow' | 'deny' | 'ask'

export interface PermissionPolicy {
  evaluate(input: {
    toolName: string
    arguments: Readonly<Record<string, unknown>>
  }): PermissionDecision
}

export interface ApprovalPort {
  request(input: {
    toolName: string
    arguments: Readonly<Record<string, unknown>>
  }): Promise<'allow' | 'deny'>
}

export interface AskPort {
  ask(input: {
    question: string
    choices?: readonly string[]
  }): Promise<{ answer: string }>
}

function denied(toolName: string): ToolExecution {
  return {
    content: JSON.stringify({
      ok: false,
      error: 'permission_denied',
      tool: toolName,
      hint: 'The user denied this action. Do not claim it succeeded.',
    }),
  }
}

export function permissionTools(
  tools: readonly ToolDefinition[],
  policy?: PermissionPolicy,
  approval?: ApprovalPort,
): readonly ToolDefinition[] {
  if (policy === undefined) return tools
  return tools.map(tool => ({
    ...tool,
    async execute(arguments_) {
      const decision = policy.evaluate({ toolName: tool.name, arguments: arguments_ })
      if (decision === 'deny') return denied(tool.name)
      if (decision === 'ask') {
        if (approval === undefined) throw new Error('permission policy requested approval without an ApprovalPort')
        if (await approval.request({ toolName: tool.name, arguments: arguments_ }) === 'deny') {
          return denied(tool.name)
        }
      }
      return tool.execute(arguments_)
    },
  }))
}

export function askTool(port: AskPort): ToolDefinition {
  return {
    name: 'ask',
    schema: {
      type: 'function',
      function: {
        name: 'ask',
        description: 'Ask the user one question and wait for the answer.',
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            choices: { type: 'array', items: { type: 'string' } },
          },
          required: ['question'],
          additionalProperties: false,
        },
      },
    },
    async execute(arguments_) {
      const question = arguments_['question']
      const choices = arguments_['choices']
      if (typeof question !== 'string') throw new TypeError('question must be a string')
      if (choices !== undefined && (!Array.isArray(choices) || !choices.every(item => typeof item === 'string'))) {
        throw new TypeError('choices must be an array of strings')
      }
      const response = await port.ask({
        question,
        ...(choices === undefined ? {} : { choices: choices as string[] }),
      })
      return { content: JSON.stringify({ ok: true, answer: response.answer }) }
    },
  }
}
