import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { LlmProvider } from '../cases/case1/llm.js'
import type { AgentAssemblyFactory } from './assembly.js'
import { case2AssemblyFactory } from './case2-assembly.js'
import { createWorkbenchServer } from './http-server.js'
import { createLiveSession } from './live-session.js'
import {
  providerProfilesFromEnvironment,
  publicProviderProfile,
  type ProviderProfile,
} from './provider-profile.js'
import { createProviderProfileStore } from './provider-profile-store.js'
import type { ApprovalMode, ReasoningEffort, WorkbenchSession } from './session.js'
import { loadSessionDescriptors, saveSessionDescriptor } from './session-catalog.js'
import { createSessionRegistry } from './session-registry.js'
import { storedSession, type StoredSessionConfig } from './stored-session.js'
import { runSubagentSession } from './subagent-session.js'
import { createStudioController, type StudioController, type StudioRunInput } from './studio.js'

function configuredStoredSessions(): readonly StoredSessionConfig[] {
  const value = process.env['KNOT_WORKBENCH_SESSIONS']
  if (value === undefined) return []
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed)) throw new Error('KNOT_WORKBENCH_SESSIONS must be a JSON array')
  return parsed as StoredSessionConfig[]
}

const registry = createSessionRegistry()
let studio: StudioController | undefined

function assemblyFor(
  profile: ProviderProfile,
  reasoningEffort?: ReasoningEffort,
  approvalMode: ApprovalMode = 'ask',
  parent?: { readonly id: string; readonly delegationDepth: number },
) {
  return case2AssemblyFactory({
    llm: profile.create({ reasoningEffort }),
    model: profile.model,
    approvalMode,
    ...(parent === undefined || parent.delegationDepth >= 1 ? {} : {
      subagentFactory: {
        run: input => runSubagent({
          parentSessionId: parent.id,
          parentProfile: profile,
          parentReasoningEffort: reasoningEffort,
          approvalMode,
          ...input,
        }),
      },
    }),
  })
}

function profileForDescriptor(input: { model?: string; providerProfileId?: string }) {
  if (input.providerProfileId !== undefined) return providerStore.get(input.providerProfileId)
  return providerStore.list().find(profile => profile.configured && profile.model === input.model)
    ?? providerStore.default()
}

const defaultCwd = process.env['KNOT_CWD'] ?? process.cwd()
const configuredJournal = process.env['KNOT_JOURNAL_PATH']
const sessionDirectory = process.env['KNOT_WORKBENCH_SESSION_DIR']
  ?? (configuredJournal === undefined ? join(defaultCwd, '.knot', 'sessions') : dirname(configuredJournal))
const providerFile = process.env['KNOT_WORKBENCH_PROVIDER_FILE']
  ?? join(dirname(sessionDirectory), 'providers.json')
const providerStore = await createProviderProfileStore(
  providerFile,
  providerProfilesFromEnvironment(process.env),
)

