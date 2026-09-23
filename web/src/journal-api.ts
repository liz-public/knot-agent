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
  readonly projectId?: string
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
  readonly baseUrl?: string
  readonly contextWindow?: number
  readonly hasApiKey?: boolean
  readonly isDefault?: boolean
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

export interface ContextMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content: string | null
  readonly reasoning?: string
  readonly tool_call_id?: string
  readonly tool_calls?: ReadonlyArray<{
    readonly id: string
    readonly type: 'function'
    readonly function: { readonly name: string; readonly arguments: string }
  }>
  readonly estimatedTokens: number
}

export interface ContextProjection {
  readonly requestId: string
  readonly purpose: string
  readonly manifest: Record<string, unknown>
  readonly messages: readonly ContextMessage[]
  readonly tools: readonly Record<string, unknown>[]
  readonly estimatedMessageTokens: number
  readonly estimatedToolTokens: number
  readonly usage?: {
    readonly inputTokens?: number
    readonly outputTokens?: number
    readonly totalTokens?: number
    readonly contextWindow: number
  }
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

export interface StudioProject {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly projectRoot: string
  readonly assembly: StudioAssembly
  readonly activeGenerationId: string
}

export interface StudioCase {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly projectId: string
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
  readonly projectId: string
  readonly assemblyFingerprint: string
  readonly validationId: string
  readonly createdAt: string
  readonly active: boolean
  readonly restorable: boolean
}

export interface StudioRun {
  readonly id: string
  readonly caseId: string
  readonly projectId: string
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
  readonly projects: readonly StudioProject[]
  readonly cases: readonly StudioCase[]
  readonly validations: readonly StudioValidation[]
  readonly generations: readonly StudioGeneration[]
  readonly runs: readonly StudioRun[]
}

export interface StudioFlowStep {
  readonly position: number
  readonly type: string
  readonly observedAt?: string
  readonly elapsedMs?: number
  readonly producers: readonly string[]
  readonly consumers: readonly string[]
  readonly payloadPreview: string
}

export interface StudioFlow {
  readonly runId: string
  readonly sessionId: string
  readonly projectId: string
  readonly steps: readonly StudioFlowStep[]
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

export async function updateProviderProfile(
  id: string,
  input: ProviderProfileDraft,
): Promise<ProviderProfileSummary> {
  const response = await fetch(`/api/workbench/providers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  return (await readJson<{ provider: ProviderProfileSummary }>(response)).provider
}

export async function deleteProviderProfile(id: string): Promise<void> {
  const response = await fetch(`/api/workbench/providers/${encodeURIComponent(id)}`, { method: 'DELETE' })
  await readJson<{ deleted: true }>(response)
}

export async function setDefaultProviderProfile(id: string): Promise<ProviderProfileSummary> {
  return (await post<{ provider: ProviderProfileSummary }>(
    `/api/workbench/providers/${encodeURIComponent(id)}/default`,
  )).provider
}

export async function testProviderProfile(id: string): Promise<void> {
  await post<{ ok: true }>(`/api/workbench/providers/${encodeURIComponent(id)}/test`)
}

export async function loadJournalSnapshot(
  sessionId: string,
  signal?: AbortSignal,
): Promise<JournalSnapshot> {
  const response = await fetch(`/api/workbench/sessions/${encodeURIComponent(sessionId)}`, { signal })
  return await readJson<JournalSnapshot>(response)
}

export async function loadContextProjection(
  sessionId: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<ContextProjection> {
  const query = new URLSearchParams({ requestId })
  const response = await fetch(`/api/workbench/sessions/${encodeURIComponent(sessionId)}/context?${query}`, { signal })
  return await readJson<ContextProjection>(response)
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
  projectId?: string
  assemblyId?: string
  assemblyGenerationId?: string
} = {}): Promise<SessionSummary> {
  return (await post<{ session: SessionSummary }>('/api/workbench/sessions', input)).session
}

export async function loadStudio(signal?: AbortSignal): Promise<StudioSnapshot> {
  return await readJson<StudioSnapshot>(await fetch('/api/workbench/studio', { signal }))
}

export async function createStudioProject(input: {
  title: string
  projectRoot?: string
  assemblyId?: string
}): Promise<StudioProject> {
  return (await post<{ project: StudioProject }>('/api/workbench/studio/projects', input)).project
}

export async function createStudioCase(input: {
  title: string
  projectId?: string
  workspace?: string
  prompt?: string
}): Promise<StudioCase> {
  return (await post<{ case: StudioCase }>('/api/workbench/studio/cases', input)).case
}

export async function loadStudioFlow(runId: string, signal?: AbortSignal): Promise<StudioFlow> {
  return await readJson<StudioFlow>(await fetch(`/api/workbench/studio/runs/${encodeURIComponent(runId)}/flow`, { signal }))
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
