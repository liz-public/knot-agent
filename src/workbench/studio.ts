import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createAssemblyCatalog, type AssemblyDescription } from './assembly-catalog.js'
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
  readonly id: string
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
  readonly assemblyId: string
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
  readonly assemblyId: string
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
  readonly assemblies: readonly StudioAssemblyDto[]
  /** Backward-compatible default while the UI migrates to per-Case assembly selection. */
  readonly assembly: StudioAssemblyDto
  readonly cases: readonly StudioCaseDto[]
  readonly validations: readonly StudioValidationDto[]
  readonly generations: readonly StudioGenerationDto[]
  readonly runs: readonly StudioRunDto[]
  readonly activeGenerationId: string
  readonly activeGenerationIds: Readonly<Record<string, string>>
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
  readonly activeGenerationIds: Readonly<Record<string, string>>
}

export interface StudioRunInput {
  readonly id: string
  readonly caseId: string
  readonly mode: 'mock' | 'real'
  readonly generationId: string
  readonly assemblyId: string
  readonly title: string
  readonly workspace: string
  readonly prompt: string
  readonly providerProfileId?: string
  readonly reasoningEffort?: ReasoningEffort
}

export interface StudioController {
  snapshot(): Promise<StudioSnapshotDto>
  createCase(input: { readonly title: string; readonly assemblyId?: string; readonly workspace?: string; readonly prompt?: string }): Promise<StudioCaseDto>
  check(caseId: string): Promise<StudioValidationDto>
  publish(caseId: string): Promise<StudioGenerationDto>
  run(input: {
    readonly caseId: string
    readonly mode: 'mock' | 'real'
    readonly providerProfileId?: string
    readonly reasoningEffort?: ReasoningEffort
  }): Promise<StudioRunDto>
  hasGeneration(generationId: string, assemblyId?: string): Promise<boolean>
  activeGenerationId(assemblyId?: string): Promise<string>
}

export interface StudioControllerOptions {
  readonly directory: string
  readonly defaultWorkspace: string
  readonly session: (id: string) => WorkbenchSession | undefined
  readonly createRunSession: (input: StudioRunInput) => Promise<WorkbenchSession>
  readonly assemblies?: readonly AssemblyDescription[]
}

function initialStore(workspace: string, assemblies: readonly StudioAssemblyDto[]): StudioStore {
  const createdAt = new Date().toISOString()
  const activeGenerationIds = Object.fromEntries(assemblies.map(assembly => [assembly.id, `${assembly.id}-baseline`]))
  return {
    cases: assemblies.map(assembly => assembly.id === 'case1' ? {
      id: 'case1-mobile', title: 'CASE1 mobile assistant', summary: 'Mobile-assistant shortcut, dynamic context, tool, and LLM continuation.', assemblyId: assembly.id, workspace, prompt: '请打开手电筒', assertions: ['tool.result', 'assistant.message'], createdAt,
    } : {
      id: `${assembly.id}-coding`, title: `${assembly.id.toUpperCase()} coding task`, summary: 'Coding-agent workspace inspection with native tools and Journal evidence.', assemblyId: assembly.id, workspace, prompt: 'Inspect the current workspace with a terminal command, then briefly report what you found. Do not modify files.', assertions: ['tool.result', 'assistant.message'], createdAt,
    }),
    validations: [],
    generations: assemblies.map(assembly => ({
      id: `${assembly.id}-baseline`,
      assemblyId: assembly.id,
      assemblyFingerprint: assembly.fingerprint,
      validationId: 'built-in',
      createdAt,
    })),
    runs: [],
    activeGenerationIds,
  }
}

function isStore(value: unknown): value is StudioStore {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return Array.isArray(item['cases'])
    && Array.isArray(item['validations'])
    && Array.isArray(item['generations'])
    && Array.isArray(item['runs'])
    && (typeof item['activeGenerationId'] === 'string'
      || (typeof item['activeGenerationIds'] === 'object' && item['activeGenerationIds'] !== null))
}