async function newLiveSession(input: {
  id?: string
  title?: string
  cwd?: string
  providerProfileId?: string
  reasoningEffort?: ReasoningEffort
  approvalMode?: ApprovalMode
  parentSessionId?: string
  delegationDepth?: number
  assemblyGenerationId?: string
  assemblyOverride?: AgentAssemblyFactory
} = {}): Promise<WorkbenchSession> {
  const assemblyGenerationId = input.assemblyGenerationId ?? await studio?.activeGenerationId()
  if (assemblyGenerationId !== undefined
    && studio !== undefined
    && !await studio.hasGeneration(assemblyGenerationId)) {
    throw new Error(`Unknown assembly generation ${assemblyGenerationId}`)
  }
  const profile = input.assemblyOverride === undefined
    ? input.providerProfileId === undefined
      ? providerStore.default()
      : providerStore.get(input.providerProfileId)
    : undefined
  if (input.assemblyOverride === undefined) {
    if (profile === undefined) throw new Error(`Unknown provider profile ${input.providerProfileId}`)
    if (!profile.configured) throw new Error(`Provider profile ${profile.id} is not configured`)
    if (input.reasoningEffort !== undefined
      && !profile.reasoningEfforts?.includes(input.reasoningEffort)) {
      throw new Error(`Provider profile ${profile.id} does not support reasoning effort ${input.reasoningEffort}`)
    }
  }
  const reasoningEffort = input.reasoningEffort ?? profile?.defaultReasoningEffort
  const approvalMode = input.approvalMode ?? 'ask'
  const id = input.id ?? `case2-${randomUUID().slice(0, 8)}`
  const delegationDepth = input.delegationDepth ?? 0
  const assembly = input.assemblyOverride
    ?? assemblyFor(profile!, reasoningEffort, approvalMode, { id, delegationDepth })
  await mkdir(sessionDirectory, { recursive: true })
  const descriptor = {
    id,
    title: input.title?.trim() || 'New coding session',
    cwd: input.cwd?.trim() || defaultCwd,
    journalPath: join(sessionDirectory, `${id}.jsonl`),
    assembly: assembly.id,
    ...(assemblyGenerationId === undefined
      ? {}
      : { assemblyGenerationId }),
    model: assembly.model,
    ...(profile === undefined ? {} : { providerProfileId: profile.id }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    approvalMode,
    ...(input.parentSessionId === undefined ? {} : { parentSessionId: input.parentSessionId }),
    delegationDepth,
  }
  const session = await createLiveSession({ ...descriptor, assembly })
  await saveSessionDescriptor(sessionDirectory, descriptor)
  return session
}

function mockStudioProvider(): LlmProvider {
  let request = 0
  return {
    async generate() {
      request += 1
      return request === 1
        ? {
          generated: {
            toolCalls: [{ id: 'mock-pwd', name: 'bash', arguments: { command: 'pwd' } }],
          },
          usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, contextWindow: 32_768 },
        }
        : {
          generated: { content: 'Mock CASE2 run inspected the workspace and completed.', toolCalls: [] },
          usage: { inputTokens: 160, outputTokens: 16, totalTokens: 176, contextWindow: 32_768 },
        }
    },
  }
}

function waitUntilIdle(session: WorkbenchSession): Promise<void> {
  return new Promise(resolve => {
    const unsubscribe = session.subscribe?.(event => {
      if (event.kind !== 'state.changed' || event.runState !== 'idle') return
      unsubscribe?.()
      resolve()
    })
    if (unsubscribe === undefined) resolve()
  })
}

async function createStudioRunSession(input: StudioRunInput): Promise<WorkbenchSession> {
  const session = input.mode === 'mock'
    ? await newLiveSession({
      id: input.id,
      title: input.title,
      cwd: input.workspace,
      assemblyGenerationId: input.generationId,
      approvalMode: 'auto',
      delegationDepth: 0,
      assemblyOverride: case2AssemblyFactory({
        llm: mockStudioProvider(),
        model: 'deterministic-mock',
        approvalMode: 'auto',
      }),
    })
    : await newLiveSession({
      id: input.id,
      title: input.title,
      cwd: input.workspace,
      assemblyGenerationId: input.generationId,
      ...(input.providerProfileId === undefined ? {} : { providerProfileId: input.providerProfileId }),
      ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
      approvalMode: 'ask',
      delegationDepth: 0,
    })
  registry.add(session)
  const idle = input.mode === 'mock' ? waitUntilIdle(session) : undefined
  session.submit?.(input.prompt)
  await idle
  return session
}

