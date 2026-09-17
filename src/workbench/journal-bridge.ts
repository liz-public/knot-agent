import type { Plugin } from '../journal.js'

export const journalChangePlugin = (changed: () => void): Plugin => journal => {
  journal.subscribe('*', () => {
    try {
      changed()
    } catch {
      // Presentation invalidation cannot change Journal delivery.
    }
  })
}
