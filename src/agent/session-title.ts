import type { Event } from '../journal.js'

export const TITLE_REQUEST = 'title.request'
export const TITLE_FAILED = 'title.failed'
export const SESSION_TITLE_CONFIGURED = 'session.title.configured'

export interface TitleRequest {
  readonly turnId: string
}

export interface SessionTitleConfigured {
  readonly title: string
  readonly source: 'generated' | 'user'
}

export function projectSessionTitle(events: readonly Event[]): SessionTitleConfigured | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    if (events[index]!.type === SESSION_TITLE_CONFIGURED) return events[index]!.data as SessionTitleConfigured
  }
  return undefined
}
