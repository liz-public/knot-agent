export interface Event {
  readonly type: string
  readonly data: unknown
}

export type Handler = (event: Event) => void | Promise<void>

export interface Journal {
  append(type: string, data: unknown): Event
  read(): readonly Event[]
  subscribe(type: string, handler: Handler): void
}

export type Plugin = (journal: Journal) => void

export function createJournal(): {
  journal: Journal
  runUntilIdle: () => Promise<void>
} {
  const events: Event[] = []
  const subscriptions: { type: string; handler: Handler }[] = []
  let head = 0
  let running = false

  const journal: Journal = {
    append(type, data) {
      const event = Object.freeze({ type, data })
      events.push(event)
      return event
    },
    read: () => events,
    subscribe(type, handler) {
      subscriptions.push({ type, handler })
    },
  }

  async function runUntilIdle(): Promise<void> {
    if (running) throw new Error('journal is already draining')
    running = true
    try {
      while (head < events.length) {
        const event = events[head]!
        head += 1
        for (const { handler } of subscriptions.filter(
          s => s.type === '*' || s.type === event.type,
        )) {
          await handler(event)
        }
      }
    } finally {
      running = false
    }
  }

  return { journal, runUntilIdle }
}
