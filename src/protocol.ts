// The event types below are a convention shared by the plugins assembled in
// main.ts, not part of the kernel. journal.ts must never import this file.
// Keep this file free of runtime logic so it cannot become a hidden kernel.

export const SESSION_START = 'session.start'
export const SYSTEM_PROMPT = 'system.prompt'
export const USER_MESSAGE = 'user.message'
export const TOOL_CALL = 'tool.call'
export const TOOL_RESULT = 'tool.result'
export const ASSISTANT_MESSAGE = 'assistant.message'

export interface SystemPrompt {
  content: string
}

export interface UserMessage {
  content: string
}

export interface AssistantMessage {
  content: string
}

export interface ToolCall {
  callId: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  callId: string
  name: string
  output: unknown
}
