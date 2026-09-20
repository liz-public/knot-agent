import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { JSONL_STORE_METADATA } from '../plugins/jsonl.js'
import { case2PluginMetadata } from '../cases/case2/plugin-definitions.js'
import { CASE2_SYSTEM_PROMPT } from '../cases/case2/system-prompt.js'
import { case2ToolDefinitions } from '../cases/case2/tool-definitions.js'
import { JOURNAL_CHANGE_METADATA } from './journal-bridge.js'
import type { ReasoningEffort, WorkbenchSession } from './session.js'

export interface StudioPluginDto {
  readonly id: string
  readonly name: string
  readonly category: 'platform' | 'context' | 'flow' | 'content' | 'effect' | 'presentation'
  readonly responsibility: string
  readonly listens: readonly string[]
  readonly emits: readonly string[]
  readonly source: string
}

export interface StudioToolDto {
  readonly name: string
  readonly description: string
}

export interface StudioAssemblyDto {
  readonly id: 'case2'
  readonly title: string
  readonly systemPrompt: string
  readonly plugins: readonly StudioPluginDto[]
  readonly tools: readonly StudioToolDto[]
  readonly protocols: readonly string[]
  readonly fingerprint: string
}

export interface StudioCaseDto {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly assemblyId: 'case2'
  readonly workspace: string
  readonly prompt: string
  readonly assertions: readonly string[]
  readonly createdAt: string
  readonly runCount: number
}

export interface StudioValidationDto {
  readonly id: string
  readonly caseId: string
  readonly assemblyFingerprint: string
  readonly createdAt: string
  readonly passed: boolean
  readonly checks: ReadonlyArray<{
    readonly id: string
    readonly label: string
    readonly passed: boolean
    readonly detail: string
  }>
}

export interface StudioGenerationDto {
  readonly id: string
  readonly assemblyId: 'case2'
  readonly assemblyFingerprint: string
  readonly validationId: string
  readonly createdAt: string
  readonly active: boolean
}

export interface StudioRunMetricsDto {
  readonly eventCount: number
  readonly modelCalls: number
  readonly toolCalls: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly durationMs?: number
}

export interface StudioRunDto {
  readonly id: string
  readonly caseId: string
  readonly mode: 'mock' | 'real'
  readonly sessionId: string
  readonly generationId: string
  readonly providerProfileId?: string
  readonly reasoningEffort?: ReasoningEffort
  readonly createdAt: string
  readonly status: 'running' | 'passed' | 'failed'
  readonly assertions: ReadonlyArray<{
    readonly eventType: string
    readonly passed: boolean
  }>
  readonly metrics: StudioRunMetricsDto
}

export interface StudioSnapshotDto {
  readonly assembly: StudioAssemblyDto
  readonly cases: readonly StudioCaseDto[]
  readonly validations: readonly StudioValidationDto[]
  readonly generations: readonly StudioGenerationDto[]
  readonly runs: readonly StudioRunDto[]
  readonly activeGenerationId: string
}

interface StoredCase extends Omit<StudioCaseDto, 'runCount'> {}
interface StoredRun {
  readonly id: string
  readonly caseId: string
  readonly mode: 'mock' | 'real'
  readonly sessionId: string
  readonly generationId: string
  readonly providerProfileId?: string
  readonly reasoningEffort?: ReasoningEffort
  readonly createdAt: string
}

interface StudioStore {
  readonly cases: readonly StoredCase[]
  readonly validations: readonly StudioValidationDto[]
  readonly generations: readonly Omit<StudioGenerationDto, 'active'>[]
  readonly runs: readonly StoredRun[]
  readonly activeGenerationId: string
}

export interface StudioRunInput {
  readonly id: string
  readonly caseId: string
  readonly mode: 'mock' | 'real'
  readonly generationId: string
  readonly title: string
  readonly workspace: string
  readonly prompt: string
  readonly providerProfileId?: string
  readonly reasoningEffort?: ReasoningEffort
}

export interface StudioController {
  snapshot(): Promise<StudioSnapshotDto>
  createCase(input: { readonly title: string; readonly workspace?: string; readonly prompt?: string }): Promise<StudioCaseDto>
  check(caseId: string): Promise<StudioValidationDto>
  publish(caseId: string): Promise<StudioGenerationDto>
  run(input: {
    readonly caseId: string
    readonly mode: 'mock' | 'real'
    readonly providerProfileId?: string
    readonly reasoningEffort?: ReasoningEffort
  }): Promise<StudioRunDto>
  hasGeneration(generationId: string): Promise<boolean>
  activeGenerationId(): Promise<string>
}

export interface StudioControllerOptions {
  readonly directory: string
  readonly defaultWorkspace: string
  readonly session: (id: string) => WorkbenchSession | undefined
  readonly createRunSession: (input: StudioRunInput) => Promise<WorkbenchSession>
}

const plugins: readonly StudioPluginDto[] = case2PluginMetadata([
  JSONL_STORE_METADATA,
  JOURNAL_CHANGE_METADATA,
])

