import type { LlmProviderSource } from '../agent/plugins/llm.js'
import type { SubagentFactory } from '../cases/case2/subagent-tool.js'
import type { WorkbenchAssemblyDefinition } from './assembly.js'
import { createEventHub } from './event-hub.js'
import { createInteractionBroker } from './interactions.js'
import { JOURNAL_CHANGE_METADATA, journalChangePlugin } from './journal-bridge.js'
import { workbenchLiveOutput } from './live-output.js'
import { JournalReadError, readJournalSnapshot } from './read-journal.js'
import { projectSessionConfiguration, type SessionConfiguration } from '../agent/session-configuration.js'
import type { LiveSessionEvent, SessionRunState, WorkbenchSession } from './session.js'
import { workbenchToolOutput } from './tool-output.js'
import type { ToolDefinition } from '../agent/plugins/tools.js'

export interface LiveSessionOptions {
  readonly id: string
  readonly title: string
  readonly projectId?: string
  readonly cwd: string
  readonly journalPath: string
  readonly assembly: WorkbenchAssemblyDefinition
  readonly llm: LlmProviderSource
  readonly defaultConfiguration?: SessionConfiguration
  readonly subagentFactory?: SubagentFactory
  readonly parentSessionId?: string
  readonly delegationDepth?: number
  readonly extraTools?: readonly ToolDefinition[]
}

export async function createLiveSession(
  options: LiveSessionOptions,
): Promise<WorkbenchSession> {
  const hub = createEventHub<LiveSessionEvent>()
  const interactions = createInteractionBroker(event => hub.emit(event))
  const agent = await options.assembly.create({
    cwd: options.cwd,
    journalPath: options.journalPath,
    llm: options.llm,
    liveOutput: workbenchLiveOutput(event => hub.emit(event)),
    toolOutput: workbenchToolOutput(event => hub.emit(event)),
    approvalPort: interactions.approval,
    askPort: interactions.ask,
    platformPlugins: [{
      plugin: journalChangePlugin(() => hub.emit({ kind: 'journal.changed' })),
      metadata: JOURNAL_CHANGE_METADATA,
    }],
    ...(options.extraTools === undefined ? {} : { extraTools: options.extraTools }),
    ...(options.subagentFactory === undefined ? {} : { subagentFactory: options.subagentFactory }),
  })

  let recorded: SessionConfiguration = {}
  try {
    recorded = projectSessionConfiguration((await readJournalSnapshot(options.journalPath, {
      maxBytes: Number.POSITIVE_INFINITY,
      maxEvents: Number.POSITIVE_INFINITY,
    })).events)
  } catch (error) {
    if (!(error instanceof JournalReadError) || error.code !== 'source_not_found') throw error
  }
  let pendingConfiguration: SessionConfiguration = {
    inference: recorded.inference ?? options.defaultConfiguration?.inference,
    approvalMode: recorded.approvalMode ?? options.defaultConfiguration?.approvalMode,
  }

  let runState: SessionRunState = 'idle'

  async function snapshot() {
    let journal
    try {
      journal = await readJournalSnapshot(options.journalPath)
    } catch (error) {
      if (!(error instanceof JournalReadError) || error.code !== 'source_not_found') throw error
      journal = { source: { name: options.journalPath, readOnly: true as const }, eventCount: 0, events: [] }
    }
    const updatedAt = journal.events.at(-1)?.observedAt
    const inference = pendingConfiguration.inference
    return {
      session: {
        id: options.id,
        title: options.title,
        ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
        assembly: options.assembly.description.id,
        workspace: options.cwd,
        ...(inference === undefined ? {} : { model: inference.model }),
        ...(inference === undefined ? {} : {
          providerProfileId: inference.providerProfileId,
          ...(inference.reasoningEffort === undefined ? {} : { reasoningEffort: inference.reasoningEffort }),
        }),
        ...(pendingConfiguration.approvalMode === undefined
          ? {}
          : { approvalMode: pendingConfiguration.approvalMode }),
        ...(options.parentSessionId === undefined ? {} : { parentSessionId: options.parentSessionId }),
        ...(options.delegationDepth === undefined ? {} : { delegationDepth: options.delegationDepth }),
        runState,
        eventCount: journal.eventCount,
        ...(updatedAt === undefined ? {} : { updatedAt }),
        writable: true,
      },
      events: journal.events,
    }
  }

  function setState(next: SessionRunState): void {
    runState = next
    hub.emit({ kind: 'state.changed', runState })
  }

  return {
    id: options.id,
    snapshot,
    summary: async () => (await snapshot()).session,
    subscribe(listener) {
      const unsubscribe = hub.subscribe(listener)
      for (const interaction of interactions.pending()) {
        listener({ kind: 'interaction.request', interaction })
      }
      return unsubscribe
    },
    submit(content) {
      if (runState === 'running' || runState === 'paused') {
        agent.steer(content)
        return
      }
      if (runState !== 'idle') throw new Error(`session is ${runState}`)
      setState('running')
      void agent.submit(content, pendingConfiguration).then(
        () => setState('idle'),
        error => {
          hub.emit({ kind: 'run.error', message: error instanceof Error ? error.message : String(error) })
          setState('idle')
        },
      )
    },
    pause() {
      if (runState !== 'running') return
      agent.pause()
      setState('paused')
    },
    resume() {
      if (runState !== 'paused') return
      agent.resume()
      setState('running')
    },
    respond: (interactionId, value) => interactions.respond(interactionId, value),
    configure: async configuration => {
      if (runState !== 'idle') throw new Error('session configuration can only change while idle')
      pendingConfiguration = {
        inference: configuration.inference ?? pendingConfiguration.inference,
        approvalMode: configuration.approvalMode ?? pendingConfiguration.approvalMode,
      }
    },
  }
}
