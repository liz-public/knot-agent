import type { LlmProviderSource } from '../agent/plugins/llm.js'
import type { SubagentFactory } from '../cases/case2/subagent-tool.js'
import type { WorkbenchAssemblyDefinition } from './assembly.js'
import { createEventHub } from './event-hub.js'
import { createInteractionBroker } from './interactions.js'
import { JOURNAL_CHANGE_METADATA, journalChangePlugin } from './journal-bridge.js'
import { workbenchLiveOutput } from './live-output.js'
import { readJournalSnapshot } from './read-journal.js'
import { projectSessionConfiguration, type SessionConfiguration } from '../agent/session-configuration.js'
import type { LiveSessionEvent, SessionRunState, WorkbenchSession } from './session.js'
import type { PendingInput } from './session.js'
import { randomUUID } from 'node:crypto'
import { workbenchToolOutput } from './tool-output.js'
import { sessionTitleView } from './session-title.js'

export interface LiveSessionOptions {
  readonly id: string
  readonly title?: string
  readonly projectId?: string
  readonly cwd: string
  readonly journalPath: string
  readonly assembly: WorkbenchAssemblyDefinition
  readonly llm: LlmProviderSource
  readonly defaultConfiguration?: SessionConfiguration
  readonly subagentFactory?: SubagentFactory
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
    llm: options.llm,
    liveOutput: workbenchLiveOutput(event => hub.emit(event)),
    toolOutput: workbenchToolOutput(event => hub.emit(event)),
    approvalPort: interactions.approval,
    askPort: interactions.ask,
    platformPlugins: [{
      plugin: journalChangePlugin(() => hub.emit({ kind: 'journal.changed' })),
      metadata: JOURNAL_CHANGE_METADATA,
    }],
    ...(options.subagentFactory === undefined ? {} : { subagentFactory: options.subagentFactory }),
  })

  const read = () => readJournalSnapshot(options.journalPath, { maxBytes: Infinity, maxEvents: Infinity }, 'empty')
  const initial = await read()
  if (options.title && initial.events.length === 0) await agent.rename?.(options.title)
  const recorded = projectSessionConfiguration(initial.events)
  let pendingConfiguration: SessionConfiguration = {
    inference: recorded.inference ?? options.defaultConfiguration?.inference,
    approvalMode: recorded.approvalMode ?? options.defaultConfiguration?.approvalMode,
  }

  let runState: SessionRunState = 'idle'
  const pendingInputs: PendingInput[] = []
  const queueEpoch = randomUUID()
  let queueRevision = 0
  const queueChanged = () => { queueRevision++; hub.emit({ kind: 'queue.changed',
    pendingInputs: [...pendingInputs], queueVersion: { epoch: queueEpoch, revision: queueRevision },
  }) }

  async function snapshot() {
    const journal = await read()
    const updatedAt = journal.events.at(-1)?.observedAt
    const inference = pendingConfiguration.inference
    return {
      session: {
        id: options.id,
        ...sessionTitleView(journal.events),
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
      ...(pendingInputs.length ? { pendingInputs: [...pendingInputs] } : {}),
      queueVersion: { epoch: queueEpoch, revision: queueRevision },
    }
  }

  function setState(next: SessionRunState): void {
    runState = next
    hub.emit({ kind: 'state.changed', runState })
  }

  function execute(input: PendingInput) {
    setState('running')
    void agent.submit(input.content, pendingConfiguration, input.attachments).then(() => {
      const next = pendingInputs.shift()
      if (next) { queueChanged(); execute(next) }
      else setState('idle')
    }, error => {
      hub.emit({ kind: 'run.error', message: error instanceof Error ? error.message : String(error) })
      // Do not automatically continue queued input through an uncertain failed history.
      setState('idle')
    })
  }

  return {
    id: options.id,
    ...(agent.close === undefined ? {} : { close: () => agent.close!() }),
    snapshot,
    summary: async () => (await snapshot()).session,
    subscribe(listener) {
      const unsubscribe = hub.subscribe(listener)
      listener({ kind: 'interaction.snapshot', interactions: interactions.pending() })
      for (const interaction of interactions.pending()) {
        listener({ kind: 'interaction.request', interaction })
      }
      return unsubscribe
    },
    submit(content, attachments, submission = {}) {
      if (runState === 'running' || runState === 'paused') {
        if (submission.mode === 'steer') {
          if (runState === 'paused') throw new Error('Resume before steering')
          agent.steer(content, attachments)
        } else {
          pendingInputs.push({ id: randomUUID(), content, attachments, requestId: submission.requestId })
          queueChanged()
        }
        return
      }
      if (runState !== 'idle') throw new Error(`session is ${runState}`)
      execute({ id: randomUUID(), content, attachments, requestId: submission.requestId })
    },
    updateQueued(id, action) {
      const index = pendingInputs.findIndex(item => item.id === id)
      if (index < 0) throw Object.assign(new Error('Queued message was not found'), { code: 'session/queue-item-not-found' })
      const input = pendingInputs[index]!
      if (action.kind === 'edit') {
        if (!action.content.trim() || input.attachments?.length) throw new Error('Only non-empty text-only queued messages can be edited')
        pendingInputs[index] = { ...input, content: action.content }
      } else {
        if (action.kind === 'steer') {
          if (runState !== 'running') throw Object.assign(new Error('No running turn to steer'), { code: 'session/steer-unavailable' })
          agent.steer(input.content, input.attachments)
        }
        pendingInputs.splice(index, 1)
      }
      queueChanged()
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
    ...(agent.rename === undefined ? {} : { rename: (title: string) => agent.rename!(title) }),
  }
}
