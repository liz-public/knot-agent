import type { Event } from '../../journal.js'
import {
  ASSISTANT_MESSAGE,
  CONTEXT_DYNAMIC,
  HISTORY_CHECKPOINT,
  LLM_GENERATED,
  LLM_INVOKE,
  SYSTEM_PROMPT,
  TOOL_CALL,
  TOOL_REGISTRY,
  TOOL_RESULT,
  USER_MESSAGE,
  type AssistantMessage,
  type ChatMessage,
  type DynamicContext,
  type HistoryCheckpoint,
  type LlmGenerated,
  type LlmInvoke,
  type SystemPrompt,
  type ToolCall,
  type ToolRegistry,
  type ToolResult,
  type UserMessage,
} from './protocol.js'

const dynamicContextPrefix = '以下是仅对当前用户请求有效的运行时上下文：'

function generationIndex(events: readonly Event[], requestId: string): number {
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event?.type !== LLM_GENERATED) continue
    if ((event.data as LlmGenerated).requestId === requestId) return index
  }
  throw new Error(`no generation recorded for requestId ${requestId}`)
}

function invokeIndex(events: readonly Event[], requestId: string): number {
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event?.type !== LLM_INVOKE) continue
    if ((event.data as LlmInvoke).requestId === requestId) return index
  }
  throw new Error(`no invocation recorded for requestId ${requestId}`)
}

function checkpointSummary(events: readonly Event[], requirementId: string): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== HISTORY_CHECKPOINT) continue
    const checkpoint = event.data as HistoryCheckpoint
    if (checkpoint.requirementId === requirementId) return checkpoint.summary
  }
  return undefined
}

function dynamicContext(events: readonly Event[], turnId: string): DynamicContext | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== CONTEXT_DYNAMIC) continue
    const candidate = event.data as DynamicContext
    if (candidate.turnId === turnId) return candidate
  }
  return undefined
}

function dynamicMessage(context: DynamicContext): ChatMessage {
  return { role: 'user', content: `${dynamicContextPrefix}\n${context.content}` }
}

export function isDynamicContextMessage(message: ChatMessage): boolean {
  return message.content?.startsWith(dynamicContextPrefix) ?? false
}

function semanticMessages(
  events: readonly Event[],
  startIndex: number,
  endIndex: number,
  dynamic?: DynamicContext,
): ChatMessage[] {
  const messages: ChatMessage[] = []
  for (let index = startIndex; index <= endIndex; index += 1) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === USER_MESSAGE) {
      const message = event.data as UserMessage
      messages.push({ role: 'user', content: message.content })
      if (dynamic?.turnId === message.turnId) messages.push(dynamicMessage(dynamic))
    } else if (event.type === TOOL_CALL) {
      // One assistant message carrying every call of the batch, immediately
      // followed by one tool message per result: the shape the API requires.
      const batch = event.data as ToolCall
      messages.push({
        role: 'assistant',
        content: batch.assistantContent ?? null,
        tool_calls: batch.calls.map(call => ({
          id: call.callId,
          type: 'function' as const,
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        })),
      })
    } else if (event.type === TOOL_RESULT) {
      for (const result of (event.data as ToolResult).results) {
        messages.push({ role: 'tool', tool_call_id: result.callId, content: result.content })
      }
    } else if (event.type === ASSISTANT_MESSAGE) {
      messages.push({ role: 'assistant', content: (event.data as AssistantMessage).content })
    }
  }
  return messages
}

// Both ends of the window are addressed by content, so projecting the same
// invocation against a longer journal later yields the same messages.
export function projectMessages(events: readonly Event[], invoke: LlmInvoke): ChatMessage[] {
  const { manifest } = invoke
  const start = manifest.tailAfterRequestId === undefined
    ? 0
    : generationIndex(events, manifest.tailAfterRequestId) + 1

  if (manifest.kind === 'compress') {
    const through = generationIndex(events, manifest.tailThroughRequestId)
    return [
      { role: 'system', content: manifest.instruction },
      { role: 'user', content: JSON.stringify(semanticMessages(events, start, through)) },
    ]
  }

  const messages: ChatMessage[] = []
  const prompts = events
    .filter(event => event.type === SYSTEM_PROMPT)
    .map(event => (event.data as SystemPrompt).content)
  if (prompts.length > 0) messages.push({ role: 'system', content: prompts.join('\n\n') })

  const summary = manifest.summaryOfRequirementId === undefined
    ? undefined
    : checkpointSummary(events, manifest.summaryOfRequirementId)
  if (summary !== undefined) {
    messages.push({ role: 'system', content: `此前会话摘要：\n${summary}` })
  }

  const through = invokeIndex(events, invoke.requestId) - 1
  const dynamic = dynamicContext(events, manifest.dynamicTurnId)
  const turnIsInTail = events.slice(start, through + 1).some(event =>
    event.type === USER_MESSAGE
    && (event.data as UserMessage).turnId === manifest.dynamicTurnId,
  )
  // Once the user message has been folded into a summary, the dynamic context
  // has nothing to attach to and must be restated before the tail.
  if (dynamic !== undefined && !turnIsInTail) messages.push(dynamicMessage(dynamic))
  messages.push(...semanticMessages(events, start, through, dynamic))
  return messages
}

export function projectTools(events: readonly Event[]): readonly Record<string, unknown>[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === TOOL_REGISTRY) return (event.data as ToolRegistry).schemas
  }
  return []
}
