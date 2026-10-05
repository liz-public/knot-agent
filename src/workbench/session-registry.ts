import type { SessionMetadata, WorkbenchSession } from './session.js'

export interface SessionRegistry {
  list(): readonly WorkbenchSession[]
  get(id: string): WorkbenchSession | undefined
  add(session: WorkbenchSession): void
  updateMetadata(id: string, patch: Partial<Pick<SessionMetadata, 'title' | 'archived' | 'pinnedAt'>>): Promise<void>
  subscribe(listener: () => void): () => void
}

export function createSessionRegistry(initial: readonly WorkbenchSession[] = []): SessionRegistry {
  const sessions = new Map(initial.map(session => [session.id, session]))
  if (sessions.size !== initial.length) throw new Error('duplicate workbench session id')
  const listeners = new Set<() => void>()
  const changed = () => {
    for (const listener of listeners) {
      try { listener() } catch { /* One catalog observer cannot break an update. */ }
    }
  }
  return {
    list: () => [...sessions.values()],
    get: id => sessions.get(id),
    add(session) {
      if (sessions.has(session.id)) throw new Error(`duplicate workbench session id ${session.id}`)
      sessions.set(session.id, session)
      changed()
    },
    async updateMetadata(id, patch) {
      const session = sessions.get(id)
      if (!session?.updateMetadata) throw new Error('Session metadata cannot be changed')
      await session.updateMetadata(patch)
      changed()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
