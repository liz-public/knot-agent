import type { LlmProvider } from './llm.js'
import { openAiLlmProvider } from './llm-openai.js'

export interface DeepSeekLlmOptions {
  readonly apiKey: string
  readonly model: string
  readonly baseUrl?: string
  readonly contextWindow?: number
  readonly thinking?: 'enabled' | 'disabled'
  readonly reasoningEffort?: 'none' | 'low' | 'high' | 'max'
  readonly extraBody?: Readonly<Record<string, unknown>>
}

/**
 * DeepSeek uses the OpenAI Chat Completions wire shape, but thinking mode with
 * tools requires every historical assistant message to carry the
 * reasoning_content field. The canonical projection stays provider-neutral;
 * this adapter supplies an empty field only where DeepSeek requires one.
 */
export function deepSeekLlmProvider(options: DeepSeekLlmOptions): LlmProvider {
  const provider = openAiLlmProvider({
    baseUrl: options.baseUrl ?? 'https://api.deepseek.com',
    apiKey: options.apiKey,
    model: options.model,
    ...(options.contextWindow === undefined ? {} : { contextWindow: options.contextWindow }),
    extraBody: {
      ...options.extraBody,
      ...(options.thinking === undefined ? {} : { thinking: { type: options.thinking } }),
      ...(options.reasoningEffort === undefined
        ? {}
        : { reasoning_effort: options.reasoningEffort }),
    },
  })

  return {
    generate(call, onUpdate) {
      if (call.tools.length === 0) return provider.generate(call, onUpdate)
      return provider.generate({
        ...call,
        messages: call.messages.map(message => message.role === 'assistant'
          ? { ...message, reasoning: message.reasoning ?? '' }
          : message),
      }, onUpdate)
    },
  }
}