async function loadStore(path: string, fallback: StudioStore): Promise<StudioStore> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!isStore(value)) throw new Error('invalid Studio store')
    const legacy = value as unknown as StudioStore & { readonly activeGenerationId?: string }
    return {
      cases: legacy.cases,
      validations: legacy.validations,
      generations: legacy.generations,
      runs: legacy.runs,
      activeGenerationIds: legacy.activeGenerationIds
        ?? { case2: legacy.activeGenerationId ?? fallback.activeGenerationIds['case2']! },
    }
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
  const assemblies = options.assemblies
    ?? createAssemblyCatalog().list().map(definition => definition.description)
  const byAssemblyId = new Map(assemblies.map(assembly => [assembly.id, assembly]))
  if (byAssemblyId.size !== assemblies.length || assemblies.length === 0) {
    throw new Error('Studio requires unique assemblies')
  }
  const defaultAssembly = byAssemblyId.get('case2') ?? assemblies[0]!
  const storePath = join(options.directory, 'studio.json')
  const defaults = initialStore(options.defaultWorkspace, assemblies)
  let store = await loadStore(storePath, defaults)
  store = {
    ...store,
    cases: [
      ...store.cases,
      ...defaults.cases.filter(candidate => !store.cases.some(item => item.id === candidate.id)),
    ],
    generations: [
      ...store.generations,
      ...defaults.generations.filter(candidate => !store.generations.some(item => item.id === candidate.id)),
    ],
    activeGenerationIds: { ...defaults.activeGenerationIds, ...store.activeGenerationIds },
  }
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

  function assemblyForCase(testCase: StoredCase): StudioAssemblyDto {
    const value = byAssemblyId.get(testCase.assemblyId)
    if (value === undefined) throw new Error(`Unknown assembly ${testCase.assemblyId}`)
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
      assemblies,
      assembly: defaultAssembly,
      cases: store.cases.map(item => ({
        ...item,
        runCount: runs.filter(run => run.caseId === item.id).length,
      })),
      validations: store.validations,
      generations: store.generations.map(item => ({
        ...item,
        active: item.id === store.activeGenerationIds[item.assemblyId],
      })),
      runs,
      activeGenerationId: store.activeGenerationIds[defaultAssembly.id]!,
      activeGenerationIds: store.activeGenerationIds,
    }
  }

  return {
    snapshot,
    async createCase(input) {
      const title = input.title.trim()
      if (title.length === 0) throw new Error('Case title must not be empty')
      const assemblyId = input.assemblyId ?? defaultAssembly.id
      if (!byAssemblyId.has(assemblyId)) throw new Error(`Unknown assembly ${assemblyId}`)
      const created: StoredCase = {
        id: `case-${randomUUID().slice(0, 8)}`,
        title,
        summary: `${assemblyId.toUpperCase()} case created from the current active generation.`,
        assemblyId,
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
      const testCase = storedCase(caseId)
      const assembly = assemblyForCase(testCase)
      const pluginIds = assembly.plugins.map(plugin => plugin.id)
      const toolNames = assembly.tools.map(tool => tool.name)
      const checks = [
        { id: 'assembly-identity', label: 'Assembly identity is present', passed: assembly.id.trim().length > 0 && assembly.title.trim().length > 0, detail: assembly.id },
        { id: 'plugin-identity', label: 'Plugin identities are unique', passed: unique(pluginIds), detail: `${pluginIds.length} declared plugins` },
        { id: 'tool-identity', label: 'Tool identities are unique', passed: unique(toolNames), detail: `${toolNames.length} native tools` },
        { id: 'fingerprint', label: 'Assembly fingerprint is present', passed: assembly.fingerprint.length > 0, detail: assembly.fingerprint },
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
      const testCase = storedCase(caseId)
      const assembly = assemblyForCase(testCase)
      const validation = [...store.validations].reverse().find(item =>
        item.caseId === caseId && item.assemblyFingerprint === assembly.fingerprint && item.passed,
      )
      if (validation === undefined) throw new Error('Run Check Assembly successfully before publishing')
      const generation = {
        id: `${assembly.id}-${randomUUID().slice(0, 8)}`,
        assemblyId: assembly.id,
        assemblyFingerprint: assembly.fingerprint,
        validationId: validation.id,
        createdAt: new Date().toISOString(),
      }
      await persist({
        ...store,
        generations: [...store.generations, generation],
        activeGenerationIds: { ...store.activeGenerationIds, [assembly.id]: generation.id },
      })
      return { ...generation, active: true }
    },
    async run(input) {
      const testCase = storedCase(input.caseId)
      const generationId = store.activeGenerationIds[testCase.assemblyId]
      if (generationId === undefined) throw new Error(`No active generation for ${testCase.assemblyId}`)
      const id = `run-${randomUUID().slice(0, 8)}`
      const session = await options.createRunSession({
        id,
        caseId: input.caseId,
        mode: input.mode,
        generationId,
        assemblyId: testCase.assemblyId,
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
        generationId,
        ...(input.providerProfileId === undefined ? {} : { providerProfileId: input.providerProfileId }),
        ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
        createdAt: new Date().toISOString(),
      }
      await persist({ ...store, runs: [...store.runs, run] })
      return await runDto(run)
    },
    async hasGeneration(generationId, assemblyId) {
      return store.generations.some(item => item.id === generationId
        && (assemblyId === undefined || item.assemblyId === assemblyId))
    },
    async activeGenerationId(assemblyId = defaultAssembly.id) {
      const value = store.activeGenerationIds[assemblyId]
      if (value === undefined) throw new Error(`No active generation for ${assemblyId}`)
      return value
    },
  }
}
