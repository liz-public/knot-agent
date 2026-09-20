import type { WorkbenchSession } from './session.js'

export interface SessionRegistry {
  list(): readonly WorkbenchSession[]
  get(id: string): WorkbenchSession | undefined
  add(session: WorkbenchSession): void
  subscribe(listener: () => void): () => void
}

export function createSessionRegistry(initial: readonly WorkbenchSession[] = []): SessionRegistry {
  const sessions = new Map(initial.map(session => [session.id, session]))
  if (sessions.size !== initial.length) throw new Error('duplicate workbench session id')
  const listeners = new Set<() => void>()
  return {
    list: () => [...sessions.values()],
    get: id => sessions.get(id),
    add(session) {
      if (sessions.has(session.id)) throw new Error(`duplicate workbench session id ${session.id}`)
      sessions.set(session.id, session)
      for (const listener of listeners) {
        try { listener() } catch { /* One catalog observer cannot break registration. */ }
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
