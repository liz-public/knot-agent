export const WORKFLOW_STARTED = 'workflow.started'
export const WORKFLOW_PHASE_CHANGED = 'workflow.phase.changed'
export const WORKFLOW_COMPLETED = 'workflow.completed'

export type WorkflowPhase = 'working' | 'finalizing'

export interface WorkflowStarted {
  readonly workflowId: string
  readonly turnId: string
  readonly phase: 'working'
}

export interface WorkflowPhaseChanged {
  readonly workflowId: string
  readonly from: WorkflowPhase
  readonly to: WorkflowPhase
  readonly reason: 'work_candidate_ready' | 'steering'
}

export interface WorkflowCompleted {
  readonly workflowId: string
  readonly turnId: string
}
