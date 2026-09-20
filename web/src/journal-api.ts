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
  readonly assemblyGenerationId?: string
  readonly workspace?: string
  readonly model?: string
  readonly providerProfileId?: string
  readonly reasoningEffort?: ReasoningEffort
  readonly approvalMode?: ApprovalMode
  readonly parentSessionId?: string
  readonly delegationDepth?: number
  readonly runState: 'completed' | 'idle' | 'running' | 'paused' | 'failed'
  readonly eventCount: number
  readonly updatedAt?: string
  readonly writable: boolean
}

export type ReasoningEffort = 'none' | 'low' | 'high' | 'max'
export type ApprovalMode = 'ask' | 'auto'

export interface ProviderProfileSummary {
  readonly id: string
  readonly label: string
  readonly adapter: 'openai-compatible' | 'deepseek'
  readonly model: string
  readonly configured: boolean
  readonly editable?: boolean
  readonly reasoningEfforts?: readonly ReasoningEffort[]
  readonly defaultReasoningEffort?: ReasoningEffort
}

export interface ProviderProfileDraft {
  readonly label: string
  readonly adapter: ProviderProfileSummary['adapter']
  readonly baseUrl?: string
  readonly apiKey?: string
  readonly model: string
  readonly contextWindow?: number
  readonly defaultReasoningEffort?: ReasoningEffort
}

export interface JournalSnapshot {
  readonly session: SessionSummary
  readonly events: readonly ReadEvent[]
}

export interface StudioPlugin {
  readonly id: string
  readonly name: string
  readonly category: 'platform' | 'context' | 'flow' | 'content' | 'effect' | 'presentation'
  readonly responsibility: string
  readonly listens: readonly string[]
  readonly emits: readonly string[]
  readonly source: string
}

export interface StudioAssembly {
  readonly id: string
  readonly title: string
  readonly systemPrompt: string
  readonly plugins: readonly StudioPlugin[]
  readonly tools: ReadonlyArray<{ readonly name: string; readonly description: string }>
  readonly protocols: readonly string[]
  readonly fingerprint: string
}

export interface StudioCase {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly assemblyId: string
  readonly workspace: string
  readonly prompt: string
  readonly assertions: readonly string[]
  readonly createdAt: string
  readonly runCount: number
}

export interface StudioValidation {
  readonly id: string
  readonly caseId: string
  readonly assemblyFingerprint: string
  readonly createdAt: string
  readonly passed: boolean
  readonly checks: ReadonlyArray<{ readonly id: string; readonly label: string; readonly passed: boolean; readonly detail: string }>
}

export interface StudioGeneration {
  readonly id: string
  readonly assemblyId: string
  readonly assemblyFingerprint: string
  readonly validationId: string
  readonly createdAt: string
  readonly active: boolean
}

export interface StudioRun {
  readonly id: string
  readonly caseId: string
  readonly mode: 'mock' | 'real'
  readonly sessionId: string
  readonly generationId: string
  readonly providerProfileId?: string
  readonly reasoningEffort?: ReasoningEffort
  readonly createdAt: string
  readonly status: 'running' | 'passed' | 'failed'
  readonly assertions: ReadonlyArray<{ readonly eventType: string; readonly passed: boolean }>
  readonly metrics: {
    readonly eventCount: number
    readonly modelCalls: number
    readonly toolCalls: number
    readonly inputTokens: number
    readonly outputTokens: number
    readonly durationMs?: number
  }
}

export interface StudioSnapshot {
  readonly assemblies: readonly StudioAssembly[]
  readonly assembly: StudioAssembly
  readonly cases: readonly StudioCase[]
  readonly validations: readonly StudioValidation[]
  readonly generations: readonly StudioGeneration[]
  readonly runs: readonly StudioRun[]
  readonly activeGenerationId: string
  readonly activeGenerationIds: Readonly<Record<string, string>>
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
  | { readonly kind: 'tool.open'; readonly turnId: string; readonly callId: string; readonly toolName: string; readonly command: string; readonly emittedAt: string }
  | { readonly kind: 'tool.update'; readonly callId: string; readonly update: { readonly stream: 'stdout' | 'stderr'; readonly text: string }; readonly emittedAt: string }
  | { readonly kind: 'tool.close'; readonly callId: string; readonly exitCode: number; readonly emittedAt: string }
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

export async function listProviderProfiles(
  signal?: AbortSignal,
): Promise<readonly ProviderProfileSummary[]> {
  const response = await fetch('/api/workbench/providers', { signal })
  return (await readJson<{ providers: readonly ProviderProfileSummary[] }>(response)).providers
}

export async function createProviderProfile(
  input: ProviderProfileDraft,
): Promise<ProviderProfileSummary> {
  return (await post<{ provider: ProviderProfileSummary }>('/api/workbench/providers', input)).provider
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

export async function createSession(input: {
  title?: string
  cwd?: string
  providerProfileId?: string
  reasoningEffort?: ReasoningEffort
  approvalMode?: ApprovalMode
  assemblyId?: string
  assemblyGenerationId?: string
} = {}): Promise<SessionSummary> {
  return (await post<{ session: SessionSummary }>('/api/workbench/sessions', input)).session
}

export async function loadStudio(signal?: AbortSignal): Promise<StudioSnapshot> {
  return await readJson<StudioSnapshot>(await fetch('/api/workbench/studio', { signal }))
}

export async function createStudioCase(input: {
  title: string
  assemblyId?: string
  workspace?: string
  prompt?: string
}): Promise<StudioCase> {
  return (await post<{ case: StudioCase }>('/api/workbench/studio/cases', input)).case
}

export async function checkStudioAssembly(caseId: string): Promise<StudioValidation> {
  return (await post<{ validation: StudioValidation }>('/api/workbench/studio/check', { caseId })).validation
}

export async function publishStudioGeneration(caseId: string): Promise<StudioGeneration> {
  return (await post<{ generation: StudioGeneration }>('/api/workbench/studio/publish', { caseId })).generation
}

export async function runStudioCase(input: {
  caseId: string
  mode: 'mock' | 'real'
  providerProfileId?: string
  reasoningEffort?: ReasoningEffort
}): Promise<StudioRun> {
  return (await post<{ run: StudioRun }>('/api/workbench/studio/runs', input)).run
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

export function subscribeSessionCatalog(listener: () => void): () => void {
  const source = new EventSource('/api/workbench/sessions/stream')
  source.addEventListener('catalog', listener)
  return () => source.close()
}
