import type { Plugin } from '../../journal.js'
import {
  CONTENT_NO_MATCH,
  CONTENT_REQUEST,
  LLM_REQUEST,
  TOOL_RESULT,
  USER_MESSAGE,
  type ContentNoMatch,
  type ToolResult,
  type UserMessage,
} from './protocol.js'

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
    journal.append(LLM_REQUEST, { purpose: 'agent', turnId: result.turnId })
  })
}
