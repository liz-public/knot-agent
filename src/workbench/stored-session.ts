import { JournalReadError, readJournalSnapshot, type JournalReadLimits } from './read-journal.js'
import { projectSessionConfiguration } from '../agent/session-configuration.js'
import type { SessionSnapshotDto, WorkbenchSession } from './session.js'

export interface StoredSessionConfig {
  readonly id: string
  readonly title: string
  readonly projectId?: string
  readonly assembly: string
  readonly journalPath: string
  readonly workspace?: string
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
    const configuration = projectSessionConfiguration(journal.events)
    const inference = configuration.inference
    return {
      session: {
        id: config.id,
        title: config.title,
        projectId: config.projectId ?? config.assembly,
        assembly: config.assembly,
        ...(config.workspace === undefined ? {} : { workspace: config.workspace }),
        ...(inference === undefined ? {} : {
          model: inference.model,
          providerProfileId: inference.providerProfileId,
          ...(inference.reasoningEffort === undefined ? {} : { reasoningEffort: inference.reasoningEffort }),
        }),
        ...(configuration.approvalMode === undefined ? {} : { approvalMode: configuration.approvalMode }),
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
