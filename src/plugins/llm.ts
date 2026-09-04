import type { Event, Plugin, PluginContext } from '../core.js'
import {
  events,
  type AssistantMessage,
  type ToolCall,
  type ToolResult,
  type UserMessage,
} from '../protocol.js'

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

function project(events_: readonly Event[], system: string): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: system }]
  for (const event of events_) {
    if (event.type === events.userMessage) {
      messages.push({ role: 'user', content: (event.data as UserMessage).content })
    } else if (event.type === events.toolCall) {
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
    } else if (event.type === events.toolResult) {
      const result = event.data as ToolResult
      messages.push({
        role: 'tool',
        tool_call_id: result.callId,
        content: JSON.stringify(result.output),
      })
    } else if (event.type === events.assistantMessage) {
      messages.push({
        role: 'assistant',
        content: (event.data as AssistantMessage).content,
      })
    }
  }
  return messages
}

export class MockLlmPlugin implements Plugin {
  readonly name = 'llm.mock'
  readonly subscriptions = [events.userMessage, events.toolResult]

  handle(event: Event, context: PluginContext): void {
    if (event.type === events.userMessage) {
      context.append(events.toolCall, {
        callId: 'demo-call-1',
        name: 'demo_lookup',
        arguments: { name: 'knot-agent' },
      })
      return
    }
    const result = event.data as ToolResult
    context.append(events.assistantMessage, {
      content: `Tool ${result.name} returned: ${JSON.stringify(result.output)}`,
    })
  }
}

export interface OpenAiChatOptions {
  readonly baseUrl: string
  readonly apiKey?: string
  readonly model: string
  readonly system: string
  readonly tools: readonly Record<string, unknown>[]
  readonly extraBody?: Record<string, unknown>
}

export class OpenAiChatPlugin implements Plugin {
  readonly name = 'llm.openai-compatible'
  readonly subscriptions = [events.userMessage, events.toolResult]

  constructor(readonly options: OpenAiChatOptions) {}

  async handle(_event: Event, context: PluginContext): Promise<void> {
    const url = this.options.baseUrl.endsWith('/chat/completions')
      ? this.options.baseUrl
      : `${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.options.apiKey === undefined
          ? {}
          : { authorization: `Bearer ${this.options.apiKey}` }),
      },
      body: JSON.stringify({
        ...this.options.extraBody,
        model: this.options.model,
        messages: project(context.read(), this.options.system),
        tools: this.options.tools,
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
          tool_calls?: Array<{
            id: string
            function: { name: string; arguments: string }
          }>
        }
      }>
    }
    const message = body.choices?.[0]?.message
    if (message === undefined) throw new Error('LLM response has no message')
    const calls = message.tool_calls ?? []
    if (calls.length > 1) throw new Error('minimal runtime accepts one tool call per response')
    const call = calls[0]
    if (call !== undefined) {
      context.append(events.toolCall, {
        callId: call.id,
        name: call.function.name,
        arguments: JSON.parse(call.function.arguments) as Record<string, unknown>,
      })
      return
    }
    if (typeof message.content !== 'string' || message.content.length === 0) {
      throw new Error('LLM response has neither a tool call nor text')
    }
    context.append(events.assistantMessage, { content: message.content })
  }
}
