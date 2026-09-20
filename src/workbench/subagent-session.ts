import type { WorkbenchSession } from './session.js'
import type { SessionRegistry } from './session-registry.js'

export async function runSubagentSession(
  session: WorkbenchSession,
  registry: SessionRegistry,
  task: string,
): Promise<{ summary: string; sessionId: string }> {
  if (session.subscribe === undefined || session.submit === undefined) {
    throw new Error(`Subagent session ${session.id} is not runnable`)
  }
  registry.add(session)
  await new Promise<void>((resolve, reject) => {
    let failure: Error | undefined
    const unsubscribe = session.subscribe!(event => {
      if (event.kind === 'run.error') failure = new Error(event.message)
      if (event.kind !== 'state.changed' || event.runState !== 'idle') return
      unsubscribe()
      if (failure === undefined) resolve()
      else reject(failure)
    })
    try {
      session.submit!(task)
    } catch (error) {
      unsubscribe()
      reject(error)
    }
  })
  const snapshot = await session.snapshot()
  const final = [...snapshot.events].reverse().find(event => event.type === 'assistant.message')
  const content = typeof final?.data === 'object' && final.data !== null
    ? (final.data as Record<string, unknown>)['content']
    : undefined
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error(`Subagent session ${session.id} completed without an assistant message`)
  }
  return { summary: content, sessionId: session.id }
}
