export const SESSION_START = 'session.start'
export const SYSTEM_PROMPT = 'system.prompt'
export const USER_MESSAGE = 'user.message'
export const CONTEXT_DYNAMIC = 'context.dynamic'
export const CONTENT_REQUEST = 'content.request'
export const CONTENT_NO_MATCH = 'content.no_match'
export const LLM_REQUEST = 'llm.request'
export const LLM_INVOKE = 'llm.invoke'
export const LLM_GENERATED = 'llm.generated'
export const TOOL_CALL = 'tool.call'
export const TOOL_RESULT = 'tool.result'
export const ASSISTANT_REASONING = 'assistant.reasoning'
export const ASSISTANT_MESSAGE = 'assistant.message'
export const HISTORY_COMPACTION_REQUIRED = 'history.compaction.required'
export const HISTORY_COMPRESS_REQUEST = 'history.compress.request'
export const HISTORY_CHECKPOINT = 'history.checkpoint'

export interface SystemPrompt {
  content: string
}

export interface UserMessage {
  turnId: string
  content: string
}

export interface DynamicContext {
  turnId: string
  content: string
  matchedPackages: readonly string[]
  matchedCommands: readonly string[]
  activeState: Readonly<Record<string, unknown>>
}

export interface ContentRequest {
  turnId: string
  query: string
}

export interface ContentNoMatch {
  turnId: string
}

export interface ToolCall {
  turnId: string
  callId: string
  name: string
  arguments: Record<string, unknown>
  assistantContent?: string
}

export interface ToolResult {
  turnId: string
  callId: string
  name: string
  content: string
  state?: {
    key: string
    value: unknown | null
  }
}

export interface AssistantReasoning {
  turnId: string
  content: string
}

export interface AssistantMessage {
  turnId: string
  content: string
}

export interface AgentLlmRequest {
  purpose: 'agent'
  turnId: string
}

export interface CompressionLlmRequest {
  purpose: 'history.compress'
  turnId: string
  requirementId: string
  throughIndex: number
  instruction: string
  resume: AgentLlmRequest
}

export type LlmRequest = AgentLlmRequest | CompressionLlmRequest

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

export interface LlmInvoke {
  requestId: string
  request: LlmRequest
  messages: readonly ChatMessage[]
  tools: readonly Record<string, unknown>[]
}

export interface GeneratedContent {
  reasoning?: string
  content?: string
  toolCalls: ReadonlyArray<{
    id: string
    name: string
    arguments: Record<string, unknown>
  }>
}

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  contextWindow: number
}

export interface LlmGenerated {
  requestId: string
  request: LlmRequest
  generated: GeneratedContent
  usage: LlmUsage
}

export interface HistoryCompactionRequired {
  requirementId: string
  throughIndex: number
}

export interface HistoryCompressRequest extends HistoryCompactionRequired {
  turnId: string
  resume: AgentLlmRequest
}

export interface HistoryCheckpoint extends HistoryCompactionRequired {
  summary: string
}
