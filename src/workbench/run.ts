import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { case2AssemblyFactory } from './case2-assembly.js'
import { createWorkbenchServer } from './http-server.js'
import { createLiveSession } from './live-session.js'
import {
  providerProfilesFromEnvironment,
  publicProviderProfile,
  type ProviderProfile,
} from './provider-profile.js'
import type { ApprovalMode, ReasoningEffort, WorkbenchSession } from './session.js'
import { loadSessionDescriptors, saveSessionDescriptor } from './session-catalog.js'
import { createSessionRegistry } from './session-registry.js'
import { storedSession, type StoredSessionConfig } from './stored-session.js'
import { runSubagentSession } from './subagent-session.js'

function configuredStoredSessions(): readonly StoredSessionConfig[] {
  const value = process.env['KNOT_WORKBENCH_SESSIONS']
  if (value === undefined) return []
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed)) throw new Error('KNOT_WORKBENCH_SESSIONS must be a JSON array')
  return parsed as StoredSessionConfig[]
}

const providerProfiles = providerProfilesFromEnvironment(process.env)
const profilesById = new Map(providerProfiles.map(profile => [profile.id, profile]))
const defaultProfile = providerProfiles.find(profile => profile.configured)
const registry = createSessionRegistry()

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
  if (input.providerProfileId !== undefined) return profilesById.get(input.providerProfileId)
  return providerProfiles.find(profile => profile.configured && profile.model === input.model)
    ?? defaultProfile
}

const defaultCwd = process.env['KNOT_CWD'] ?? process.cwd()
const configuredJournal = process.env['KNOT_JOURNAL_PATH']
const sessionDirectory = process.env['KNOT_WORKBENCH_SESSION_DIR']
  ?? (configuredJournal === undefined ? join(defaultCwd, '.knot', 'sessions') : dirname(configuredJournal))

async function newLiveSession(input: {
  title?: string
  cwd?: string
  providerProfileId?: string
  reasoningEffort?: ReasoningEffort
  approvalMode?: ApprovalMode
  parentSessionId?: string
  delegationDepth?: number
} = {}): Promise<WorkbenchSession> {
  const profile = input.providerProfileId === undefined
    ? defaultProfile
    : profilesById.get(input.providerProfileId)
  if (profile === undefined) throw new Error(`Unknown provider profile ${input.providerProfileId}`)
  if (!profile.configured) throw new Error(`Provider profile ${profile.id} is not configured`)
  if (input.reasoningEffort !== undefined
    && !profile.reasoningEfforts?.includes(input.reasoningEffort)) {
    throw new Error(`Provider profile ${profile.id} does not support reasoning effort ${input.reasoningEffort}`)
  }
  const reasoningEffort = input.reasoningEffort ?? profile.defaultReasoningEffort
  const approvalMode = input.approvalMode ?? 'ask'
  const id = `case2-${randomUUID().slice(0, 8)}`
  const delegationDepth = input.delegationDepth ?? 0
  const assembly = assemblyFor(profile, reasoningEffort, approvalMode, { id, delegationDepth })
  await mkdir(sessionDirectory, { recursive: true })
  const descriptor = {
    id,
    title: input.title?.trim() || 'New coding session',
    cwd: input.cwd?.trim() || defaultCwd,
    journalPath: join(sessionDirectory, `${id}.jsonl`),
    assembly: assembly.id,
    model: assembly.model,
    providerProfileId: profile.id,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    approvalMode,
    ...(input.parentSessionId === undefined ? {} : { parentSessionId: input.parentSessionId }),
    delegationDepth,
  }
  const session = await createLiveSession({ ...descriptor, assembly })
  await saveSessionDescriptor(sessionDirectory, descriptor)
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
    : profilesById.get(input.model)
      ?? providerProfiles.find(candidate => candidate.configured && candidate.model === input.model)
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
      assembly: assemblyFor(profile, descriptor.reasoningEffort, descriptor.approvalMode, {
        id: descriptor.id,
        delegationDepth: descriptor.delegationDepth ?? 0,
      }),
    }))
}
if (configuredJournal !== undefined) {
  if (registry.get('case2-main') === undefined) {
    registry.add(defaultProfile === undefined
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
        providerProfileId: defaultProfile.id,
        reasoningEffort: defaultProfile.defaultReasoningEffort,
        approvalMode: 'ask',
        delegationDepth: 0,
        assembly: assemblyFor(defaultProfile, defaultProfile.defaultReasoningEffort, 'ask', {
          id: 'case2-main',
          delegationDepth: 0,
        }),
      }))
  }
}
if (registry.list().length === 0 && defaultProfile === undefined) {
  throw new Error('Configure KNOT_JOURNAL_PATH, KNOT_WORKBENCH_SESSIONS, or an LLM')
}
if (registry.list().length === 0) registry.add(await newLiveSession({ title: 'CASE2 coding session' }))

const port = Number(process.env['KNOT_WORKBENCH_PORT'] ?? '4317')
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new Error('KNOT_WORKBENCH_PORT must be an integer between 0 and 65535')
}

const server = createWorkbenchServer({
  sessions: [],
  sessionRegistry: registry,
  providerProfiles: providerProfiles.map(publicProviderProfile),
  ...(defaultProfile === undefined ? {} : { createSession: newLiveSession }),
  webRoot: process.env['KNOT_WEB_ROOT'] ?? join(process.cwd(), 'web', 'dist'),
})
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Knot workbench: http://127.0.0.1:${port}\n`)
  process.stdout.write(`Sessions: ${registry.list().map(session => session.id).join(', ')}\n`)
})