async function runSubagent(input: {
  readonly task: string
  readonly cwd: string
  readonly model?: string
  readonly reasoningEffort?: ReasoningEffort
  readonly parentSessionId: string
  readonly parentProfile: ProviderProfile
  readonly parentReasoningEffort?: ReasoningEffort
  readonly approvalMode: ApprovalMode
}): Promise<{ summary: string; sessionId: string }> {
  const profile = input.model === undefined
    ? input.parentProfile
    : providerStore.get(input.model)
      ?? providerStore.list().find(candidate => candidate.configured && candidate.model === input.model)
  if (profile === undefined || !profile.configured) {
    throw new Error(`No configured provider profile or model matches ${input.model}`)
  }
  const reasoningEffort = input.reasoningEffort
    ?? (profile.id === input.parentProfile.id
      ? input.parentReasoningEffort
      : profile.defaultReasoningEffort)
  const child = await newLiveSession({
    title: `Subagent · ${input.task.slice(0, 60)}`,
    cwd: input.cwd,
    providerProfileId: profile.id,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    approvalMode: input.approvalMode,
    parentSessionId: input.parentSessionId,
    delegationDepth: 1,
  })
  return await runSubagentSession(child, registry, input.task)
}

for (const session of configuredStoredSessions()) registry.add(storedSession(session))
for (const descriptor of await loadSessionDescriptors(sessionDirectory)) {
  if (registry.get(descriptor.id) !== undefined) continue
  const profile = profileForDescriptor(descriptor)
  registry.add(profile === undefined || !profile.configured
    ? storedSession(descriptor)
    : await createLiveSession({
      ...descriptor,
      providerProfileId: profile.id,
      ...(descriptor.assemblyGenerationId === undefined
        ? {}
        : { assemblyGenerationId: descriptor.assemblyGenerationId }),
      assembly: assemblyFor(profile, descriptor.reasoningEffort, descriptor.approvalMode, {
        id: descriptor.id,
        delegationDepth: descriptor.delegationDepth ?? 0,
      }),
    }))
}

const studioDirectory = process.env['KNOT_STUDIO_DIR']
  ?? join(dirname(sessionDirectory), 'studio')
studio = await createStudioController({
  directory: studioDirectory,
  defaultWorkspace: defaultCwd,
  session: id => registry.get(id),
  createRunSession: createStudioRunSession,
})
if (configuredJournal !== undefined) {
  if (registry.get('case2-main') === undefined) {
    const profile = providerStore.default()
    registry.add(profile === undefined
      ? storedSession({
        id: 'case2-main',
        title: 'CASE2 coding session',
        assembly: 'case2',
        journalPath: configuredJournal,
        workspace: defaultCwd,
      })
      : await createLiveSession({
        id: 'case2-main',
        title: 'CASE2 coding session',
        cwd: defaultCwd,
        journalPath: configuredJournal,
        providerProfileId: profile.id,
        reasoningEffort: profile.defaultReasoningEffort,
        approvalMode: 'ask',
        delegationDepth: 0,
        assembly: assemblyFor(profile, profile.defaultReasoningEffort, 'ask', {
          id: 'case2-main',
          delegationDepth: 0,
        }),
      }))
  }
}
if (registry.list().length === 0 && providerStore.default() !== undefined) registry.add(await newLiveSession({
  title: 'CASE2 coding session',
  assemblyGenerationId: await studio.activeGenerationId(),
}))

const port = Number(process.env['KNOT_WORKBENCH_PORT'] ?? '4317')
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new Error('KNOT_WORKBENCH_PORT must be an integer between 0 and 65535')
}

const server = createWorkbenchServer({
  sessions: [],
  sessionRegistry: registry,
  providerProfiles: () => providerStore.list().map(publicProviderProfile),
  createProviderProfile: input => providerStore.add(input),
  studio,
  createSession: newLiveSession,
  webRoot: process.env['KNOT_WEB_ROOT'] ?? join(process.cwd(), 'web', 'dist'),
})
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Knot workbench: http://127.0.0.1:${port}\n`)
  process.stdout.write(`Sessions: ${registry.list().map(session => session.id).join(', ')}\n`)
})
