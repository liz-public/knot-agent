/** Translate the native DSH terminal wire contract to Knot's transient user PTYs. */
const inputOf = (payload: any) => Array.isArray(payload?.args) ? payload.args[0] : payload?.args ?? {}
const pathOf = (input: any, action: string) => `/api/workbench/sessions/${encodeURIComponent(input.agentId ?? input.sessionId)}/terminals/${action}`
const failure = (error: any) => Object.assign(new Error(error.message), {
  isDSHRemoteError: true, code: error.code, details: error.details ?? {},
})
async function responseValue(response: Response): Promise<any> {
  const value = await response.json()
  if (!response.ok) throw failure(value.error)
  return value
}
export async function callTerminal(fetcher: typeof fetch, action: string, payload: unknown, signal?: AbortSignal) {
  const input = inputOf(payload), read = ['list', 'environment', 'shells'].includes(action)
  const value = await responseValue(await fetcher(pathOf(input, action), {
    signal, method: read ? 'GET' : 'POST', ...(!read ? {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input.request ?? input),
    } : {}),
  }))
  return { ok: true as const, value: value === null ? undefined : value }
}
export async function* openTerminal(fetcher: typeof fetch, action: string, payload: unknown, signal: AbortSignal) {
  const input = inputOf(payload)
  const query = new URLSearchParams({ id: input.id, ...(input.attachmentId ? { attachmentId: input.attachmentId } : {}) })
  const response = await fetcher(`${pathOf(input, action)}?${query}`, { signal })
  if (action === 'retain') {
    yield await responseValue(response)
    if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    return
  }
  if (!response.ok) await responseValue(response)
  const reader = response.body!.getReader(), decoder = new TextDecoder()
  let pending = ''
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      pending += decoder.decode(value, { stream: true })
      let boundary: number
      while ((boundary = pending.indexOf('\n\n')) !== -1) {
        const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2)
        const data = frame.split('\n').find(line => line.startsWith('data: '))
        if (data) yield JSON.parse(data.slice(6))
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
