import type { Plugin } from '../../journal.js'
import {
  CONTENT_REQUEST,
  LLM_REQUEST,
  TOOL_RESULT,
  type ToolResult,
  type UserMessage,
  USER_MESSAGE,
} from './protocol.js'

export const agentFlowPlugin = (): Plugin => journal => {
  journal.subscribe(USER_MESSAGE, event => {
    const message = event.data as UserMessage
    journal.append(CONTENT_REQUEST, {
      turnId: message.turnId,
      query: message.content,
    })
  })

  // One tool.result carries the whole batch, so there is nothing to join: the
  // event exists only once every call the model requested has an answer.
  journal.subscribe(TOOL_RESULT, event => {
    const result = event.data as ToolResult
    journal.append(LLM_REQUEST, { purpose: 'agent', turnId: result.turnId })
  })
}
