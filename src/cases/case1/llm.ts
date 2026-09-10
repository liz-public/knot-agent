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

export type GenerationUpdate =
  | { readonly kind: 'content'; readonly text: string }
  | { readonly kind: 'reasoning'; readonly text: string }

export interface LiveOutputMeta {
  readonly requestId: string
  readonly turnId: string
  readonly purpose: LlmRequest['purpose']
}

export interface LiveChannel {
  write(update: GenerationUpdate): void | Promise<void>
  close(): void | Promise<void>
}

/** Optional, non-authoritative presentation port. It cannot advance the journal. */
export interface LiveOutput {
  open(meta: LiveOutputMeta): LiveChannel | undefined
}

export interface LlmProvider {
  generate(
    call: LlmCall,
    onUpdate?: (update: GenerationUpdate) => void | Promise<void>,
  ): Promise<Pick<LlmGenerated, 'generated' | 'usage'>>
}

export const llmPlugin = (provider: LlmProvider, liveOutput?: LiveOutput): Plugin =>
  journal => journal.subscribe(LLM_INVOKE, async event => {
    const invoke = event.data as LlmInvoke
    const events = journal.read()
    let channel: LiveChannel | undefined
    try {
      channel = liveOutput?.open({
        requestId: invoke.requestId,
        turnId: invoke.request.turnId,
        purpose: invoke.request.purpose,
      })
    } catch {
      // Opening a presentation surface is best-effort too.
    }
    let result: Pick<LlmGenerated, 'generated' | 'usage'>
    try {
      result = await provider.generate(
        {
          request: invoke.request,
          messages: projectMessages(events, invoke),
          tools: invoke.manifest.kind === 'agent' ? projectTools(events) : [],
        },
        channel === undefined ? undefined : async update => {
          try {
            await channel.write(update)
          } catch {
            // Presentation is best-effort and cannot change agent semantics.
          }
        },
      )
    } finally {
      try {
        await channel?.close()
      } catch {
        // A disconnected UI must not turn a completed generation into failure.
      }
    }
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
        sourceRequestId: invoke.requestId,
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
