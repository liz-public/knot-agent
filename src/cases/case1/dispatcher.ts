import type { ToolExecution } from './tools.js'

export interface DispatchRequest {
  readonly toolId: string
  readonly arguments: Record<string, unknown>
  readonly context: { readonly turnId: string; readonly callId: string }
}

export interface ToolDispatcher {
  dispatch(request: DispatchRequest): Promise<ToolExecution>
}

export type ToolHandler = (
  arguments_: Record<string, unknown>,
  context: DispatchRequest['context'],
) => Promise<ToolExecution> | ToolExecution

export function createToolDispatcher(handlers: Readonly<Record<string, ToolHandler>>): ToolDispatcher {
  return {
    async dispatch(request) {
      const handler = handlers[request.toolId]
      if (handler === undefined) {
        return {
          content: JSON.stringify({
            ok: false,
            error: 'unsupported_tool',
            toolId: request.toolId,
            hint: '当前执行环境暂不支持该能力，请如实告知用户。',
          }),
        }
      }
      return await handler(request.arguments, request.context)
    },
  }
}
