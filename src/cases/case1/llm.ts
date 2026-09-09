import type { Plugin } from '../../journal.js'
import { projectMessages, projectTools } from './projection.js'
import {
  ASSISTANT_MESSAGE,
  ASSISTANT_REASONING,
  LLM_GENERATED,
  LLM_INVOKE,
  TOOL_CALL,
  type ChatMessage,
  type LlmGenerated,
  type LlmInvoke,
  type LlmRequest,
} from './protocol.js'

export interface LlmCall {
  readonly request: LlmRequest
  readonly messages: readonly ChatMessage[]
  readonly tools: readonly Record<string, unknown>[]
}

export interface LlmProvider {
  generate(call: LlmCall): Promise<Pick<LlmGenerated, 'generated' | 'usage'>>
}

export const llmPlugin = (provider: LlmProvider): Plugin =>
  journal => journal.subscribe(LLM_INVOKE, async event => {
    const invoke = event.data as LlmInvoke
    const events = journal.read()
    const result = await provider.generate({
      request: invoke.request,
      messages: projectMessages(events, invoke),
      tools: invoke.manifest.kind === 'agent' ? projectTools(events) : [],
    })
    journal.append(LLM_GENERATED, {
      requestId: invoke.requestId,
      request: invoke.request,
      ...result,
    })

    if (invoke.request.purpose !== 'agent') return

    const { reasoning, content, toolCalls } = result.generated
    if (reasoning !== undefined && reasoning.length > 0) {
      journal.append(ASSISTANT_REASONING, {
        turnId: invoke.request.turnId,
        content: reasoning,
      })
    }
    if (toolCalls.length > 0) {
      journal.append(TOOL_CALL, {
        turnId: invoke.request.turnId,
        ...(content === undefined ? {} : { assistantContent: content }),
        calls: toolCalls.map(call => ({
          callId: call.id,
          name: call.name,
          arguments: call.arguments,
        })),
      })
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
