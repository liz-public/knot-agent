import type { Event } from '../journal.js'
import { projectMessages, projectTools } from '../cases/case1/projection.js'
import {
  LLM_GENERATED,
  LLM_INVOKE,
  type ChatMessage,
  type LlmGenerated,
  type LlmInvoke,
  type LlmUsage,
} from '../cases/case1/protocol.js'

export interface ContextMessageDto extends ChatMessage {
  readonly estimatedTokens: number
}

export interface ContextProjectionDto {
  readonly requestId: string
  readonly purpose: LlmInvoke['request']['purpose']
  readonly manifest: LlmInvoke['manifest']
  readonly messages: readonly ContextMessageDto[]
  readonly tools: readonly Record<string, unknown>[]
  readonly estimatedMessageTokens: number
  readonly estimatedToolTokens: number
  readonly usage?: LlmUsage
}

function estimatedTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4)
}

function isInvoke(value: unknown): value is LlmInvoke {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<LlmInvoke>
  return typeof candidate.requestId === 'string'
    && typeof candidate.request === 'object'
    && candidate.request !== null
    && typeof candidate.manifest === 'object'
    && candidate.manifest !== null
}

export function projectModelContext(
  events: readonly Event[],
  requestedId?: string,
): ContextProjectionDto | undefined {
  const invokeEvent = [...events].reverse().find(event => {
    if (event.type !== LLM_INVOKE || !isInvoke(event.data)) return false
    return requestedId === undefined || event.data.requestId === requestedId
  })
  if (invokeEvent === undefined || !isInvoke(invokeEvent.data)) return undefined

  const invoke = invokeEvent.data
  const messages = projectMessages(events, invoke).map(message => ({
    ...message,
    estimatedTokens: estimatedTokens(message),
  }))
  const tools = invoke.manifest.kind === 'agent' ? projectTools(events) : []
  const generated = events.find(event => event.type === LLM_GENERATED
    && typeof event.data === 'object'
    && event.data !== null
    && (event.data as Partial<LlmGenerated>).requestId === invoke.requestId)
    ?.data as LlmGenerated | undefined

  return {
    requestId: invoke.requestId,
    purpose: invoke.request.purpose,
    manifest: invoke.manifest,
    messages,
    tools,
    estimatedMessageTokens: messages.reduce((sum, message) => sum + message.estimatedTokens, 0),
    estimatedToolTokens: tools.length === 0 ? 0 : estimatedTokens(tools),
    ...(generated?.usage === undefined ? {} : { usage: generated.usage }),
  }
}
