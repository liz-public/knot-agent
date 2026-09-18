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
import { storedSession, type StoredSessionConfig } from './stored-session.js'

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

function assemblyFor(
  profile: ProviderProfile,
  reasoningEffort?: ReasoningEffort,
  approvalMode: ApprovalMode = 'ask',
) {
  return case2AssemblyFactory({
    llm: profile.create({ reasoningEffort }),
    model: profile.model,
    approvalMode,
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
  const assembly = assemblyFor(profile, reasoningEffort, approvalMode)
  const id = `case2-${randomUUID().slice(0, 8)}`
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
  }
  const session = await createLiveSession({ ...descriptor, assembly })
  await saveSessionDescriptor(sessionDirectory, descriptor)
  return session
}

const sessions: WorkbenchSession[] = configuredStoredSessions().map(session => storedSession(session))
for (const descriptor of await loadSessionDescriptors(sessionDirectory)) {
  if (sessions.some(session => session.id === descriptor.id)) continue
  const profile = profileForDescriptor(descriptor)
  sessions.push(profile === undefined || !profile.configured
    ? storedSession(descriptor)
    : await createLiveSession({
      ...descriptor,
      providerProfileId: profile.id,
      assembly: assemblyFor(profile, descriptor.reasoningEffort, descriptor.approvalMode),
    }))
}
if (configuredJournal !== undefined) {
  if (!sessions.some(session => session.id === 'case2-main')) {
    sessions.unshift(defaultProfile === undefined
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
        assembly: assemblyFor(defaultProfile, defaultProfile.defaultReasoningEffort, 'ask'),
      }))
  }
}
if (sessions.length === 0 && defaultProfile === undefined) {
  throw new Error('Configure KNOT_JOURNAL_PATH, KNOT_WORKBENCH_SESSIONS, or an LLM')
}
if (sessions.length === 0) sessions.push(await newLiveSession({ title: 'CASE2 coding session' }))

const port = Number(process.env['KNOT_WORKBENCH_PORT'] ?? '4317')
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new Error('KNOT_WORKBENCH_PORT must be an integer between 0 and 65535')
}

const server = createWorkbenchServer({
  sessions,
  providerProfiles: providerProfiles.map(publicProviderProfile),
  ...(defaultProfile === undefined ? {} : { createSession: newLiveSession }),
  webRoot: process.env['KNOT_WEB_ROOT'] ?? join(process.cwd(), 'web', 'dist'),
})
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Knot workbench: http://127.0.0.1:${port}\n`)
  process.stdout.write(`Sessions: ${sessions.map(session => session.id).join(', ')}\n`)
})
