import type { Event, Plugin } from '../../journal.js'
import {
  ASSISTANT_MESSAGE,
  CONTENT_REQUEST,
  LLM_REQUEST,
  TOOL_CALL,
  type ContentRequest,
  type ToolCallRequest,
} from './protocol.js'

export type ContentOutput =
  | { kind: 'message'; content: string }
  | { kind: 'tools'; assistantContent?: string; calls: readonly ToolCallRequest[] }
  | { kind: 'llm' }

/** Produce an output on a hit, return undefined on a miss. That is the whole contract. */
export type ContentAnswer = (
  request: ContentRequest,
  events: readonly Event[],
) => ContentOutput | undefined | Promise<ContentOutput | undefined>

function turnHasContent(events: readonly Event[], turnId: string): boolean {
  return events.some(event =>
    (event.type === TOOL_CALL || event.type === ASSISTANT_MESSAGE || event.type === LLM_REQUEST)
    && (event.data as { turnId?: string }).turnId === turnId,
  )
}

// The kernel delivers content.request to every provider in registration order
// no matter what earlier ones produced, so "stop after the first hit" is not
// something the kernel does: it is this one line, asking the journal whether
// this turn already has an answer before doing any work. Because appends are
// visible immediately but delivered later, a provider sees what the previous
// one just produced. Keeping the guard here means no provider can forget it,
// and registration order is the only priority.
export const contentProviderPlugin = (answer: ContentAnswer): Plugin =>
  journal => journal.subscribe(CONTENT_REQUEST, async event => {
    const request = event.data as ContentRequest
    if (turnHasContent(journal.read(), request.turnId)) return
    const output = await answer(request, journal.read())
    if (output === undefined) return

    if (output.kind === 'message') {
      journal.append(ASSISTANT_MESSAGE, { turnId: request.turnId, content: output.content })
    } else if (output.kind === 'tools') {
      journal.append(TOOL_CALL, {
        turnId: request.turnId,
        ...(output.assistantContent === undefined
          ? {}
          : { assistantContent: output.assistantContent }),
        calls: output.calls,
      })
    } else {
      journal.append(LLM_REQUEST, { purpose: 'agent', turnId: request.turnId })
    }
  })

// The model is just the lowest-priority provider: it answers every turn the
// others declined. Install it last and no plugin needs to know who else exists.
export const llmProviderPlugin = (): Plugin =>
  contentProviderPlugin(() => ({ kind: 'llm' }))
