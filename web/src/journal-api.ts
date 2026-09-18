export interface ReadEvent {
  readonly position: number
  readonly type: string
  readonly data: unknown
  readonly observedAt?: string
  readonly elapsedMs?: number
}

export interface SessionSummary {
  readonly id: string
  readonly title: string
  readonly assembly: string
  readonly workspace?: string
  readonly model?: string
  readonly runState: 'completed' | 'idle' | 'running' | 'paused'
  readonly eventCount: number
  readonly updatedAt?: string
  readonly writable: boolean
}

export interface JournalSnapshot {
  readonly session: SessionSummary
  readonly events: readonly ReadEvent[]
}

interface ErrorResponse {
  readonly error?: { readonly message?: string }
}

export type InteractionRequest =
  | { readonly id: string; readonly kind: 'approval'; readonly toolName: string; readonly arguments: Record<string, unknown> }
  | { readonly id: string; readonly kind: 'ask'; readonly question: string; readonly choices?: readonly string[] }

export type SessionStreamEvent =
  | { readonly kind: 'journal.changed'; readonly emittedAt: string }
  | { readonly kind: 'state.changed'; readonly runState: SessionSummary['runState']; readonly emittedAt: string }
  | { readonly kind: 'generation.open'; readonly requestId: string; readonly turnId: string; readonly purpose: string; readonly emittedAt: string }
  | { readonly kind: 'generation.update'; readonly requestId: string; readonly update: GenerationUpdate; readonly emittedAt: string }
  | { readonly kind: 'generation.close'; readonly requestId: string; readonly emittedAt: string }
  | { readonly kind: 'interaction.request'; readonly interaction: InteractionRequest; readonly emittedAt: string }
  | { readonly kind: 'run.error'; readonly message: string; readonly emittedAt: string }

export type GenerationUpdate =
  | { readonly kind: 'content'; readonly text: string }
  | { readonly kind: 'reasoning'; readonly text: string }
  | { readonly kind: 'tool_call'; readonly index: number; readonly id?: string; readonly name?: string; readonly argumentsDelta?: string }

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Workbench request failed (${response.status})`
    try {
      const body = await response.json() as ErrorResponse
      if (body.error?.message !== undefined) message = body.error.message
    } catch {
      // Keep the HTTP fallback when the host did not return its JSON error shape.
    }
    throw new Error(message)
  }
  return await response.json() as T
}

export async function listSessions(signal?: AbortSignal): Promise<readonly SessionSummary[]> {
  const response = await fetch('/api/workbench/sessions', { signal })
  return (await readJson<{ sessions: readonly SessionSummary[] }>(response)).sessions
}

export async function loadJournalSnapshot(
  sessionId: string,
  signal?: AbortSignal,
): Promise<JournalSnapshot> {
  const response = await fetch(`/api/workbench/sessions/${encodeURIComponent(sessionId)}`, { signal })
  return await readJson<JournalSnapshot>(response)
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return await readJson<T>(response)
}

export async function createSession(input: { title?: string; cwd?: string } = {}): Promise<SessionSummary> {
  return (await post<{ session: SessionSummary }>('/api/workbench/sessions', input)).session
}

export async function submitMessage(sessionId: string, content: string): Promise<void> {
  await post(`/api/workbench/sessions/${encodeURIComponent(sessionId)}/messages`, { content })
}

export async function pauseSession(sessionId: string): Promise<void> {
  await post(`/api/workbench/sessions/${encodeURIComponent(sessionId)}/pause`)
}

export async function resumeSession(sessionId: string): Promise<void> {
  await post(`/api/workbench/sessions/${encodeURIComponent(sessionId)}/resume`)
}

export async function respondToInteraction(sessionId: string, id: string, value: string): Promise<void> {
  await post(`/api/workbench/sessions/${encodeURIComponent(sessionId)}/interactions`, { id, value })
}

export function subscribeSession(
  sessionId: string,
  listener: (event: SessionStreamEvent) => void,
  onError: () => void,
): () => void {
  const source = new EventSource(`/api/workbench/sessions/${encodeURIComponent(sessionId)}/stream`)
  source.addEventListener('session', raw => {
    listener(JSON.parse((raw as MessageEvent<string>).data) as SessionStreamEvent)
  })
  source.onerror = onError
  return () => source.close()
}
