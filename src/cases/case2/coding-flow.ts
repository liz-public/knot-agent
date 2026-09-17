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

function hasUserMessageAfterInvoke(
  events: readonly Event[],
  requestId: string,
): boolean {
  const invokeIndex = events.findIndex(event =>
    event.type === LLM_INVOKE && (event.data as LlmInvoke).requestId === requestId,
  )
  if (invokeIndex < 0) throw new Error(`no invocation recorded for requestId ${requestId}`)
  return events.slice(invokeIndex + 1).some(event => event.type === USER_MESSAGE)
}

export const codingFlowPlugin = (): Plugin => journal => {
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
    if (hasUserMessageAfterInvoke(journal.read(), generated.requestId)) {
      journal.append(LLM_REQUEST, {
        purpose: 'agent',
        turnId: activeTurnId ?? generated.request.turnId,
      })
      return
    }
    const content = generated.generated.content
    if (content === undefined || content.length === 0) {
      throw new Error('LLM response has neither a tool call nor text')
    }
    journal.append(ASSISTANT_MESSAGE, {
      turnId: activeTurnId ?? generated.request.turnId,
      content,
    })
    activeTurnId = undefined
  })
}
