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
}

export interface StudioProjectDto {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly projectRoot: string
  readonly assembly: StudioAssemblyDto
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
  readonly providerProfileId?: string
  readonly reasoningEffort?: ReasoningEffort
  readonly createdAt: string
}

interface StudioStore {
  readonly projects: readonly StoredProject[]
  readonly cases: readonly StoredCase[]
  readonly runs: readonly StoredRun[]
}

export interface StudioRunInput {
  readonly id: string
  readonly caseId: string
  readonly mode: 'mock' | 'real'
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
  run(input: {
    readonly caseId: string
    readonly mode: 'mock' | 'real'
    readonly providerProfileId?: string
    readonly reasoningEffort?: ReasoningEffort
  }): Promise<StudioRunDto>
  flow(runId: string): Promise<StudioFlowDto>
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
  return {
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
    runs: [],
  }
}

function isStoreLike(value: unknown): value is StudioStore {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return Array.isArray(item['projects'])
    && Array.isArray(item['cases'])
    && Array.isArray(item['runs'])
}

async function loadStore(path: string, fallback: StudioStore): Promise<StudioStore> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!isStoreLike(value)) throw new Error('invalid Studio store')
    return { projects: value.projects, cases: value.cases, runs: value.runs }
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
    projects: [
      ...store.projects,
      ...defaults.projects.filter(candidate => !store.projects.some(item => item.id === candidate.id)),
    ],
    cases: [
      ...store.cases,
      ...defaults.cases.filter(candidate => !store.cases.some(item => item.id === candidate.id)),
    ],
    runs: store.runs,
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

  async function runDto(run: StoredRun): Promise<StudioRunDto> {
    const testCase = storedCase(run.caseId)
    const snapshot = await options.session(run.sessionId)?.snapshot()
    const events = snapshot?.events ?? []
    const assertions = testCase.assertions.map(eventType => ({
      eventType,
      passed: events.some(event => event.type === eventType),
    }))
    const complete = events.some(event => event.type === 'assistant.message')
    const settled = snapshot?.session.runState === 'idle' || snapshot?.session.runState === 'completed'
    const failed = snapshot?.session.runState === 'failed'
      || (settled && events.length > 0 && !complete)
      || (settled && complete && assertions.some(assertion => !assertion.passed))
    return {
      ...run,
      projectId: testCase.projectId,
      status: failed ? 'failed' : settled && complete ? 'passed' : 'running',
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
      })),
      cases: store.cases.map(item => ({
        ...item,
        runCount: runs.filter(run => run.caseId === item.id).length,
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
      const defaultCase: StoredCase = {
        id: `${id}-default`,
        title: `${title} smoke case`,
        summary: `${title} default smoke case.`,
        projectId: id,
        workspace: project.projectRoot,
        prompt: assemblyId === 'case1'
          ? '请打开手电筒'
          : 'Inspect the current workspace with a terminal command, then briefly report what you found. Do not modify files.',
        assertions: ['tool.result', 'assistant.message'],
        createdAt: new Date().toISOString(),
      }
      await persist({
        ...store,
        projects: [...store.projects, project],
        cases: [...store.cases, defaultCase],
      })
      return {
        id: project.id,
        title: project.title,
        summary: project.summary,
        projectRoot: project.projectRoot,
        assembly,
      }
    },
    async createCase(input) {
      const title = input.title.trim()
      if (title.length === 0) throw new Error('Case title must not be empty')
      const projectId = input.projectId
        ?? (store.projects.find(item => item.assemblyId === defaultAssembly.id)?.id ?? store.projects[0]!.id)
      const project = storedProject(projectId)
      const created: StoredCase = {
        id: `case-${randomUUID().slice(0, 8)}`,
        title,
        summary: `${project.title} smoke case.`,
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
    async run(input) {
      const testCase = storedCase(input.caseId)
      const project = storedProject(testCase.projectId)
      const id = `run-${randomUUID().slice(0, 8)}`
      const session = await options.createRunSession({
        id,
        caseId: input.caseId,
        mode: input.mode,
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
      const assembly = assemblyForProject(testCase.projectId)
      const events = (await options.session(run.sessionId)?.snapshot())?.events ?? []
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
    assemblyId(projectId) {
      return store.projects.find(item => item.id === projectId)?.assemblyId
    },
  }
}
