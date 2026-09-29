import type { Plugin } from '../../journal.js'
import {
  SESSION_START,
  TOOL_CALL,
  TOOL_REGISTRY,
  TOOL_RESULT,
  USER_MESSAGE,
  type ToolCall,
} from '../protocol.js'

export interface ToolExecution {
  readonly content: string
  readonly state?: { key: string; value: unknown | null }
}

export interface ToolDefinition {
  readonly name: string
  readonly schema: Record<string, unknown>
  execute(
    arguments_: Record<string, unknown>,
    context: { readonly turnId: string; readonly callId: string },
  ): Promise<ToolExecution> | ToolExecution
}

function failedExecution(error: string, message: string): ToolExecution {
  return {
    content: JSON.stringify({
      ok: false,
      error,
      message,
      hint: '工具未完成请求。请根据错误修正调用，或向用户说明无法完成。',
    }),
  }
}

export const toolsPlugin = (tools: readonly ToolDefinition[]): Plugin => {
  const byName = new Map(tools.map(tool => [tool.name, tool]))
  if (byName.size !== tools.length) throw new Error('duplicate tool name')

  return journal => {
    const schemas = tools.map(tool => tool.schema)
    const register = () => journal.append(TOOL_REGISTRY, { schemas })

    // Announcing the schemas on the journal keeps the tool list out of every
    // model input and lets any plugin discover what this agent can do.
    journal.subscribe(SESSION_START, () => {
      register()
    })

    journal.subscribe(USER_MESSAGE, () => {
      const previous = [...journal.read()].reverse().find(event => event.type === TOOL_REGISTRY)
      const registered = previous === undefined
        ? undefined
        : (previous.data as { schemas?: unknown }).schemas
      if (JSON.stringify(registered) !== JSON.stringify(schemas)) register()
    })

    // The batch arrives as one event, so this plugin owns the concurrency
    // decision: the model asked for these calls in parallel and gets them in
    // parallel. Promise.all keeps the results in the order of the calls.
    journal.subscribe(TOOL_CALL, async event => {
      const batch = event.data as ToolCall
      const results = await Promise.all(batch.calls.map(async call => {
        const tool = byName.get(call.name)
        let result: ToolExecution
        if (tool === undefined) {
          result = failedExecution('unknown_tool', `未知工具：${call.name}`)
        } else {
          try {
            result = await tool.execute(call.arguments, {
              turnId: batch.turnId,
              callId: call.callId,
            })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            result = failedExecution('tool_error', `工具 ${call.name} 执行失败：${message}`)
          }
        }
        return {
          callId: call.callId,
          name: call.name,
          content: result.content,
          ...(result.state === undefined ? {} : { state: result.state }),
        }
      }))
      journal.append(TOOL_RESULT, { turnId: batch.turnId, results })
    })
  }
}
