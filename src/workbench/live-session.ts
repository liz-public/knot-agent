import type { AgentAssemblyFactory } from './assembly.js'
import { createEventHub } from './event-hub.js'
import { createInteractionBroker } from './interactions.js'
import { JOURNAL_CHANGE_METADATA, journalChangePlugin } from './journal-bridge.js'
import { workbenchLiveOutput } from './live-output.js'
import { JournalReadError, readJournalSnapshot } from './read-journal.js'
import type { ApprovalMode, LiveSessionEvent, ReasoningEffort, SessionRunState, WorkbenchSession } from './session.js'
import { workbenchToolOutput } from './tool-output.js'

export interface LiveSessionOptions {
  readonly id: string
  readonly title: string
  readonly projectId?: string
  readonly cwd: string
  readonly journalPath: string
  readonly assembly: AgentAssemblyFactory
  readonly assemblyGenerationId?: string
  readonly providerProfileId?: string
  readonly reasoningEffort?: ReasoningEffort
  readonly approvalMode?: ApprovalMode
  readonly parentSessionId?: string
  readonly delegationDepth?: number
}

export async function createLiveSession(
  options: LiveSessionOptions,
): Promise<WorkbenchSession> {
  const hub = createEventHub<LiveSessionEvent>()
  const interactions = createInteractionBroker(event => hub.emit(event))
  const agent = await options.assembly.create({
    cwd: options.cwd,
    journalPath: options.journalPath,
    liveOutput: workbenchLiveOutput(event => hub.emit(event)),
    toolOutput: workbenchToolOutput(event => hub.emit(event)),
    approvalPort: interactions.approval,
    askPort: interactions.ask,
    platformPlugins: [{
      plugin: journalChangePlugin(() => hub.emit({ kind: 'journal.changed' })),
      metadata: JOURNAL_CHANGE_METADATA,
    }],
  })

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
    return {
      session: {
        id: options.id,
        title: options.title,
        ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
        assembly: options.assembly.id,
        ...(options.assemblyGenerationId === undefined
          ? {}
          : { assemblyGenerationId: options.assemblyGenerationId }),
        workspace: options.cwd,
        model: options.assembly.model,
        ...(options.providerProfileId === undefined
          ? {}
          : { providerProfileId: options.providerProfileId }),
        ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
        ...(options.approvalMode === undefined ? {} : { approvalMode: options.approvalMode }),
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
      void agent.submit(content).then(
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
  }
}
