import { readJournalSnapshot, type JournalReadLimits } from './read-journal.js'
import { projectSessionConfiguration } from '../agent/session-configuration.js'
import type { SessionSnapshotDto, WorkbenchSession } from './session.js'
import { createJournal } from '../journal.js'
import { jsonlStorePlugin } from '../plugins/jsonl.js'
import { SESSION_TITLE_CONFIGURED } from '../agent/session-title.js'
import { sessionTitleView } from './session-title.js'

export interface StoredSessionConfig {
  readonly id: string
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
    const journal = await readJournalSnapshot(config.journalPath, { maxBytes: Infinity, maxEvents: Infinity, ...limits })
    const updatedAt = journal.events.at(-1)?.observedAt
    const configuration = projectSessionConfiguration(journal.events)
    const inference = configuration.inference
    return {
      session: {
        id: config.id,
        ...sessionTitleView(journal.events),
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
    async rename(title) {
      // Read-only execution still permits product control facts; no agent plugins are installed.
      const runtime = createJournal()
      jsonlStorePlugin(config.journalPath)(runtime.journal)
      runtime.journal.append(SESSION_TITLE_CONFIGURED, { title, source: 'user' })
      await runtime.runUntilIdle()
    },
  }
}
