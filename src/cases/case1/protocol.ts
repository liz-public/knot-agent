export const SESSION_START = 'session.start'
export const SYSTEM_PROMPT = 'system.prompt'
export const USER_MESSAGE = 'user.message'
export const CONTEXT_DYNAMIC = 'context.dynamic'
export const CONTENT_REQUEST = 'content.request'
export const CONTENT_NO_MATCH = 'content.no_match'
export const LLM_REQUEST = 'llm.request'
export const LLM_INVOKE = 'llm.invoke'
export const LLM_GENERATED = 'llm.generated'
export const TOOL_REGISTRY = 'tool.registry'
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

export interface ToolRegistry {
  schemas: readonly Record<string, unknown>[]
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
  throughRequestId: string
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

// The manifest records how to rebuild one model input from the journal instead
// of storing the materialized messages, which would repeat the whole history
// once per generation and make the journal grow with the square of the turns.
export type ContextManifest =
  | {
    kind: 'agent'
    dynamicTurnId: string
    tailAfterRequestId?: string
    summaryOfRequirementId?: string
  }
  | {
    kind: 'compress'
    instruction: string
    tailAfterRequestId?: string
    tailThroughRequestId: string
  }

export interface LlmInvoke {
  requestId: string
  request: LlmRequest
  manifest: ContextManifest
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

// The boundary is the requestId of the generation that tripped the threshold,
// not a journal position: an index would silently shift under persistence,
// trimming, fork or replay instead of failing.
export interface HistoryCompactionRequired {
  requirementId: string
  throughRequestId: string
}

export interface HistoryCompressRequest extends HistoryCompactionRequired {
  turnId: string
  resume: AgentLlmRequest
}

export interface HistoryCheckpoint extends HistoryCompactionRequired {
  summary: string
}
