import type { Event, Plugin } from '../core.js'
import { events, type AssistantMessage } from '../protocol.js'

export class OutputPlugin implements Plugin {
  readonly name = 'output'
  readonly subscriptions = [events.assistantMessage]

  constructor(readonly write: (content: string) => void = console.log) {}

  handle(event: Event): void {
    this.write((event.data as AssistantMessage).content)
  }
}

