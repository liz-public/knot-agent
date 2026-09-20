import type { PluginMetadata } from '../assembly-definition.js'
import type { Plugin } from '../journal.js'

export const JOURNAL_CHANGE_METADATA: PluginMetadata = {
  id: 'workbench-journal-change',
  name: 'WorkbenchJournalChange',
  category: 'platform',
  responsibility: 'Notify the Host that an authoritative Journal snapshot changed.',
  listens: ['*'],
  emits: [],
  source: 'src/workbench/journal-bridge.ts',
}

export const journalChangePlugin = (changed: () => void): Plugin => journal => {
  journal.subscribe('*', () => {
    try {
      changed()
    } catch {
      // Presentation invalidation cannot change Journal delivery.
    }
  })
}
