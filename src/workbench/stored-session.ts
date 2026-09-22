import { JournalReadError, readJournalSnapshot, type JournalReadLimits } from './read-journal.js'
import type { SessionSnapshotDto, WorkbenchSession } from './session.js'
import type { ApprovalMode, ReasoningEffort } from './session.js'

export interface StoredSessionConfig {
  readonly id: string
  readonly title: string
  readonly projectId?: string
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
    let journal
    try {
      journal = await readJournalSnapshot(config.journalPath, limits)
    } catch (error) {
      if (!(error instanceof JournalReadError) || error.code !== 'source_not_found') throw error
      journal = { eventCount: 0, events: [] }
    }
    const updatedAt = journal.events.at(-1)?.observedAt
    return {
      session: {
        id: config.id,
        title: config.title,
        projectId: config.projectId ?? config.assembly,
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
