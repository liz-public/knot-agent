import type { Event, Plugin } from '../../journal.js'
import {
  ASSISTANT_MESSAGE,
  CONTEXT_DYNAMIC,
  HISTORY_CHECKPOINT,
  HISTORY_COMPACTION_REQUIRED,
  HISTORY_COMPRESS_REQUEST,
  LLM_GENERATED,
  LLM_INVOKE,
  LLM_REQUEST,
  SYSTEM_PROMPT,
  TOOL_CALL,
  TOOL_RESULT,
  USER_MESSAGE,
  type AssistantMessage,
  type ChatMessage,
  type DynamicContext,
  type HistoryCheckpoint,
  type HistoryCompactionRequired,
  type LlmGenerated,
  type LlmRequest,
  type SystemPrompt,
  type ToolCall,
  type ToolResult,
  type UserMessage,
} from './protocol.js'

function pendingCompaction(events: readonly Event[]): HistoryCompactionRequired | undefined {
  const completed = new Set(events
    .filter(event => event.type === HISTORY_CHECKPOINT)
    .map(event => (event.data as HistoryCheckpoint).requirementId))
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== HISTORY_COMPACTION_REQUIRED) continue
    const requirement = event.data as HistoryCompactionRequired
    if (!completed.has(requirement.requirementId)) return requirement
  }
  return undefined
}

function latestCheckpoint(events: readonly Event[]): HistoryCheckpoint | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === HISTORY_CHECKPOINT) return event.data as HistoryCheckpoint
  }
  return undefined
}

function generationIndex(events: readonly Event[], requestId: string): number {
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    if (event?.type !== LLM_GENERATED) continue
    if ((event.data as LlmGenerated).requestId === requestId) return index
  }
  throw new Error(`no generation recorded for requestId ${requestId}`)
}

function tailStart(events: readonly Event[], checkpoint?: HistoryCheckpoint): number {
  if (checkpoint === undefined) return 0
  return generationIndex(events, checkpoint.throughRequestId) + 1
}

function semanticMessages(
  events: readonly Event[],
  startIndex: number,
  endIndex = events.length - 1,
  dynamic?: DynamicContext,
): ChatMessage[] {
  const messages: ChatMessage[] = []
  for (let index = startIndex; index <= endIndex; index += 1) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === USER_MESSAGE) {
      const message = event.data as UserMessage
      messages.push({ role: 'user', content: message.content })
      if (dynamic?.turnId === message.turnId) {
        messages.push({
          role: 'user',
          content: `以下是仅对当前用户请求有效的运行时上下文：\n${dynamic.content}`,
        })
      }
    } else if (event.type === TOOL_CALL) {
      const call = event.data as ToolCall
      messages.push({
        role: 'assistant',
        content: call.assistantContent ?? null,
        tool_calls: [{
          id: call.callId,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        }],
      })
    } else if (event.type === TOOL_RESULT) {
      const result = event.data as ToolResult
      messages.push({ role: 'tool', tool_call_id: result.callId, content: result.content })
    } else if (event.type === ASSISTANT_MESSAGE) {
      messages.push({
        role: 'assistant',
        content: (event.data as AssistantMessage).content,
      })
    }
  }
  return messages
}

export const contextAssemblerPlugin = (
  tools: readonly Record<string, unknown>[],
): Plugin => journal => {
  let requestNumber = 0

  journal.subscribe(LLM_REQUEST, event => {
    const request = event.data as LlmRequest
    const events = journal.read()

    if (request.purpose === 'agent') {
      const pending = pendingCompaction(events)
      if (pending !== undefined) {
        journal.append(HISTORY_COMPRESS_REQUEST, {
          ...pending,
          turnId: request.turnId,
          resume: request,
        })
        return
      }
    }

    let messages: ChatMessage[]
    if (request.purpose === 'history.compress') {
      const start = tailStart(events, latestCheckpoint(events))
      const through = generationIndex(events, request.throughRequestId)
      messages = [
        { role: 'system', content: request.instruction },
        {
          role: 'user',
          content: JSON.stringify(semanticMessages(events, start, through)),
        },
      ]
    } else {
      const prompts = events
        .filter(item => item.type === SYSTEM_PROMPT)
        .map(item => (item.data as SystemPrompt).content)
      const checkpoint = latestCheckpoint(events)
      const start = tailStart(events, checkpoint)
      messages = prompts.length === 0
        ? []
        : [{ role: 'system', content: prompts.join('\n\n') }]
      if (checkpoint !== undefined) {
        messages.push({ role: 'system', content: `此前会话摘要：\n${checkpoint.summary}` })
      }
      let dynamic: DynamicContext | undefined
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const item = events[index]
        if (item?.type !== CONTEXT_DYNAMIC) continue
        const candidate = item.data as DynamicContext
        if (candidate.turnId === request.turnId) {
          dynamic = candidate
          break
        }
      }
      const currentUserIsAfterCheckpoint = events.slice(start).some(item =>
        item.type === USER_MESSAGE && (item.data as UserMessage).turnId === request.turnId,
      )
      if (dynamic !== undefined && !currentUserIsAfterCheckpoint) {
        messages.push({
          role: 'user',
          content: `以下是仅对当前用户请求有效的运行时上下文：\n${dynamic.content}`,
        })
      }
      messages.push(...semanticMessages(events, start, events.length - 1, dynamic))
    }

    requestNumber += 1
    journal.append(LLM_INVOKE, {
      requestId: `${request.purpose}-${requestNumber}`,
      request,
      messages,
      tools: request.purpose === 'agent' ? tools : [],
    })
  })
}
