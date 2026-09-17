export interface EventHub<T> {
  emit(event: T): void
  subscribe(listener: (event: T) => void): () => void
}

export function createEventHub<T>(): EventHub<T> {
  const listeners = new Set<(event: T) => void>()
  return {
    emit(event) {
      for (const listener of listeners) {
        try {
          listener(event)
        } catch {
          // One presentation listener cannot disconnect the others.
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
