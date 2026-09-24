import type { Plugin } from '../../journal.js'
import {
  CONTEXT_DYNAMIC,
  CONTENT_REQUEST,
  LLM_REQUEST,
  TOOL_RESULT,
  type DynamicContext,
  type ToolResult,
} from './protocol.js'

export const agentFlowPlugin = (): Plugin => journal => {
  journal.subscribe(CONTEXT_DYNAMIC, event => {
    const message = event.data as DynamicContext
    journal.append(CONTENT_REQUEST, {
      turnId: message.turnId,
      query: message.query,
    })
  })

  // One tool.result carries the whole batch, so there is nothing to join: the
  // event exists only once every call the model requested has an answer.
  journal.subscribe(TOOL_RESULT, event => {
    const result = event.data as ToolResult
    journal.append(LLM_REQUEST, { purpose: 'agent', turnId: result.turnId })
  })
}
