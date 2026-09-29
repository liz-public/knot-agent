import type { ToolExecution } from './tools.js'
import type { ApprovalPort } from './approval-port.js'

export interface DispatchRequest {
  readonly toolId: string
  readonly arguments: Record<string, unknown>
  readonly context: { readonly turnId: string; readonly callId: string }
}

export interface ToolDispatcher {
  dispatch(request: DispatchRequest): Promise<ToolExecution>
}

export interface ApprovalRequest {
  readonly toolName: string
  readonly arguments: Record<string, unknown>
}

export type ApprovalPolicy = (request: DispatchRequest) => ApprovalRequest | undefined

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

export function withApprovalPolicy(
  dispatcher: ToolDispatcher,
  approvalPort: ApprovalPort | undefined,
  policy: ApprovalPolicy,
  approvalMode: () => 'ask' | 'auto' = () => 'ask',
): ToolDispatcher {
  return {
    async dispatch(request) {
      const approvalRequest = policy(request)
      if (approvalRequest === undefined) return dispatcher.dispatch(request)
      if (approvalMode() === 'auto') return dispatcher.dispatch(request)
      if (approvalPort === undefined) {
        return {
          content: JSON.stringify({
            ok: false,
            error: 'approval_required',
            hint: '执行该操作前需要用户审批。',
          }),
        }
      }
      const approval = await approvalPort.request(approvalRequest)
      if (approval !== 'allow') {
        return { content: JSON.stringify({ ok: false, error: 'user_denied', hint: '' }) }
      }
      return dispatcher.dispatch(request)
    },
  }
}
