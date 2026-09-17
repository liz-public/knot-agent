import type { Event, Plugin } from '../../journal.js'
import {
  ASSISTANT_MESSAGE,
  CONTENT_REQUEST,
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

export interface CompletionBlocker {
  readonly reason: string
  readonly reminder: string
}

export interface CompletionInput {
  readonly candidate: string
  readonly requestId: string
  readonly events: readonly Event[]
}

export type CompletionGuard = (input: CompletionInput) => CompletionBlocker | undefined

function hasUserMessageAfterInvoke(events: readonly Event[], requestId: string): boolean {
  const invokeIndex = events.findIndex(event =>
    event.type === LLM_INVOKE && (event.data as LlmInvoke).requestId === requestId,
  )
  if (invokeIndex < 0) throw new Error(`no invocation recorded for requestId ${requestId}`)
  return events.slice(invokeIndex + 1).some(event => event.type === USER_MESSAGE)
}

function latestState(events: readonly Event[], key: string): unknown | undefined {
  for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex -= 1) {
    const event = events[eventIndex]
    if (event?.type !== TOOL_RESULT) continue
    const results = (event.data as ToolResult).results
    for (let resultIndex = results.length - 1; resultIndex >= 0; resultIndex -= 1) {
      const state = results[resultIndex]?.state
      if (state?.key === key) return state.value ?? undefined
    }
  }
  return undefined
}

export const steeringGuard: CompletionGuard = ({ events, requestId }) =>
  hasUserMessageAfterInvoke(events, requestId)
    ? {
      reason: 'new steering arrived during generation',
      reminder: 'A newer user message arrived after the previous model request. Continue from the updated request instead of finishing with the stale candidate.',
    }
    : undefined

export const todoGuard: CompletionGuard = ({ events }) => {
  const value = latestState(events, 'todo')
  if (!Array.isArray(value)) return undefined
  const incomplete = value.filter(item => {
    if (typeof item !== 'object' || item === null) return false
    return (item as { status?: unknown }).status !== 'completed'
  })
  if (incomplete.length === 0) return undefined
  return {
    reason: `${incomplete.length} todo item(s) remain incomplete`,
    reminder: `The following todo items are not completed:\n${JSON.stringify(incomplete)}\nContinue working and update todo.write before finishing.`,
  }
}

export const goalGuard: CompletionGuard = ({ events }) => {
  const value = latestState(events, 'goal')
  if (typeof value !== 'object' || value === null) return undefined
  const goal = value as { objective?: unknown; successCriteria?: unknown; status?: unknown }
  if (goal.status !== 'active') return undefined
  return {
    reason: 'the explicit goal is still active',
    reminder: [
      `The active goal has not been marked completed: ${String(goal.objective ?? '')}`,
      `Success criteria: ${JSON.stringify(goal.successCriteria ?? [])}`,
      'Continue working and update goal.write with status completed only after the criteria are satisfied.',
    ].join('\n'),
  }
}

export const codingFlowPlugin = (
  guards: readonly CompletionGuard[] = [steeringGuard, todoGuard, goalGuard],
): Plugin => journal => {
  let activeTurnId: string | undefined

  journal.subscribe(USER_MESSAGE, event => {
    const message = event.data as UserMessage
    if (activeTurnId !== undefined) return
    activeTurnId = message.turnId
    journal.append(CONTENT_REQUEST, { turnId: message.turnId, query: message.content })
  })

  journal.subscribe(TOOL_RESULT, event => {
    const result = event.data as ToolResult
    journal.append(LLM_REQUEST, { purpose: 'agent', turnId: activeTurnId ?? result.turnId })
  })

  journal.subscribe(LLM_GENERATED, event => {
    const generated = event.data as LlmGenerated
    if (generated.request.purpose !== 'agent' || generated.generated.toolCalls.length > 0) return
    const content = generated.generated.content
    if (content === undefined || content.length === 0) {
      throw new Error('LLM response has neither a tool call nor text')
    }
    const events = journal.read()
    const blockers = guards.flatMap(guard => {
      const blocker = guard({ candidate: content, requestId: generated.requestId, events })
      return blocker === undefined ? [] : [blocker]
    })
    if (blockers.length > 0) {
      journal.append(LLM_REQUEST, {
        purpose: 'agent',
        turnId: activeTurnId ?? generated.request.turnId,
        instruction: [
          'The previous response was not committed because completion checks failed.',
          ...blockers.map(blocker => `- ${blocker.reason}: ${blocker.reminder}`),
        ].join('\n'),
      })
      return
    }
    journal.append(ASSISTANT_MESSAGE, {
      turnId: activeTurnId ?? generated.request.turnId,
      content,
    })
    activeTurnId = undefined
  })
}
