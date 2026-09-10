import type { Event, Plugin } from '../../journal.js'
import {
  HISTORY_CHECKPOINT,
  HISTORY_COMPACTION_REQUIRED,
  HISTORY_COMPRESS_REQUEST,
  LLM_INVOKE,
  LLM_REQUEST,
  type ContextManifest,
  type HistoryCheckpoint,
  type HistoryCompactionRequired,
  type LlmInvoke,
  type LlmRequest,
} from './protocol.js'

function pendingCompaction(events: readonly Event[]): HistoryCompactionRequired | undefined {
  const completed = new Set(events
    .filter(event => event.type === HISTORY_CHECKPOINT)
    .map(event => (event.data as HistoryCheckpoint).requirementId))
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== HISTORY_COMPACTION_REQUIRED) continue
    const requirement = event.data as HistoryCompactionRequired
    if (!completed.has(requirement.requirementId)) return requirement
  }
  return undefined
}

function latestCheckpoint(events: readonly Event[]): HistoryCheckpoint | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === HISTORY_CHECKPOINT) return event.data as HistoryCheckpoint
  }
  return undefined
}

// The single gate in front of every generation: it decides which window of the
// journal a request should see, and it is the only place that can divert a
// request into compression first.
export const contextAssemblerPlugin = (): Plugin => journal => {
  let requestNumber = 0
  const requestIds = new Set(journal.read()
    .filter(event => event.type === LLM_INVOKE)
    .map(event => (event.data as LlmInvoke).requestId))

  journal.subscribe(LLM_REQUEST, event => {
    const request = event.data as LlmRequest
    const events = journal.read()

    if (request.purpose === 'agent') {
      const pending = pendingCompaction(events)
      if (pending !== undefined) {
        journal.append(HISTORY_COMPRESS_REQUEST, {
          ...pending,
          turnId: request.turnId,
          resume: request,
        })
        return
      }
    }

    const checkpoint = latestCheckpoint(events)
    const after = checkpoint === undefined
      ? {}
      : { tailAfterRequestId: checkpoint.throughRequestId }
    const manifest: ContextManifest = request.purpose === 'history.compress'
      ? {
        kind: 'compress',
        instruction: request.instruction,
        tailThroughRequestId: request.throughRequestId,
        ...after,
      }
      : {
        kind: 'agent',
        dynamicTurnId: request.turnId,
        ...after,
        ...(checkpoint === undefined ? {} : { summaryOfRequirementId: checkpoint.requirementId }),
      }

    let requestId: string
    do {
      requestNumber += 1
      requestId = `${request.purpose}-${requestNumber}`
    } while (requestIds.has(requestId))
    requestIds.add(requestId)
    journal.append(LLM_INVOKE, {
      requestId,
      request,
      manifest,
    })
  })
}
