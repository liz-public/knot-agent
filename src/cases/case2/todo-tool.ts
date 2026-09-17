import type { ToolDefinition } from '../case1/tools.js'

type TodoStatus = 'pending' | 'in_progress' | 'completed'

interface TodoItem {
  readonly id: string
  readonly content: string
  readonly status: TodoStatus
}

function parseTodos(value: unknown): readonly TodoItem[] {
  if (!Array.isArray(value)) throw new TypeError('todos must be an array')
  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null) throw new TypeError(`todos[${index}] must be an object`)
    const candidate = item as Record<string, unknown>
    if (typeof candidate['id'] !== 'string') throw new TypeError(`todos[${index}].id must be a string`)
    if (typeof candidate['content'] !== 'string') throw new TypeError(`todos[${index}].content must be a string`)
    if (!['pending', 'in_progress', 'completed'].includes(String(candidate['status']))) {
      throw new TypeError(`todos[${index}].status is invalid`)
    }
    return {
      id: candidate['id'],
      content: candidate['content'],
      status: candidate['status'] as TodoStatus,
    }
  })
}

export function todoTool(): ToolDefinition {
  return {
    name: 'todo.write',
    schema: {
      type: 'function',
      function: {
        name: 'todo.write',
        description: 'Replace the current task list with the complete updated list.',
        parameters: {
          type: 'object',
          properties: {
            todos: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  content: { type: 'string' },
                  status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
                },
                required: ['id', 'content', 'status'],
                additionalProperties: false,
              },
            },
          },
          required: ['todos'],
          additionalProperties: false,
        },
      },
    },
    execute(arguments_) {
      const todos = parseTodos(arguments_['todos'])
      return {
        content: JSON.stringify({ ok: true, todos }),
        state: { key: 'todo', value: todos },
      }
    },
  }
}
