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

function toolNameMaps(tools: readonly Record<string, unknown>[]) {
  const canonicalToWire = new Map<string, string>()
  const wireToCanonical = new Map<string, string>()
  for (const tool of tools) {
    const fn = tool['function']
    if (typeof fn !== 'object' || fn === null) continue
    const canonical = (fn as Record<string, unknown>)['name']
    if (typeof canonical !== 'string') continue
    const stem = canonical.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'tool'
    let wire = stem
    let suffix = 1
    while (wireToCanonical.has(wire) && wireToCanonical.get(wire) !== canonical) {
      suffix += 1
      wire = `${stem.slice(0, 116)}_${suffix}`
    }
    canonicalToWire.set(canonical, wire)
    wireToCanonical.set(wire, canonical)
  }
  return { canonicalToWire, wireToCanonical }
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
      const { canonicalToWire, wireToCanonical } = toolNameMaps(call.tools)
      const wireTools = call.tools.map(tool => {
        const fn = tool['function']
        if (typeof fn !== 'object' || fn === null) return tool
        const record = fn as Record<string, unknown>
        const name = record['name']
        return typeof name !== 'string' ? tool : {
          ...tool,
          function: { ...record, name: canonicalToWire.get(name) ?? name },
        }
      })
      const streamedNames = new Map<number, string>()
      const wireCall = provider.generate({
        ...call,
        messages: call.messages.map(message => message.role === 'assistant'
          ? {
            ...message,
            reasoning: message.reasoning ?? '',
            ...(message.tool_calls === undefined ? {} : {
              tool_calls: message.tool_calls.map(toolCall => ({
                ...toolCall,
                function: {
                  ...toolCall.function,
                  name: canonicalToWire.get(toolCall.function.name) ?? toolCall.function.name,
                },
              })),
            }),
          }
          : message),
        tools: wireTools,
      }, onUpdate === undefined ? undefined : update => {
        if (update.kind !== 'tool_call' || update.name === undefined) return onUpdate(update)
        const name = `${streamedNames.get(update.index) ?? ''}${update.name}`
        streamedNames.set(update.index, name)
        const canonical = wireToCanonical.get(name)
        const { name: _name, ...rest } = update
        return onUpdate(canonical === undefined ? rest : { ...rest, name: canonical })
      })
      return wireCall.then(result => ({
        ...result,
        generated: {
          ...result.generated,
          toolCalls: result.generated.toolCalls.map(toolCall => ({
            ...toolCall,
            name: wireToCanonical.get(toolCall.name) ?? toolCall.name,
          })),
        },
      }))
    },
  }
}
