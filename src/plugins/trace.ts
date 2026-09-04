import type { Event, Plugin } from '../journal.js'

export const tracePlugin = (sink: (event: Event) => void): Plugin =>
  journal => journal.subscribe('*', sink)
