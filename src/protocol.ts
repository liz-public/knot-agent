export const events = {
  userMessage: 'user.message',
  toolCall: 'tool.call',
  toolResult: 'tool.result',
  assistantMessage: 'assistant.message',
} as const

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

