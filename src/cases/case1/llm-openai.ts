import type { Plugin } from '../../journal.js'
import {
  llmPlugin,
  type GenerationUpdate,
  type LiveOutput,
  type LlmCall,
  type LlmProvider,
} from './llm.js'

export interface OpenAiLlmOptions {
  readonly baseUrl: string
  readonly apiKey?: string
  readonly model: string
  readonly extraBody?: Readonly<Record<string, unknown>>
  readonly contextWindow?: number
}

export const openAiLlmPlugin = (
  options: OpenAiLlmOptions,
  liveOutput?: LiveOutput,
): Plugin => {
  const url = options.baseUrl.endsWith('/chat/completions')
    ? options.baseUrl
    : `${options.baseUrl.replace(/\/$/, '')}/chat/completions`

  const provider: LlmProvider = {
    async generate(call: LlmCall, onUpdate) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.apiKey === undefined ? {} : { authorization: `Bearer ${options.apiKey}` }),
        },
        body: JSON.stringify({
          ...options.extraBody,
          model: options.model,
          messages: call.messages.map(({ reasoning, ...message }) => ({
            ...message,
            ...(reasoning === undefined ? {} : { reasoning_content: reasoning }),
          })),
          ...(call.tools.length === 0
            ? {}
            : { tools: call.tools, tool_choice: 'auto' }),
          ...(onUpdate === undefined ? {} : { stream: true }),
        }),
      })
      if (!response.ok) {
        throw new Error(`LLM HTTP ${response.status}: ${await response.text()}`)
      }

      if (onUpdate !== undefined) {
        return readOpenAiStream(response, onUpdate, options.contextWindow)
      }

      const body = await response.json() as OpenAiResponse
      return responseResult(body, options.contextWindow ?? Number.MAX_SAFE_INTEGER)
    },
  }

  return llmPlugin(provider, liveOutput)
}

async function readOpenAiStream(
  response: Response,
  onUpdate: (update: GenerationUpdate) => void | Promise<void>,
  contextWindow = Number.MAX_SAFE_INTEGER,
) {
  if (response.headers.get('content-type')?.includes('application/json')) {
    const body = await response.json() as OpenAiResponse
    const message = body.choices?.[0]?.message
    if (message === undefined) throw new Error('LLM response has no message')
    if (typeof message.reasoning_content === 'string') {
      await onUpdate({ kind: 'reasoning', text: message.reasoning_content })
    } else if (typeof message.reasoning === 'string') {
      await onUpdate({ kind: 'reasoning', text: message.reasoning })
    }
    if (typeof message.content === 'string') {
      await onUpdate({ kind: 'content', text: message.content })
    }
    return responseResult(body, contextWindow)
  }

  if (response.body === null) throw new Error('streaming LLM response has no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''
  let usage: OpenAiResponse['usage']
  const calls = new Map<number, { id: string; name: string; arguments: string }>()

  const consumeLine = async (line: string) => {
    if (!line.startsWith('data:')) return
    const data = line.slice(5).trimStart()
    if (data.length === 0 || data === '[DONE]') return
    const chunk = JSON.parse(data) as OpenAiStreamChunk
    usage = chunk.usage ?? usage
    const delta = chunk.choices?.[0]?.delta
    if (delta === undefined) return
    const reasoningDelta = typeof delta.reasoning_content === 'string'
      ? delta.reasoning_content
      : typeof delta.reasoning === 'string' ? delta.reasoning : undefined
    if (reasoningDelta !== undefined && reasoningDelta.length > 0) {
      reasoning += reasoningDelta
      await onUpdate({ kind: 'reasoning', text: reasoningDelta })
    }
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      content += delta.content
      await onUpdate({ kind: 'content', text: delta.content })
    }
    for (const call of delta.tool_calls ?? []) {
      const current = calls.get(call.index) ?? { id: '', name: '', arguments: '' }
      current.id += call.id ?? ''
      current.name += call.function?.name ?? ''
      current.arguments += call.function?.arguments ?? ''
      calls.set(call.index, current)
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) await consumeLine(line)
    if (done) break
  }
  if (buffer.length > 0) await consumeLine(buffer)

  return {
    generated: {
      ...(reasoning.length === 0 ? {} : { reasoning }),
      ...(content.length === 0 ? {} : { content }),
      toolCalls: [...calls.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, call]) => {
          if (call.id.length === 0 || call.name.length === 0) {
            throw new Error('streaming LLM response has an incomplete tool call')
          }
          return {
            id: call.id,
            name: call.name,
            arguments: JSON.parse(call.arguments) as Record<string, unknown>,
          }
        }),
    },
    usage: {
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
      contextWindow,
    },
  }
}

function responseResult(body: OpenAiResponse, contextWindow: number) {
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
      contextWindow,
    },
  }
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

interface OpenAiStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      reasoning?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
  }>
  usage?: OpenAiResponse['usage']
}