function toolMetadata(): readonly StudioToolDto[] {
  const definitions = case2ToolDefinitions({
    cwd: '/',
    askPort: { ask: async () => ({ answer: '' }) },
    subagentFactory: { run: async () => ({ summary: '' }) },
  })
  return definitions.map(definition => {
    const fn = definition.schema['function'] as Record<string, unknown>
    return {
      name: String(fn['name']),
      description: typeof fn['description'] === 'string' ? fn['description'] : '',
    }
  })
}

function assemblyMetadata(): StudioAssemblyDto {
  const tools = toolMetadata()
  const protocols = [...new Set(plugins.flatMap(plugin => [...plugin.listens, ...plugin.emits]))]
    .filter(protocol => protocol !== '*')
    .sort()
  const source = { id: 'case2' as const, systemPrompt: CASE2_SYSTEM_PROMPT, plugins, tools, protocols }
  return {
    ...source,
    title: 'CASE2 coding agent',
    fingerprint: createHash('sha256').update(JSON.stringify(source)).digest('hex').slice(0, 16),
  }
}

function initialStore(workspace: string, assembly: StudioAssemblyDto): StudioStore {
  const createdAt = new Date().toISOString()
  const baseline = 'case2-baseline'
  return {
    cases: [{
      id: 'case2-coding',
      title: 'CASE2 coding task',
      summary: 'Real CASE2 assembly with native coding tools and Journal evidence.',
      assemblyId: 'case2',
      workspace,
      prompt: 'Inspect the current workspace with a terminal command, then briefly report what you found. Do not modify files.',
      assertions: ['tool.result', 'assistant.message'],
      createdAt,
    }],
    validations: [],
    generations: [{
      id: baseline,
      assemblyId: 'case2',
      assemblyFingerprint: assembly.fingerprint,
      validationId: 'built-in',
      createdAt,
    }],
    runs: [],
    activeGenerationId: baseline,
  }
}

function isStore(value: unknown): value is StudioStore {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return Array.isArray(item['cases'])
    && Array.isArray(item['validations'])
    && Array.isArray(item['generations'])
    && Array.isArray(item['runs'])
    && typeof item['activeGenerationId'] === 'string'
}

async function loadStore(path: string, fallback: StudioStore): Promise<StudioStore> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!isStore(value)) throw new Error('invalid Studio store')
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw error
  }
}

async function saveStore(path: string, store: StudioStore): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}

function metrics(events: readonly { type: string; data: unknown; observedAt?: string }[]): StudioRunMetricsDto {
  const generations = events.filter(event => event.type === 'llm.generated')
  const toolCalls = events
    .filter(event => event.type === 'tool.call')
    .reduce((count, event) => {
      if (typeof event.data !== 'object' || event.data === null) return count
      const calls = (event.data as Record<string, unknown>)['calls']
      return count + (Array.isArray(calls) ? calls.length : 0)
    }, 0)
  const usage = generations.map(event => {
    if (typeof event.data !== 'object' || event.data === null) return {}
    const candidate = (event.data as Record<string, unknown>)['usage']
    return typeof candidate === 'object' && candidate !== null
      ? candidate as Record<string, unknown>
      : {}
  })
  const startedAt = events.find(event => event.observedAt !== undefined)?.observedAt
  const completedAt = [...events].reverse().find(event => event.observedAt !== undefined)?.observedAt
  const durationMs = startedAt === undefined || completedAt === undefined
    ? undefined
    : Math.max(0, Date.parse(completedAt) - Date.parse(startedAt))
  return {
    eventCount: events.length,
    modelCalls: generations.length,
    toolCalls,
    inputTokens: usage.reduce((sum, item) => sum + (Number(item['inputTokens']) || 0), 0),
    outputTokens: usage.reduce((sum, item) => sum + (Number(item['outputTokens']) || 0), 0),
    ...(durationMs === undefined ? {} : { durationMs }),
  }
}

