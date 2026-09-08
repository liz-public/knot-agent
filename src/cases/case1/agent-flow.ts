import type { Event, Plugin } from '../../journal.js'
import {
  CONTENT_NO_MATCH,
  CONTENT_REQUEST,
  LLM_REQUEST,
  TOOL_CALL,
  TOOL_RESULT,
  type ContentNoMatch,
  type ToolCall,
  type ToolResult,
  type UserMessage,
  USER_MESSAGE,
} from './protocol.js'

// A generation may emit several tool.call events at once. Every result is
// delivered after all of them are already appended, so "no call is outstanding"
// is true for each of them; only the last appended result may resume the turn.
function turnIsReadyToResume(
  events: readonly Event[],
  result: Event,
  turnId: string,
): boolean {
  const outstanding = new Set<string>()
  let lastResult: Event | undefined
  for (const item of events) {
    if (item.type === TOOL_CALL) {
      const call = item.data as ToolCall
      if (call.turnId === turnId) outstanding.add(call.callId)
    } else if (item.type === TOOL_RESULT) {
      const done = item.data as ToolResult
      if (done.turnId !== turnId) continue
      outstanding.delete(done.callId)
      lastResult = item
    }
  }
  return outstanding.size === 0 && lastResult === result
}

export const agentFlowPlugin = (): Plugin => journal => {
  journal.subscribe(USER_MESSAGE, event => {
    const message = event.data as UserMessage
    journal.append(CONTENT_REQUEST, {
      turnId: message.turnId,
      query: message.content,
    })
  })

  journal.subscribe(CONTENT_NO_MATCH, event => {
    const miss = event.data as ContentNoMatch
    journal.append(LLM_REQUEST, { purpose: 'agent', turnId: miss.turnId })
  })

  journal.subscribe(TOOL_RESULT, event => {
    const result = event.data as ToolResult
    if (!turnIsReadyToResume(journal.read(), event, result.turnId)) return
    journal.append(LLM_REQUEST, { purpose: 'agent', turnId: result.turnId })
  })
}
