import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Serialized as a Client module by Vite; use only official Client services. */
export function readonlyClientFactory() {
  return {
    inject: ['conversation', 'sessions'],
    apply(ctx: Context) {
      const update = () => {
        for (const id of ctx.sessions.list.getSnapshot().ids) {
          const available = ctx.sessions.list.getSnapshot().byId[id]?.agentAvailable
          ctx.conversation.blocks.set(id, available === false ? { reason: '此 Session 只读 / Read-only Session' } : undefined)
        }
      }
      ctx.effect(() => ctx.sessions.list.subscribe(update))
      update()
    },
  }
}
