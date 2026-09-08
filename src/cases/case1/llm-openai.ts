import type { Plugin } from '../../journal.js'
import { llmPlugin, type LlmCall, type LlmProvider } from './llm.js'

export interface OpenAiLlmOptions {
  readonly baseUrl: string
  readonly apiKey?: string
  readonly model: string
  readonly extraBody?: Readonly<Record<string, unknown>>
  readonly contextWindow?: number
}

export const openAiLlmPlugin = (options: OpenAiLlmOptions): Plugin => {
  const url = options.baseUrl.endsWith('/chat/completions')
    ? options.baseUrl
    : `${options.baseUrl.replace(/\/$/, '')}/chat/completions`

  const provider: LlmProvider = {
    async generate(call: LlmCall) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.apiKey === undefined ? {} : { authorization: `Bearer ${options.apiKey}` }),
        },
        body: JSON.stringify({
          ...options.extraBody,
          model: options.model,
          messages: call.messages,
          ...(call.tools.length === 0
            ? {}
            : { tools: call.tools, tool_choice: 'auto' }),
        }),
      })
      if (!response.ok) {
        throw new Error(`LLM HTTP ${response.status}: ${await response.text()}`)
      }

      const body = await response.json() as OpenAiResponse
      const message = body.choices?.[0]?.message
      if (message === undefined) throw new Error('LLM response has no message')

      return {
        generated: {
          ...(typeof message.reasoning_content === 'string'
            ? { reasoning: message.reasoning_content }
            : typeof message.reasoning === 'string' ? { reasoning: message.reasoning } : {}),
          ...(typeof message.content === 'string' ? { content: message.content } : {}),
          toolCalls: (message.tool_calls ?? []).map(call => ({
            id: call.id,
            name: call.function.name,
            arguments: JSON.parse(call.function.arguments) as Record<string, unknown>,
          })),
        },
        usage: {
          inputTokens: body.usage?.prompt_tokens ?? 0,
          outputTokens: body.usage?.completion_tokens ?? 0,
          totalTokens: body.usage?.total_tokens ?? 0,
          contextWindow: options.contextWindow ?? Number.MAX_SAFE_INTEGER,
        },
      }
    },
  }

  return llmPlugin(provider)
}

interface OpenAiResponse {
  choices?: Array<{
    message?: {
      content?: string | null
      reasoning_content?: string | null
      reasoning?: string | null
      tool_calls?: Array<{
        id: string
        function: { name: string; arguments: string }
      }>
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}
