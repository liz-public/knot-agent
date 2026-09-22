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

export interface StudioProjectDto {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly projectRoot: string
  readonly assembly: StudioAssemblyDto
  readonly activeGenerationId: string
}

export interface StudioCaseDto {
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
  readonly projectId: string
  readonly assemblyFingerprint: string
  readonly validationId: string
  readonly createdAt: string
  readonly active: boolean
  readonly restorable: boolean
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
  readonly projectId: string
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
  readonly projects: readonly StudioProjectDto[]
  readonly cases: readonly StudioCaseDto[]
  readonly validations: readonly StudioValidationDto[]
  readonly generations: readonly StudioGenerationDto[]
  readonly runs: readonly StudioRunDto[]
}

interface StoredCase extends Omit<StudioCaseDto, 'runCount'> {}
interface StoredProject {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly projectRoot: string
  readonly assemblyId: string
}
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
  readonly schemaVersion: 2
  readonly projects: readonly StoredProject[]
  readonly cases: readonly StoredCase[]
  readonly validations: readonly StudioValidationDto[]
  readonly generations: ReadonlyArray<Omit<StudioGenerationDto, 'active' | 'restorable'> & {
    readonly assemblySnapshot?: StudioAssemblyDto
  }>
  readonly runs: readonly StoredRun[]
  readonly activeGenerationIds: Readonly<Record<string, string>>
}

export interface StudioRunInput {
  readonly id: string
  readonly caseId: string
  readonly mode: 'mock' | 'real'
  readonly generationId: string
  readonly projectId: string
  readonly assemblyId: string
  readonly title: string
  readonly workspace: string
  readonly prompt: string
  readonly providerProfileId?: string
  readonly reasoningEffort?: ReasoningEffort
}

export interface StudioController {
  snapshot(): Promise<StudioSnapshotDto>
  createProject(input: { readonly title: string; readonly projectRoot?: string; readonly assemblyId?: string }): Promise<StudioProjectDto>
  createCase(input: { readonly title: string; readonly projectId?: string; readonly workspace?: string; readonly prompt?: string }): Promise<StudioCaseDto>
  check(caseId: string): Promise<StudioValidationDto>
  publish(caseId: string): Promise<StudioGenerationDto>
  run(input: {
    readonly caseId: string
    readonly mode: 'mock' | 'real'
    readonly providerProfileId?: string
    readonly reasoningEffort?: ReasoningEffort
  }): Promise<StudioRunDto>
  flow(runId: string): Promise<StudioFlowDto>
  hasGeneration(generationId: string, projectId?: string): Promise<boolean>
  activeGenerationId(projectId?: string): Promise<string>
  assemblyId(projectId: string): string | undefined
}

export interface StudioFlowStepDto {
  readonly position: number
  readonly type: string
  readonly observedAt?: string
  readonly elapsedMs?: number
  readonly producers: readonly string[]
  readonly consumers: readonly string[]
  readonly payloadPreview: string
}

export interface StudioFlowDto {
  readonly runId: string
  readonly sessionId: string
  readonly projectId: string
  readonly steps: readonly StudioFlowStepDto[]
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
    schemaVersion: 2,
    projects: assemblies.map(assembly => ({
      id: assembly.id,
      title: assembly.title,
      summary: assembly.id === 'case1' ? 'Mobile assistant Project' : 'Coding agent Project',
      projectRoot: workspace,
      assemblyId: assembly.id,
    })),
    cases: assemblies.map(assembly => assembly.id === 'case1' ? {
      id: 'case1-mobile', title: 'CASE1 mobile assistant', summary: 'Mobile-assistant shortcut, dynamic context, tool, and LLM continuation.', projectId: assembly.id, workspace, prompt: '请打开手电筒', assertions: ['tool.result', 'assistant.message'], createdAt,
    } : {
      id: `${assembly.id}-coding`, title: `${assembly.id.toUpperCase()} coding task`, summary: 'Coding-agent workspace inspection with native tools and Journal evidence.', projectId: assembly.id, workspace, prompt: 'Inspect the current workspace with a terminal command, then briefly report what you found. Do not modify files.', assertions: ['tool.result', 'assistant.message'], createdAt,
    }),
    validations: [],
    generations: assemblies.map(assembly => ({
      id: `${assembly.id}-baseline`,
      projectId: assembly.id,
      assemblyFingerprint: assembly.fingerprint,
      validationId: 'built-in',
      createdAt,
      assemblySnapshot: assembly,
    })),
    runs: [],
    activeGenerationIds,
  }
}

