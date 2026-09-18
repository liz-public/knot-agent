import { randomUUID } from 'node:crypto'
import type { ApprovalPort, AskPort } from '../cases/case2/tool-interaction.js'
import type { LiveSessionEvent } from './session.js'

export interface InteractionBroker {
  readonly approval: ApprovalPort
  readonly ask: AskPort
  respond(id: string, value: string): boolean
}

export function createInteractionBroker(
  emit: (event: LiveSessionEvent) => void,
): InteractionBroker {
  const pending = new Map<string, (value: string) => void>()

  function wait(id: string): Promise<string> {
    return new Promise(resolve => pending.set(id, resolve))
  }

  return {
    approval: {
      async request(input) {
        const id = randomUUID()
        const response = wait(id)
        emit({ kind: 'interaction.request', interaction: { id, kind: 'approval', ...input } })
        return await response === 'allow' ? 'allow' : 'deny'
      },
    },
    ask: {
      async ask(input) {
        const id = randomUUID()
        const response = wait(id)
        emit({ kind: 'interaction.request', interaction: { id, kind: 'ask', ...input } })
        return { answer: await response }
      },
    },
    respond(id, value) {
      const resolve = pending.get(id)
      if (resolve === undefined) return false
      pending.delete(id)
      resolve(value)
      return true
    },
  }
}
