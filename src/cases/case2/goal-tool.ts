import type { ToolDefinition } from '../case1/tools.js'

export type GoalStatus = 'active' | 'completed'

export interface GoalState {
  readonly objective: string
  readonly successCriteria: readonly string[]
  readonly status: GoalStatus
}

function parseGoal(arguments_: Record<string, unknown>): GoalState {
  const objective = arguments_['objective']
  const successCriteria = arguments_['successCriteria']
  const status = arguments_['status']
  if (typeof objective !== 'string') throw new TypeError('objective must be a string')
  if (!Array.isArray(successCriteria) || !successCriteria.every(item => typeof item === 'string')) {
    throw new TypeError('successCriteria must be an array of strings')
  }
  if (status !== 'active' && status !== 'completed') {
    throw new TypeError('status must be active or completed')
  }
  return { objective, successCriteria, status }
}

export function goalTool(): ToolDefinition {
  return {
    name: 'goal.write',
    schema: {
      type: 'function',
      function: {
        name: 'goal.write',
        description: 'Replace the current explicit goal, its success criteria, and completion status.',
        parameters: {
          type: 'object',
          properties: {
            objective: { type: 'string' },
            successCriteria: { type: 'array', items: { type: 'string' } },
            status: { type: 'string', enum: ['active', 'completed'] },
          },
          required: ['objective', 'successCriteria', 'status'],
          additionalProperties: false,
        },
      },
    },
    execute(arguments_) {
      const goal = parseGoal(arguments_)
      return {
        content: JSON.stringify({ ok: true, goal }),
        state: { key: 'goal', value: goal },
      }
    },
  }
}
