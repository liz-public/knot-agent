import type { AgentAssemblyFactory } from './assembly.js'
import { createEventHub } from './event-hub.js'
import { createInteractionBroker } from './interactions.js'
import { journalChangePlugin } from './journal-bridge.js'
import { workbenchLiveOutput } from './live-output.js'
import { JournalReadError, readJournalSnapshot } from './read-journal.js'
import type { LiveSessionEvent, SessionRunState, WorkbenchSession } from './session.js'
import { workbenchToolOutput } from './tool-output.js'

export interface LiveSessionOptions {
  readonly id: string
  readonly title: string
  readonly cwd: string
  readonly journalPath: string
  readonly assembly: AgentAssemblyFactory
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
    platformPlugins: [journalChangePlugin(() => hub.emit({ kind: 'journal.changed' }))],
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
        assembly: options.assembly.id,
        workspace: options.cwd,
        model: options.assembly.model,
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
    subscribe: listener => hub.subscribe(listener),
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
