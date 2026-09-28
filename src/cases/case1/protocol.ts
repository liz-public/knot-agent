export * from '../../agent/protocol.js'

import type { DynamicContext as AgentDynamicContext } from '../../agent/protocol.js'

export const CONTENT_REQUEST = 'content.request'

export interface DynamicContext extends AgentDynamicContext {
  readonly query: string
  readonly matchedPackages: readonly string[]
  readonly matchedCommands: readonly string[]
  readonly activeState: Readonly<Record<string, unknown>>
}

export interface ContentRequest {
  readonly turnId: string
  readonly query: string
}
