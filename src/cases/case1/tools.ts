import type { Plugin } from '../../journal.js'
import {
  SESSION_START,
  TOOL_CALL,
  TOOL_REGISTRY,
  TOOL_RESULT,
  type ToolCall,
} from './protocol.js'

export interface ToolExecution {
  readonly content: string
  readonly state?: { key: string; value: unknown | null }
}

export interface ToolDefinition {
  readonly name: string
  readonly schema: Record<string, unknown>
  execute(arguments_: Record<string, unknown>): Promise<ToolExecution> | ToolExecution
}

export const toolsPlugin = (tools: readonly ToolDefinition[]): Plugin => {
  const byName = new Map(tools.map(tool => [tool.name, tool]))
  if (byName.size !== tools.length) throw new Error('duplicate tool name')

  return journal => {
    // Announcing the schemas on the journal keeps the tool list out of every
    // model input and lets any plugin discover what this agent can do.
    journal.subscribe(SESSION_START, () => {
      journal.append(TOOL_REGISTRY, { schemas: tools.map(tool => tool.schema) })
    })

    journal.subscribe(TOOL_CALL, async event => {
      const call = event.data as ToolCall
      const tool = byName.get(call.name)
      if (tool === undefined) throw new Error(`unknown tool: ${call.name}`)
      const result = await tool.execute(call.arguments)
      journal.append(TOOL_RESULT, {
        turnId: call.turnId,
        callId: call.callId,
        name: call.name,
        content: result.content,
        ...(result.state === undefined ? {} : { state: result.state }),
      })
    })
  }
}

export function mockAndroidBashTool(): ToolDefinition {
  let pendingContact: string | undefined

  return {
    name: 'bash',
    schema: {
      type: 'function',
      function: {
        name: 'bash',
        description: 'Execute one supported Android-agent CLI command.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'One CLI command to execute.' },
          },
          required: ['command'],
          additionalProperties: false,
        },
      },
    },
    execute(arguments_) {
      const command = arguments_['command']
      if (typeof command !== 'string') throw new TypeError('bash.command must be a string')

      const contact = command.match(/^contact call\s+(.+)$/)
      if (contact !== null) {
        const name = contact[1]!.trim().replace(/^['"]|['"]$/g, '')
        pendingContact = name
        const value = {
          source: 'contact',
          candidates: [{ ordinal_1based: 1, display_name: name }],
        }
        return {
          content: JSON.stringify({
            action: 'candidates',
            candidates: value.candidates,
            hint: '当前只有一个联系人候选，请调用 bash 工具执行 select 1。',
          }),
          state: { key: 'pending.selection', value },
        }
      }

      const selection = command.match(/^select\s+(\d+)$/)
      if (selection !== null) {
        if (pendingContact === undefined) {
          return {
            content: JSON.stringify({
              error: 'no_active_list',
              hint: '当前没有有效候选列表，请重新查询联系人。',
            }),
          }
        }
        if (selection[1] !== '1') {
          return {
            content: JSON.stringify({
              error: 'invalid_selection',
              hint: '候选序号无效，请重新选择。',
            }),
          }
        }
        const name = pendingContact
        pendingContact = undefined
        return {
          content: JSON.stringify({
            action: 'direct_dial',
            selected: 1,
            display_name: name,
            hint: `拨号已成功，请直接告诉用户已为其拨通${name}的电话。`,
          }),
          state: { key: 'pending.selection', value: null },
        }
      }

      throw new Error(`unsupported mock Android command: ${command}`)
    },
  }
}