function isStoreLike(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return Array.isArray(item['cases'])
    && Array.isArray(item['validations'])
    && Array.isArray(item['generations'])
    && Array.isArray(item['runs'])
    && (typeof item['activeGenerationId'] === 'string'
      || (typeof item['activeGenerationIds'] === 'object' && item['activeGenerationIds'] !== null))
}

async function loadStore(
  path: string,
  fallback: StudioStore,
  assemblies: readonly StudioAssemblyDto[],
): Promise<StudioStore> {
  try {
    const source = await readFile(path, 'utf8')
    const value = JSON.parse(source) as unknown
    if (!isStoreLike(value)) throw new Error('invalid Studio store')
    const currentAssembly = new Map(assemblies.map(assembly => [assembly.id, assembly]))
    const legacy = value as Record<string, unknown> & { readonly activeGenerationId?: string }
    if (legacy['schemaVersion'] !== 2) {
      try { await writeFile(`${path}.v1.backup`, source, { encoding: 'utf8', flag: 'wx' }) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    }
    const projects = Array.isArray(legacy['projects'])
      ? legacy['projects'] as readonly StoredProject[]
      : fallback.projects
    const cases = (legacy['cases'] as readonly Record<string, unknown>[]).map(item => ({
      ...item,
      projectId: typeof item['projectId'] === 'string' ? item['projectId'] : String(item['assemblyId']),
      assemblyId: undefined,
    })) as unknown as readonly StoredCase[]
    const generations = (legacy['generations'] as readonly Record<string, unknown>[]).map(item => {
      const projectId = typeof item['projectId'] === 'string' ? item['projectId'] : String(item['assemblyId'])
      const assembly = currentAssembly.get(projects.find(project => project.id === projectId)?.assemblyId ?? projectId)
      return {
        id: String(item['id']),
        projectId,
        assemblyFingerprint: String(item['assemblyFingerprint']),
        validationId: String(item['validationId']),
        createdAt: String(item['createdAt']),
        ...(typeof item['assemblySnapshot'] === 'object' && item['assemblySnapshot'] !== null
          ? { assemblySnapshot: item['assemblySnapshot'] as unknown as StudioAssemblyDto }
          : assembly?.fingerprint === item['assemblyFingerprint'] ? { assemblySnapshot: assembly } : {}),
      }
    })
    const activeGenerationIds = typeof legacy['activeGenerationIds'] === 'object' && legacy['activeGenerationIds'] !== null
      ? legacy['activeGenerationIds'] as Readonly<Record<string, string>>
      : { case2: legacy.activeGenerationId ?? fallback.activeGenerationIds['case2']! }
    return {
      schemaVersion: 2,
      projects,
      cases,
      validations: legacy['validations'] as readonly StudioValidationDto[],
      generations,
      runs: legacy['runs'] as readonly StoredRun[],
      activeGenerationIds,
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
  let store = await loadStore(storePath, defaults, assemblies)
  store = {
    ...store,
    projects: [
      ...store.projects,
      ...defaults.projects.filter(candidate => !store.projects.some(item => item.id === candidate.id)),
    ],
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

  function storedProject(projectId: string): StoredProject {
    const value = store.projects.find(item => item.id === projectId)
    if (value === undefined) throw new Error(`Unknown project ${projectId}`)
    return value
  }

  function assemblyForProject(projectId: string): StudioAssemblyDto {
    const project = storedProject(projectId)
    const value = byAssemblyId.get(project.assemblyId)
    if (value === undefined) throw new Error(`Unknown assembly ${project.assemblyId}`)
    return value
  }

  function assemblyForCase(testCase: StoredCase): StudioAssemblyDto {
    return assemblyForProject(testCase.projectId)
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
    const settled = snapshot?.session.runState === 'idle' || snapshot?.session.runState === 'completed'
    const settledWithoutCompletion = settled
      && events.length > 0
      && !complete
    const failed = snapshot?.session.runState === 'failed'
      || settledWithoutCompletion
      || (settled && complete && assertions.some(assertion => !assertion.passed))
    const status = failed ? 'failed' : settled && complete ? 'passed' : 'running'
    return {
      ...run,
      projectId: testCase.projectId,
      status,
      assertions,
      metrics: metrics(events),
    }
  }

  async function snapshot(): Promise<StudioSnapshotDto> {
    const runs = await Promise.all(store.runs.map(runDto))
    return {
      projects: store.projects.map(project => ({
        id: project.id,
        title: project.title,
        summary: project.summary,
        projectRoot: project.projectRoot,
        assembly: assemblyForProject(project.id),
        activeGenerationId: store.activeGenerationIds[project.id]!,
      })),
      cases: store.cases.map(item => ({
        ...item,
        runCount: runs.filter(run => run.caseId === item.id).length,
      })),
      validations: store.validations,
      generations: store.generations.map(item => ({
        id: item.id,
        projectId: item.projectId,
        assemblyFingerprint: item.assemblyFingerprint,
        validationId: item.validationId,
        createdAt: item.createdAt,
        active: item.id === store.activeGenerationIds[item.projectId],
        restorable: item.assemblySnapshot !== undefined
          && byAssemblyId.get(storedProject(item.projectId).assemblyId)?.fingerprint === item.assemblyFingerprint,
      })),
      runs,
    }
  }

  return {
    snapshot,
    async createProject(input) {
      const title = input.title.trim()
      if (title.length === 0) throw new Error('Project title must not be empty')
      const assemblyId = input.assemblyId ?? defaultAssembly.id
      const assembly = byAssemblyId.get(assemblyId)
      if (assembly === undefined) throw new Error(`Unknown assembly ${assemblyId}`)
      const id = `project-${randomUUID().slice(0, 8)}`
      const project: StoredProject = {
        id,
        title,
        summary: `${assembly.title} Project`,
        projectRoot: input.projectRoot?.trim() || options.defaultWorkspace,
        assemblyId,
      }
      const generation = {
        id: `${id}-baseline`,
        projectId: id,
        assemblyFingerprint: assembly.fingerprint,
        validationId: 'built-in',
        createdAt: new Date().toISOString(),
        assemblySnapshot: assembly,
      }
      const createdAt = new Date().toISOString()
      const defaultCase: StoredCase = {
        id: `${id}-default`,
        title: `${title} smoke case`,
        summary: `${title} default validation case.`,
        projectId: id,
        workspace: project.projectRoot,
        prompt: assemblyId === 'case1'
          ? '请打开手电筒'
          : 'Inspect the current workspace with a terminal command, then briefly report what you found. Do not modify files.',
        assertions: ['tool.result', 'assistant.message'],
        createdAt,
      }
      await persist({
        ...store,
        projects: [...store.projects, project],
        cases: [...store.cases, defaultCase],
        generations: [...store.generations, generation],
        activeGenerationIds: { ...store.activeGenerationIds, [id]: generation.id },
      })
      return {
        id: project.id,
        title: project.title,
        summary: project.summary,
        projectRoot: project.projectRoot,
        assembly,
        activeGenerationId: generation.id,
      }
    },
    async createCase(input) {
      const title = input.title.trim()
      if (title.length === 0) throw new Error('Case title must not be empty')
      const projectId = input.projectId ?? (store.projects.find(item => item.assemblyId === defaultAssembly.id)?.id ?? store.projects[0]!.id)
      const project = storedProject(projectId)
      const created: StoredCase = {
        id: `case-${randomUUID().slice(0, 8)}`,
        title,
        summary: `${project.title} case created from the current active generation.`,
        projectId,
        workspace: input.workspace?.trim() || project.projectRoot,
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
      const active = store.generations.find(item => item.id === store.activeGenerationIds[testCase.projectId])
      if (active?.assemblyFingerprint === assembly.fingerprint) {
        return {
          id: active.id,
          projectId: active.projectId,
          assemblyFingerprint: active.assemblyFingerprint,
          validationId: active.validationId,
          createdAt: active.createdAt,
          active: true,
          restorable: active.assemblySnapshot !== undefined,
        }
      }
      const generation = {
        id: `${assembly.id}-${randomUUID().slice(0, 8)}`,
        projectId: testCase.projectId,
        assemblyFingerprint: assembly.fingerprint,
        validationId: validation.id,
        createdAt: new Date().toISOString(),
        assemblySnapshot: assembly,
      }
      await persist({
        ...store,
        generations: [...store.generations, generation],
        activeGenerationIds: { ...store.activeGenerationIds, [testCase.projectId]: generation.id },
      })
      return {
        id: generation.id,
        projectId: generation.projectId,
        assemblyFingerprint: generation.assemblyFingerprint,
        validationId: generation.validationId,
        createdAt: generation.createdAt,
        active: true,
        restorable: true,
      }
    },
    async run(input) {
      const testCase = storedCase(input.caseId)
      const project = storedProject(testCase.projectId)
      const generationId = store.activeGenerationIds[testCase.projectId]
      if (generationId === undefined) throw new Error(`No active generation for ${testCase.projectId}`)
      const id = `run-${randomUUID().slice(0, 8)}`
      const session = await options.createRunSession({
        id,
        caseId: input.caseId,
        mode: input.mode,
        generationId,
        projectId: testCase.projectId,
        assemblyId: project.assemblyId,
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
    async flow(runId) {
      const run = store.runs.find(item => item.id === runId)
      if (run === undefined) throw new Error(`Unknown Studio run ${runId}`)
      const testCase = storedCase(run.caseId)
      const assembly = assemblyForCase(testCase)
      const session = options.session(run.sessionId)
      const events = (await session?.snapshot())?.events ?? []
      return {
        runId,
        sessionId: run.sessionId,
        projectId: testCase.projectId,
        steps: events.map(event => {
          let payloadPreview: string
          try { payloadPreview = JSON.stringify(event.data) }
          catch { payloadPreview = String(event.data) }
          return {
            position: event.position,
            type: event.type,
            ...(event.observedAt === undefined ? {} : { observedAt: event.observedAt }),
            ...(event.elapsedMs === undefined ? {} : { elapsedMs: event.elapsedMs }),
            producers: assembly.plugins.filter(plugin => plugin.emits.includes(event.type)).map(plugin => plugin.id),
            consumers: assembly.plugins.filter(plugin => plugin.listens.includes(event.type) || plugin.listens.includes('*')).map(plugin => plugin.id),
            payloadPreview: payloadPreview.length <= 240 ? payloadPreview : `${payloadPreview.slice(0, 237)}…`,
          }
        }),
      }
    },
    async hasGeneration(generationId, projectId) {
      return store.generations.some(item => item.id === generationId
        && (projectId === undefined || item.projectId === projectId))
    },
    async activeGenerationId(projectId = store.projects.find(item => item.assemblyId === defaultAssembly.id)?.id ?? store.projects[0]!.id) {
      const value = store.activeGenerationIds[projectId]
      if (value === undefined) throw new Error(`No active generation for ${projectId}`)
      return value
    },
    assemblyId(projectId) {
      return store.projects.find(item => item.id === projectId)?.assemblyId
    },
  }
}
