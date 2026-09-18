import { readJournalSnapshot, type JournalReadLimits } from './read-journal.js'
import type { SessionSnapshotDto, WorkbenchSession } from './session.js'

export interface StoredSessionConfig {
  readonly id: string
  readonly title: string
  readonly assembly: string
  readonly journalPath: string
  readonly workspace?: string
  readonly model?: string
  readonly providerProfileId?: string
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
        ...(config.workspace === undefined ? {} : { workspace: config.workspace }),
        ...(config.model === undefined ? {} : { model: config.model }),
        ...(config.providerProfileId === undefined
          ? {}
          : { providerProfileId: config.providerProfileId }),
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
