import type { ReadEvent } from './read-journal.js'
import type {
  ApprovalMode,
  ReasoningEffort,
} from '../agent/protocol.js'
import type { SessionConfiguration } from '../agent/session-configuration.js'

export type SessionRunState = 'completed' | 'idle' | 'running' | 'paused' | 'failed'
export type { ApprovalMode, ReasoningEffort }

export interface SessionSummaryDto {
  readonly id: string
  readonly title: string
  readonly projectId?: string
  readonly assembly: string
  readonly workspace?: string
  readonly model?: string
  readonly providerProfileId?: string
  readonly reasoningEffort?: ReasoningEffort
  readonly approvalMode?: ApprovalMode
  readonly parentSessionId?: string
  readonly delegationDepth?: number
  readonly runState: SessionRunState
  readonly eventCount: number
  readonly updatedAt?: string
  readonly writable: boolean
}

export interface SessionSnapshotDto {
  readonly session: SessionSummaryDto
  readonly events: readonly ReadEvent[]
  /** HTTP delta response only: events strictly after this position; -1 resets. */
  readonly after?: number
}

export type LiveSessionEvent =
  | { readonly kind: 'journal.changed' }
  | { readonly kind: 'state.changed'; readonly runState: SessionRunState }
  | {
    readonly kind: 'generation.open'
    readonly requestId: string
    readonly turnId: string
    readonly purpose: string
  }
  | {
    readonly kind: 'generation.update'
    readonly requestId: string
    readonly update: unknown
  }
  | { readonly kind: 'generation.close'; readonly requestId: string }
  | {
    readonly kind: 'tool.open'
    readonly turnId: string
    readonly callId: string
    readonly toolName: string
    readonly command: string
  }
  | {
    readonly kind: 'tool.update'
    readonly callId: string
    readonly update: { readonly stream: 'stdout' | 'stderr'; readonly text: string }
  }
  | { readonly kind: 'tool.close'; readonly callId: string; readonly exitCode: number }
  | {
    readonly kind: 'interaction.request'
    readonly interaction: InteractionRequestDto
  }
  | { readonly kind: 'interaction.settled'; readonly id: string }
  | { readonly kind: 'interaction.snapshot'; readonly interactions: readonly InteractionRequestDto[] }
  | { readonly kind: 'run.error'; readonly message: string }

export type InteractionRequestDto =
  | {
    readonly id: string
    readonly kind: 'approval'
    readonly toolName: string
    readonly arguments: Readonly<Record<string, unknown>>
  }
  | {
    readonly id: string
    readonly kind: 'ask'
    readonly question: string
    readonly choices?: readonly string[]
  }

export interface WorkbenchSession {
  readonly id: string
  summary(): Promise<SessionSummaryDto>
  snapshot(): Promise<SessionSnapshotDto>
  subscribe?(listener: (event: LiveSessionEvent) => void): () => void
  submit?(content: string): void
  pause?(): void
  resume?(): void
  respond?(interactionId: string, value: string): boolean
  configure?(configuration: SessionConfiguration): Promise<void>
}
