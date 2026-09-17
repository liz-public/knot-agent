import type { Event, Plugin } from '../../journal.js'
import {
  ASSISTANT_MESSAGE,
  LLM_GENERATED,
  LLM_INVOKE,
  LLM_REQUEST,
  TOOL_RESULT,
  USER_MESSAGE,
  type LlmGenerated,
  type LlmInvoke,
  type ToolResult,
  type UserMessage,
} from '../case1/protocol.js'
import {
  WORKFLOW_COMPLETED,
  WORKFLOW_PHASE_CHANGED,
  WORKFLOW_STARTED,
  type WorkflowPhase,
  type WorkflowStarted,
} from './protocol.js'

interface ActiveWorkflow {
  readonly workflowId: string
  readonly turnId: string
  phase: WorkflowPhase
}

function hasSteeringAfterInvoke(events: readonly Event[], requestId: string): boolean {
  const invokeIndex = events.findIndex(event =>
    event.type === LLM_INVOKE && (event.data as LlmInvoke).requestId === requestId,
  )
  if (invokeIndex < 0) throw new Error(`no invocation recorded for requestId ${requestId}`)
  return events.slice(invokeIndex + 1).some(event => event.type === USER_MESSAGE)
}

function latestTodo(events: readonly Event[]): unknown | undefined {
  for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex -= 1) {
    const event = events[eventIndex]
    if (event?.type !== TOOL_RESULT) continue
    const results = (event.data as ToolResult).results
    for (let resultIndex = results.length - 1; resultIndex >= 0; resultIndex -= 1) {
      const state = results[resultIndex]?.state
      if (state?.key === 'todo') return state.value
    }
  }
  return undefined
}

function phaseInstruction(phase: WorkflowPhase, events: readonly Event[]): string {
  const todo = latestTodo(events)
  const todoContext = todo === undefined
    ? ''
    : `\nCurrent todo state:\n${JSON.stringify(todo)}`
  if (phase === 'finalizing') {
    return [
      'Workflow phase: finalizing.',
      'No tools are available. Give the user a concise final response based on the work and verification recorded in the conversation.',
      'Do not claim work or verification that is not present in the conversation.',
      todoContext,
    ].join('\n')
  }
  return [
    'Workflow phase: working.',
    'Continue working toward the user goal. Inspect, modify, and verify as needed before presenting a completion candidate.',
    todoContext,
  ].join('\n')
}

/** Owns one coding workflow: work until a candidate exists, then finalize it. */
export const codingWorkflowPlugin = (): Plugin => journal => {
  let active: ActiveWorkflow | undefined
  let workflowNumber = 0
  const workflowIds = new Set(journal.read()
    .filter(event => event.type === WORKFLOW_STARTED)
    .map(event => (event.data as WorkflowStarted).workflowId))

  const nextWorkflowId = (): string => {
    let workflowId: string
    do {
      workflowNumber += 1
      workflowId = `workflow-${workflowNumber}`
    } while (workflowIds.has(workflowId))
    workflowIds.add(workflowId)
    return workflowId
  }

  const request = (workflow: ActiveWorkflow): void => {
    journal.append(LLM_REQUEST, {
      purpose: 'agent',
      turnId: workflow.turnId,
      instruction: phaseInstruction(workflow.phase, journal.read()),
      toolMode: workflow.phase === 'finalizing' ? 'none' : 'all',
      streamMode: workflow.phase === 'finalizing' ? 'visible' : 'silent',
    })
  }

  const changePhase = (
    workflow: ActiveWorkflow,
    to: WorkflowPhase,
    reason: 'work_candidate_ready' | 'steering',
  ): void => {
    const from = workflow.phase
    if (from === to) return
    workflow.phase = to
    journal.append(WORKFLOW_PHASE_CHANGED, {
      workflowId: workflow.workflowId,
      from,
      to,
      reason,
    })
  }

  journal.subscribe(USER_MESSAGE, event => {
    if (active !== undefined) return
    const message = event.data as UserMessage
    active = {
      workflowId: nextWorkflowId(),
      turnId: message.turnId,
      phase: 'working',
    }
    journal.append(WORKFLOW_STARTED, {
      workflowId: active.workflowId,
      turnId: active.turnId,
      phase: 'working',
    })
    request(active)
  })

  journal.subscribe(TOOL_RESULT, () => {
    if (active === undefined) return
    request(active)
  })

  journal.subscribe(LLM_GENERATED, event => {
    const generated = event.data as LlmGenerated
    if (generated.request.purpose !== 'agent' || generated.generated.toolCalls.length > 0) return
    const workflow = active
    if (workflow === undefined) return

    // The candidate remains in the Journal for audit, but is not delivered
    // because it did not see the newest steering requirement.
    if (hasSteeringAfterInvoke(journal.read(), generated.requestId)) {
      changePhase(workflow, 'working', 'steering')
      request(workflow)
      return
    }

    const content = generated.generated.content
    if (content === undefined || content.length === 0) {
      throw new Error('LLM response has neither a tool call nor text')
    }

    if (workflow.phase === 'working') {
      changePhase(workflow, 'finalizing', 'work_candidate_ready')
      request(workflow)
      return
    }

    journal.append(ASSISTANT_MESSAGE, { turnId: workflow.turnId, content })
    journal.append(WORKFLOW_COMPLETED, {
      workflowId: workflow.workflowId,
      turnId: workflow.turnId,
    })
    active = undefined
  })
}
