import { randomUUID } from 'node:crypto'
import type { HostApprovalPort, HostAskPort } from './assembly.js'
import type { InteractionRequestDto, LiveSessionEvent } from './session.js'

export interface InteractionBroker {
  readonly approval: HostApprovalPort
  readonly ask: HostAskPort
  pending(): readonly InteractionRequestDto[]
  respond(id: string, value: string, cancelled?: boolean): boolean
}

export function createInteractionBroker(
  emit: (event: LiveSessionEvent) => void,
): InteractionBroker {
  const pending = new Map<string, {
    readonly interaction: InteractionRequestDto
    readonly resolve: (value: string | undefined) => void
  }>()

  function wait(interaction: InteractionRequestDto): Promise<string | undefined> {
    return new Promise(resolve => pending.set(interaction.id, { interaction, resolve }))
  }

  return {
    approval: {
      async request(input) {
        const id = randomUUID()
        const interaction = { id, kind: 'approval' as const, ...input }
        const response = wait(interaction)
        emit({ kind: 'interaction.request', interaction })
        return await response === 'allow' ? 'allow' : 'deny'
      },
    },
    ask: {
      async ask(input) {
        const id = randomUUID()
        const interaction = { id, kind: 'ask' as const, ...input }
        const response = wait(interaction)
        emit({ kind: 'interaction.request', interaction })
        const answer = await response
        return answer === undefined ? { answer: '', cancelled: true } : { answer }
      },
    },
    pending: () => [...pending.values()].map(item => item.interaction),
    respond(id, value, cancelled = false) {
      const item = pending.get(id)
      if (item === undefined) return false
      pending.delete(id)
      emit({ kind: 'interaction.settled', id })
      item.resolve(cancelled ? undefined : value)
      return true
    },
  }
}
