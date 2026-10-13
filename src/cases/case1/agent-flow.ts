import type { Plugin } from '../../journal.js'
import {
  CONTEXT_DYNAMIC,
  CONTENT_REQUEST,
  LLM_REQUEST,
  TOOL_RESULT,
  LLM_GENERATED,
  ASSISTANT_MESSAGE,
  type LlmGenerated,
  type DynamicContext,
  type ToolResult,
} from './protocol.js'

export const agentFlowPlugin = (maxDecisions = 16): Plugin => journal => {
  if (!Number.isInteger(maxDecisions) || maxDecisions < 1) throw new Error('invalid decision budget')
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
    const decisions = journal.read().filter(event => event.type === LLM_GENERATED
      && (event.data as LlmGenerated).request.purpose === 'agent'
      && (event.data as LlmGenerated).request.turnId === result.turnId).length
    if (decisions >= maxDecisions) {
      journal.append(ASSISTANT_MESSAGE, {
        turnId: result.turnId,
        content: `本次处理达到 ${maxDecisions} 次决策上限，已停止。已经完成的操作不会撤销。`,
      })
      return
    }
    journal.append(LLM_REQUEST, { purpose: 'agent', turnId: result.turnId })
  })
}
