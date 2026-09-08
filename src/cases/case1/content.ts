import type { Event, Plugin } from '../../journal.js'
import {
  ASSISTANT_MESSAGE,
  CONTENT_REQUEST,
  LLM_REQUEST,
  TOOL_CALL,
  type ContentRequest,
} from './protocol.js'

// A content provider answers a turn by appending a tool call or a message, and
// declines by appending nothing. Providers must ask this before doing expensive
// work, because the kernel delivers content.request to every one of them in
// registration order regardless of what earlier providers already produced.
export function turnHasContent(events: readonly Event[], turnId: string): boolean {
  return events.some(event =>
    (event.type === TOOL_CALL || event.type === ASSISTANT_MESSAGE || event.type === LLM_REQUEST)
    && (event.data as { turnId?: string }).turnId === turnId,
  )
}

// Installed after every provider, so that registration order is the only
// priority and no plugin needs to know which providers exist.
export const contentArbiterPlugin = (): Plugin => journal =>
  journal.subscribe(CONTENT_REQUEST, event => {
    const request = event.data as ContentRequest
    if (turnHasContent(journal.read(), request.turnId)) return
    journal.append(LLM_REQUEST, { purpose: 'agent', turnId: request.turnId })
  })
