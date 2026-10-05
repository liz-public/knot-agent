import { SESSION_TITLE_CONFIGURED, type SessionTitleConfigured } from '../agent/session-title.js'
import type { ReadEvent } from './read-journal.js'

/** Display revision is derived from storage observation metadata, never persisted separately. */
export function sessionTitleView(events: readonly ReadEvent[]): { title: string; titleVersion?: number } {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!
    if (event.type === SESSION_TITLE_CONFIGURED) return {
      title: (event.data as SessionTitleConfigured).title,
      titleVersion: Date.parse(event.observedAt ?? '') || event.position + 1,
    }
  }
  return { title: 'New session' }
}