export async function createStudioController(options: StudioControllerOptions): Promise<StudioController> {
  const assembly = assemblyMetadata()
  const storePath = join(options.directory, 'studio.json')
  let store = await loadStore(storePath, initialStore(options.defaultWorkspace, assembly))
  await saveStore(storePath, store)

  async function persist(next: StudioStore): Promise<void> {
    await saveStore(storePath, next)
    store = next
  }

  function storedCase(caseId: string): StoredCase {
    const value = store.cases.find(item => item.id === caseId)
    if (value === undefined) throw new Error(`Unknown Studio case ${caseId}`)
    return value
  }

  async function runDto(run: StoredRun): Promise<StudioRunDto> {
    const testCase = storedCase(run.caseId)
    const session = options.session(run.sessionId)
    const snapshot = await session?.snapshot()
    const events = snapshot?.events ?? []
    const assertions = testCase.assertions.map(eventType => ({
      eventType,
      passed: events.some(event => event.type === eventType),
    }))
    const complete = events.some(event => event.type === 'assistant.message')
    const settledWithoutCompletion = snapshot?.session.runState === 'idle'
      && events.length > 0
      && !complete
    const failed = snapshot?.session.runState === 'failed'
      || settledWithoutCompletion
      || (snapshot?.session.runState === 'idle' && complete && assertions.some(assertion => !assertion.passed))
    const status = failed ? 'failed' : snapshot?.session.runState === 'idle' && complete ? 'passed' : 'running'
    return {
      ...run,
      status,
      assertions,
      metrics: metrics(events),
    }
  }

  async function snapshot(): Promise<StudioSnapshotDto> {
    const runs = await Promise.all(store.runs.map(runDto))
    return {
      assembly,
      cases: store.cases.map(item => ({
        ...item,
        runCount: runs.filter(run => run.caseId === item.id).length,
      })),
      validations: store.validations,
      generations: store.generations.map(item => ({
        ...item,
        active: item.id === store.activeGenerationId,
      })),
      runs,
      activeGenerationId: store.activeGenerationId,
    }
  }

  return {
    snapshot,
    async createCase(input) {
      const title = input.title.trim()
      if (title.length === 0) throw new Error('Case title must not be empty')
      const created: StoredCase = {
        id: `case-${randomUUID().slice(0, 8)}`,
        title,
        summary: 'CASE2 case created from the current active generation.',
        assemblyId: 'case2',
        workspace: input.workspace?.trim() || options.defaultWorkspace,
        prompt: input.prompt?.trim()
          || 'Inspect the current workspace with a terminal command, then briefly report what you found. Do not modify files.',
        assertions: ['tool.result', 'assistant.message'],
        createdAt: new Date().toISOString(),
      }
      await persist({ ...store, cases: [...store.cases, created] })
      return { ...created, runCount: 0 }
    },
    async check(caseId) {
      storedCase(caseId)
      const pluginIds = assembly.plugins.map(plugin => plugin.id)
      const toolNames = assembly.tools.map(tool => tool.name)
      const checks = [
        { id: 'system-prompt', label: 'System prompt is present', passed: assembly.systemPrompt.trim().length > 0, detail: `${assembly.systemPrompt.length} characters` },
        { id: 'plugin-identity', label: 'Plugin identities are unique', passed: unique(pluginIds), detail: `${pluginIds.length} declared plugins` },
        { id: 'tool-identity', label: 'Tool identities are unique', passed: unique(toolNames), detail: `${toolNames.length} native tools` },
        { id: 'content-path', label: 'Core content path is declared', passed: ['user.message', 'llm.invoke', 'llm.generated', 'assistant.message'].every(protocol => assembly.protocols.includes(protocol)), detail: 'user.message → llm.invoke → llm.generated → assistant.message' },
      ]
      const validation: StudioValidationDto = {
        id: `validation-${randomUUID().slice(0, 8)}`,
        caseId,
        assemblyFingerprint: assembly.fingerprint,
        createdAt: new Date().toISOString(),
        passed: checks.every(check => check.passed),
        checks,
      }
      await persist({ ...store, validations: [...store.validations, validation] })
      return validation
    },
    async publish(caseId) {
      storedCase(caseId)
      const validation = [...store.validations].reverse().find(item =>
        item.caseId === caseId && item.assemblyFingerprint === assembly.fingerprint && item.passed,
      )
      if (validation === undefined) throw new Error('Run Check Assembly successfully before publishing')
      const generation = {
        id: `case2-${randomUUID().slice(0, 8)}`,
        assemblyId: 'case2' as const,
        assemblyFingerprint: assembly.fingerprint,
        validationId: validation.id,
        createdAt: new Date().toISOString(),
      }
      await persist({
        ...store,
        generations: [...store.generations, generation],
        activeGenerationId: generation.id,
      })
      return { ...generation, active: true }
    },
    async run(input) {
      const testCase = storedCase(input.caseId)
      const id = `run-${randomUUID().slice(0, 8)}`
      const session = await options.createRunSession({
        id,
        caseId: input.caseId,
        mode: input.mode,
        generationId: store.activeGenerationId,
        title: `${testCase.title} · ${input.mode}`,
        workspace: testCase.workspace,
        prompt: testCase.prompt,
        ...(input.providerProfileId === undefined ? {} : { providerProfileId: input.providerProfileId }),
        ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
      })
      const run: StoredRun = {
        id,
        caseId: input.caseId,
        mode: input.mode,
        sessionId: session.id,
        generationId: store.activeGenerationId,
        ...(input.providerProfileId === undefined ? {} : { providerProfileId: input.providerProfileId }),
        ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
        createdAt: new Date().toISOString(),
      }
      await persist({ ...store, runs: [...store.runs, run] })
      return await runDto(run)
    },
    async hasGeneration(generationId) {
      return store.generations.some(item => item.id === generationId)
    },
    async activeGenerationId() {
      return store.activeGenerationId
    },
  }
}
