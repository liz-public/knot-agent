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
          ctx.conversation.blocks.set(id, { reason: 'B1 · 只读历史 / Read-only history — 发送与配置尚未接线' })
        }
      }
      ctx.effect(() => ctx.sessions.list.subscribe(update))
      update()
    },
  }
}
