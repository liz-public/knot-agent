import type { ApprovalPort } from './approval-port.js'
import {
  withApprovalPolicy,
  type ApprovalPolicy,
  type ToolDispatcher,
} from './dispatcher.js'

const policy: ApprovalPolicy = request => {
  if (request.toolId === 'contact_delete') {
    return { toolName: 'contact.delete', arguments: request.arguments }
  }
  if (request.toolId === 'contact' && request.arguments['sub'] === 'call') {
    return { toolName: 'contact.call', arguments: request.arguments }
  }
  return undefined
}

export function applyCase1ApprovalPolicy(
  dispatcher: ToolDispatcher,
  approvalPort?: ApprovalPort,
  approvalMode?: () => 'ask' | 'auto',
): ToolDispatcher {
  return withApprovalPolicy(dispatcher, approvalPort, policy, approvalMode)
}
