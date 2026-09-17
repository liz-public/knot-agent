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
  readonly runState: 'completed' | 'idle' | 'running' | 'paused'
  readonly eventCount: number
  readonly updatedAt?: string
}

export interface JournalSnapshot {
  readonly session: SessionSummary
  readonly events: readonly ReadEvent[]
}

interface ErrorResponse {
  readonly error?: { readonly message?: string }
}

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
