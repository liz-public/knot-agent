export interface Event<T = unknown> {
  readonly seq: number
  readonly type: string
  readonly data: T
}

export interface PluginContext {
  append(type: string, data: unknown): Event
  read(): readonly Event[]
}

export interface Plugin {
  readonly name: string
  readonly subscriptions: readonly string[]
  handle(event: Event, context: PluginContext): Promise<void> | void
}

export type Trace = (line: string) => void

function cloneData(data: unknown): unknown {
  const json = JSON.stringify(data)
  if (json === undefined) throw new TypeError('event data must be JSON-serializable')
  return deepFreeze(JSON.parse(json) as unknown)
}

function deepFreeze(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

export class Journal {
  readonly #events: Event[] = []

  get length(): number {
    return this.#events.length
  }

  append(type: string, data: unknown): Event {
    if (type.length === 0) throw new TypeError('event type must not be empty')
    const event = Object.freeze({
      seq: this.#events.length,
      type,
      data: cloneData(data),
    })
    this.#events.push(event)
    return event
  }

  at(seq: number): Event {
    const event = this.#events[seq]
    if (event === undefined) throw new RangeError(`no event at seq ${seq}`)
    return event
  }

  read(): readonly Event[] {
    return Object.freeze([...this.#events])
  }
}

export class Runtime {
  readonly journal: Journal
  readonly #plugins: readonly Plugin[]
  readonly #trace?: Trace
  #cursor = 0
  #running = false
  #failure?: Error

  constructor(plugins: readonly Plugin[], options?: { journal?: Journal; trace?: Trace }) {
    const names = new Set<string>()
    for (const plugin of plugins) {
      if (names.has(plugin.name)) throw new Error(`duplicate plugin name: ${plugin.name}`)
      names.add(plugin.name)
    }
    this.#plugins = [...plugins]
    this.journal = options?.journal ?? new Journal()
    this.#trace = options?.trace
  }

  ingress(type: string, data: unknown): Event {
    if (this.#failure !== undefined) throw this.#failure
    return this.#append(type, data)
  }

  async runUntilIdle(): Promise<number> {
    if (this.#failure !== undefined) throw this.#failure
    if (this.#running) throw new Error('runtime is already running')
    this.#running = true
    let deliveries = 0

    try {
      while (this.#cursor < this.journal.length) {
        const event = this.journal.at(this.#cursor)
        const subscribers = this.#plugins.filter(plugin =>
          plugin.subscriptions.includes(event.type),
        )
        if (subscribers.length === 0) {
          throw new Error(`unhandled event #${event.seq} ${event.type}`)
        }

        for (const plugin of subscribers) {
          const started = performance.now()
          this.#trace?.(`> #${event.seq} ${event.type} -> ${plugin.name}`)
          const context: PluginContext = {
            append: (type, data) => this.#append(type, data),
            read: () => this.journal.read(),
          }
          try {
            await plugin.handle(event, context)
          } catch (cause) {
            throw new Error(
              `plugin ${plugin.name} failed on #${event.seq} ${event.type}`,
              { cause },
            )
          }
          const elapsed = (performance.now() - started).toFixed(1)
          this.#trace?.(`< #${event.seq} ${event.type} <- ${plugin.name} ${elapsed}ms`)
          deliveries += 1
        }
        this.#cursor += 1
      }
      this.#trace?.('= idle')
      return deliveries
    } catch (cause) {
      this.#failure = cause instanceof Error ? cause : new Error(String(cause))
      this.#trace?.(`! stopped: ${this.#failure.message}`)
      throw this.#failure
    } finally {
      this.#running = false
    }
  }

  #append(type: string, data: unknown): Event {
    const event = this.journal.append(type, data)
    this.#trace?.(`+ #${event.seq} ${event.type}`)
    return event
  }
}

