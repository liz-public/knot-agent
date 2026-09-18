import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { openAiLlmProvider } from '../cases/case1/llm-openai.js'
import { case2AssemblyFactory } from './case2-assembly.js'
import { createWorkbenchServer } from './http-server.js'
import { createLiveSession } from './live-session.js'
import type { WorkbenchSession } from './session.js'
import { loadSessionDescriptors, saveSessionDescriptor } from './session-catalog.js'
import { storedSession, type StoredSessionConfig } from './stored-session.js'

function configuredStoredSessions(): readonly StoredSessionConfig[] {
  const value = process.env['KNOT_WORKBENCH_SESSIONS']
  if (value === undefined) return []
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed)) throw new Error('KNOT_WORKBENCH_SESSIONS must be a JSON array')
  return parsed as StoredSessionConfig[]
}

const baseUrl = process.env['KNOT_BASE_URL']
const model = process.env['KNOT_MODEL']
if ((baseUrl === undefined) !== (model === undefined)) {
  throw new Error('KNOT_BASE_URL and KNOT_MODEL must be configured together')
}

const llm = baseUrl === undefined || model === undefined
  ? undefined
  : openAiLlmProvider({
    baseUrl,
    model,
    ...(process.env['KNOT_API_KEY'] === undefined ? {} : { apiKey: process.env['KNOT_API_KEY'] }),
    ...(process.env['KNOT_REQUEST_EXTRA_JSON'] === undefined
      ? {}
      : { extraBody: JSON.parse(process.env['KNOT_REQUEST_EXTRA_JSON']) as Record<string, unknown> }),
    ...(process.env['KNOT_CONTEXT_WINDOW'] === undefined
      ? {}
      : { contextWindow: Number(process.env['KNOT_CONTEXT_WINDOW']) }),
  })
const liveAssembly = llm === undefined || model === undefined
  ? undefined
  : case2AssemblyFactory({ llm, model })

const defaultCwd = process.env['KNOT_CWD'] ?? process.cwd()
const configuredJournal = process.env['KNOT_JOURNAL_PATH']
const sessionDirectory = process.env['KNOT_WORKBENCH_SESSION_DIR']
  ?? (configuredJournal === undefined ? join(defaultCwd, '.knot', 'sessions') : dirname(configuredJournal))

async function newLiveSession(input: { title?: string; cwd?: string } = {}): Promise<WorkbenchSession> {
  if (liveAssembly === undefined) throw new Error('A model must be configured to create a live session')
  const id = `case2-${randomUUID().slice(0, 8)}`
  await mkdir(sessionDirectory, { recursive: true })
  const descriptor = {
    id,
    title: input.title?.trim() || 'New coding session',
    cwd: input.cwd?.trim() || defaultCwd,
    journalPath: join(sessionDirectory, `${id}.jsonl`),
    assembly: liveAssembly.id,
    model: liveAssembly.model,
  }
  const session = await createLiveSession({ ...descriptor, assembly: liveAssembly })
  await saveSessionDescriptor(sessionDirectory, descriptor)
  return session
}

const sessions: WorkbenchSession[] = configuredStoredSessions().map(session => storedSession(session))
for (const descriptor of await loadSessionDescriptors(sessionDirectory)) {
  if (sessions.some(session => session.id === descriptor.id)) continue
  sessions.push(liveAssembly === undefined
    ? storedSession(descriptor)
    : await createLiveSession({ ...descriptor, assembly: liveAssembly }))
}
if (configuredJournal !== undefined) {
  if (!sessions.some(session => session.id === 'case2-main')) {
    sessions.unshift(liveAssembly === undefined
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
        assembly: liveAssembly,
      }))
  }
}
if (sessions.length === 0 && llm === undefined) {
  throw new Error('Configure KNOT_JOURNAL_PATH, KNOT_WORKBENCH_SESSIONS, or an LLM')
}
if (sessions.length === 0) sessions.push(await newLiveSession({ title: 'CASE2 coding session' }))

const port = Number(process.env['KNOT_WORKBENCH_PORT'] ?? '4317')
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  throw new Error('KNOT_WORKBENCH_PORT must be an integer between 0 and 65535')
}

const server = createWorkbenchServer({
  sessions,
  ...(llm === undefined ? {} : { createSession: newLiveSession }),
  webRoot: process.env['KNOT_WEB_ROOT'] ?? join(process.cwd(), 'web', 'dist'),
})
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Knot workbench: http://127.0.0.1:${port}\n`)
  process.stdout.write(`Sessions: ${sessions.map(session => session.id).join(', ')}\n`)
})
