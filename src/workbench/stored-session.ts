import { readJournalSnapshot, type JournalReadLimits } from './read-journal.js'
import type { SessionSnapshotDto, WorkbenchSession } from './session.js'
import type { ApprovalMode, ReasoningEffort } from './session.js'

export interface StoredSessionConfig {
  readonly id: string
  readonly title: string
  readonly assembly: string
  readonly assemblyGenerationId?: string
  readonly journalPath: string
  readonly workspace?: string
  readonly model?: string
  readonly providerProfileId?: string
  readonly reasoningEffort?: ReasoningEffort
  readonly approvalMode?: ApprovalMode
  readonly parentSessionId?: string
  readonly delegationDepth?: number
}

export function storedSession(
  config: StoredSessionConfig,
  limits: JournalReadLimits = {},
): WorkbenchSession {
  async function snapshot(): Promise<SessionSnapshotDto> {
    const journal = await readJournalSnapshot(config.journalPath, limits)
    const updatedAt = journal.events.at(-1)?.observedAt
    return {
      session: {
        id: config.id,
        title: config.title,
        assembly: config.assembly,
        ...(config.assemblyGenerationId === undefined
          ? {}
          : { assemblyGenerationId: config.assemblyGenerationId }),
        ...(config.workspace === undefined ? {} : { workspace: config.workspace }),
        ...(config.model === undefined ? {} : { model: config.model }),
        ...(config.providerProfileId === undefined
          ? {}
          : { providerProfileId: config.providerProfileId }),
        ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort }),
        ...(config.approvalMode === undefined ? {} : { approvalMode: config.approvalMode }),
        ...(config.parentSessionId === undefined ? {} : { parentSessionId: config.parentSessionId }),
        ...(config.delegationDepth === undefined ? {} : { delegationDepth: config.delegationDepth }),
        runState: 'completed',
        eventCount: journal.eventCount,
        ...(updatedAt === undefined ? {} : { updatedAt }),
        writable: false,
      },
      events: journal.events,
    }
  }

  return {
    id: config.id,
    snapshot,
    summary: async () => (await snapshot()).session,
  }
}
