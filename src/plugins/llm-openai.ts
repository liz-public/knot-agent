import type { Event, Plugin } from '../journal.js'
import {
  ASSISTANT_MESSAGE,
  SYSTEM_PROMPT,
  TOOL_CALL,
  TOOL_RESULT,
  USER_MESSAGE,
  type AssistantMessage,
  type SystemPrompt,
  type ToolCall,
  type ToolResult,
  type UserMessage,
} from '../protocol.js'

export interface OpenAiOptions {
  readonly baseUrl: string
  readonly apiKey?: string
  readonly model: string
  readonly tools: readonly Record<string, unknown>[]
  readonly extraBody?: Record<string, unknown>
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

// System prompts are collected by type rather than by journal position, so the
// projection stays correct no matter when they were appended.
export function project(events: readonly Event[]): ChatMessage[] {
  const prompts = events
    .filter(event => event.type === SYSTEM_PROMPT)
    .map(event => (event.data as SystemPrompt).content)
  const messages: ChatMessage[] = prompts.length === 0
    ? []
    : [{ role: 'system', content: prompts.join('\n\n') }]

  for (const event of events) {
    if (event.type === USER_MESSAGE) {
      messages.push({ role: 'user', content: (event.data as UserMessage).content })
    } else if (event.type === TOOL_CALL) {
      const call = event.data as ToolCall
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: call.callId,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        }],
      })
    } else if (event.type === TOOL_RESULT) {
      const result = event.data as ToolResult
      messages.push({
        role: 'tool',
        tool_call_id: result.callId,
        content: JSON.stringify(result.output),
      })
    } else if (event.type === ASSISTANT_MESSAGE) {
      messages.push({
        role: 'assistant',
        content: (event.data as AssistantMessage).content,
      })
    }
  }
  return messages
}

export const openAiLlmPlugin = (options: OpenAiOptions): Plugin => {
  const url = options.baseUrl.endsWith('/chat/completions')
    ? options.baseUrl
    : `${options.baseUrl.replace(/\/$/, '')}/chat/completions`

  return journal => {
    const generate = async (): Promise<void> => {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.apiKey === undefined
            ? {}
            : { authorization: `Bearer ${options.apiKey}` }),
        },
        body: JSON.stringify({
          ...options.extraBody,
          model: options.model,
          messages: project(journal.read()),
          tools: options.tools,
          tool_choice: 'auto',
        }),
      })
      if (!response.ok) {
        throw new Error(`LLM HTTP ${response.status}: ${await response.text()}`)
      }

      const body = await response.json() as {
        choices?: Array<{
          message?: {
            content?: string | null
            tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
          }
        }>
      }
      const message = body.choices?.[0]?.message
      if (message === undefined) throw new Error('LLM response has no message')

      const calls = message.tool_calls ?? []
      if (calls.length > 1) {
        throw new Error('parallel tool calls are not supported yet')
      }
      const call = calls[0]
      if (call !== undefined) {
        journal.append(TOOL_CALL, {
          callId: call.id,
          name: call.function.name,
          arguments: JSON.parse(call.function.arguments) as Record<string, unknown>,
        })
        return
      }
      if (typeof message.content !== 'string' || message.content.length === 0) {
        throw new Error('LLM response has neither a tool call nor text')
      }
      journal.append(ASSISTANT_MESSAGE, { content: message.content })
    }

    journal.subscribe(USER_MESSAGE, generate)
    journal.subscribe(TOOL_RESULT, generate)
  }
}
