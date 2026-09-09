import type { Event, Journal, Plugin } from '../../journal.js'
import {
  ASSISTANT_MESSAGE,
  CONTENT_REQUEST,
  LLM_REQUEST,
  TOOL_CALL,
  type ContentRequest,
  type ToolCallRequest,
} from './protocol.js'

export type ContentDecision =
  | { kind: 'message'; content: string }
  | { kind: 'tools'; assistantContent?: string; calls: readonly ToolCallRequest[] }
  | { kind: 'llm' }

/** A source knows only how to answer or decline; it is not a Journal plugin. */
export type ContentSource = (
  request: ContentRequest,
  events: readonly Event[],
) => ContentDecision | undefined | Promise<ContentDecision | undefined>

function appendDecision(journal: Journal, request: ContentRequest, decision: ContentDecision): void {
  if (decision.kind === 'message') {
    journal.append(ASSISTANT_MESSAGE, { turnId: request.turnId, content: decision.content })
  } else if (decision.kind === 'tools') {
    journal.append(TOOL_CALL, {
      turnId: request.turnId,
      ...(decision.assistantContent === undefined
        ? {}
        : { assistantContent: decision.assistantContent }),
      calls: decision.calls,
    })
  } else {
    journal.append(LLM_REQUEST, { purpose: 'agent', turnId: request.turnId })
  }
}

// Ordered first-match is one domain operation, so one plugin owns it. Sources
// are plain strategies: the first decision wins and later sources never run.
export const contentPlugin = (sources: readonly ContentSource[]): Plugin =>
  journal => journal.subscribe(CONTENT_REQUEST, async event => {
    const request = event.data as ContentRequest
    for (const source of sources) {
      const decision = await source(request, journal.read())
      if (decision === undefined) continue
      appendDecision(journal, request, decision)
      return
    }
    throw new Error(`no content source answered turn ${request.turnId}`)
  })

export const llmContentSource: ContentSource = () => ({ kind: 'llm' })
