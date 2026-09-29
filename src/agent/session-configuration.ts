import type { Event, Journal } from '../journal.js'
import {
  APPROVAL_POLICY_CONFIGURED,
  INFERENCE_CONFIGURED,
  type ApprovalMode,
  type ApprovalPolicyConfigured,
  type InferenceConfigured,
} from './protocol.js'

export interface SessionConfiguration {
  readonly inference?: InferenceConfigured
  readonly approvalMode?: ApprovalMode
}

function sameInference(
  left: InferenceConfigured | undefined,
  right: InferenceConfigured,
): boolean {
  return left?.providerProfileId === right.providerProfileId
    && left.provider === right.provider
    && left.model === right.model
    && left.reasoningEffort === right.reasoningEffort
}

export function projectSessionConfiguration(events: readonly Event[]): SessionConfiguration {
  let inference: InferenceConfigured | undefined
  let approvalMode: ApprovalMode | undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (inference === undefined && event.type === INFERENCE_CONFIGURED) {
      inference = event.data as InferenceConfigured
    }
    if (approvalMode === undefined && event.type === APPROVAL_POLICY_CONFIGURED) {
      approvalMode = (event.data as ApprovalPolicyConfigured).mode
    }
    if (inference !== undefined && approvalMode !== undefined) break
  }
  return {
    ...(inference === undefined ? {} : { inference }),
    ...(approvalMode === undefined ? {} : { approvalMode }),
  }
}

export function appendSessionConfiguration(
  journal: Journal,
  next: SessionConfiguration,
): boolean {
  const current = projectSessionConfiguration(journal.read())
  let changed = false
  if (next.inference !== undefined && !sameInference(current.inference, next.inference)) {
    journal.append(INFERENCE_CONFIGURED, next.inference)
    changed = true
  }
  if (next.approvalMode !== undefined && next.approvalMode !== current.approvalMode) {
    journal.append(APPROVAL_POLICY_CONFIGURED, { mode: next.approvalMode })
    changed = true
  }
  return changed
}
