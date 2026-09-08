import type { Plugin } from '../../journal.js'
import {
  ASSISTANT_MESSAGE,
  ASSISTANT_REASONING,
  LLM_GENERATED,
  LLM_INVOKE,
  TOOL_CALL,
  type LlmGenerated,
  type LlmInvoke,
} from './protocol.js'

export interface LlmProvider {
  generate(invoke: LlmInvoke): Promise<Omit<LlmGenerated, 'requestId' | 'request'>>
}

export const llmPlugin = (provider: LlmProvider): Plugin =>
  journal => journal.subscribe(LLM_INVOKE, async event => {
    const invoke = event.data as LlmInvoke
    const result = await provider.generate(invoke)
    const generated: LlmGenerated = {
      requestId: invoke.requestId,
      request: invoke.request,
      ...result,
    }
    journal.append(LLM_GENERATED, generated)

    if (invoke.request.purpose !== 'agent') return

    const { reasoning, content, toolCalls } = result.generated
    if (reasoning !== undefined && reasoning.length > 0) {
      journal.append(ASSISTANT_REASONING, {
        turnId: invoke.request.turnId,
        content: reasoning,
      })
    }
    if (toolCalls.length > 0) {
      for (const call of toolCalls) {
        journal.append(TOOL_CALL, {
          turnId: invoke.request.turnId,
          callId: call.id,
          name: call.name,
          arguments: call.arguments,
          ...(content === undefined ? {} : { assistantContent: content }),
        })
      }
      return
    }
    if (content === undefined || content.length === 0) {
      throw new Error('LLM response has neither a tool call nor text')
    }
    journal.append(ASSISTANT_MESSAGE, {
      turnId: invoke.request.turnId,
      content,
    })
  })
