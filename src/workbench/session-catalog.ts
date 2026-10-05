import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionMetadata, WorkbenchSession } from './session.js'

export interface LiveSessionDescriptor extends SessionMetadata {
  readonly id: string
  readonly projectId?: string
  readonly cwd: string
  readonly journalPath: string
  readonly assembly: string
  readonly parentSessionId?: string
  readonly delegationDepth?: number
}

function descriptor(value: unknown, file: string): LiveSessionDescriptor {
  if (typeof value !== 'object' || value === null) throw new Error(`invalid session descriptor ${file}`)
  const item = value as Record<string, unknown>
  if (
    typeof item['id'] !== 'string'
    || typeof item['title'] !== 'string'
    || typeof item['cwd'] !== 'string'
    || typeof item['journalPath'] !== 'string'
  ) throw new Error(`invalid session descriptor ${file}`)
  return {
    id: item['id'],
    title: item['title'],
    ...(typeof item['titleVersion'] === 'number' ? { titleVersion: item['titleVersion'] } : {}),
    ...(item['archived'] === true ? { archived: true } : {}),
    ...(typeof item['pinnedAt'] === 'number' && item['pinnedAt'] > 0 ? { pinnedAt: item['pinnedAt'] } : {}),
    projectId: typeof item['projectId'] === 'string'
      ? item['projectId']
      : typeof item['assembly'] === 'string' ? item['assembly'] : 'case2',
    cwd: item['cwd'],
    journalPath: item['journalPath'],
    assembly: typeof item['assembly'] === 'string' ? item['assembly'] : 'case2',
    ...(typeof item['parentSessionId'] === 'string'
      ? { parentSessionId: item['parentSessionId'] }
      : {}),
    ...(typeof item['delegationDepth'] === 'number' && Number.isInteger(item['delegationDepth']) && item['delegationDepth'] >= 0
      ? { delegationDepth: item['delegationDepth'] }
      : {}),
  }
}

export async function loadSessionDescriptors(directory: string): Promise<readonly LiveSessionDescriptor[]> {
  let files: string[]
  try {
    files = await readdir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return await Promise.all(files
    .filter(file => file.endsWith('.session.json'))
    .sort()
    .map(async file => descriptor(JSON.parse(await readFile(join(directory, file), 'utf8')) as unknown, file)))
}

export async function saveSessionDescriptor(
  directory: string,
  value: LiveSessionDescriptor,
  replace = false,
): Promise<void> {
  await mkdir(directory, { recursive: true })
  const stored: LiveSessionDescriptor = {
    id: value.id,
    title: value.title,
    ...(value.titleVersion === undefined ? {} : { titleVersion: value.titleVersion }),
    ...(value.archived ? { archived: true } : {}),
    ...(value.pinnedAt ? { pinnedAt: value.pinnedAt } : {}),
    ...(value.projectId === undefined ? {} : { projectId: value.projectId }),
    cwd: value.cwd,
    journalPath: value.journalPath,
    assembly: value.assembly,
    ...(value.parentSessionId === undefined ? {} : { parentSessionId: value.parentSessionId }),
    ...(value.delegationDepth === undefined ? {} : { delegationDepth: value.delegationDepth }),
  }
  const path = join(directory, `${value.id}.session.json`)
  await writeFile(replace ? path + '.tmp' : path, `${JSON.stringify(stored, null, 2)}\n`, {
    encoding: 'utf8',
    flag: replace ? 'w' : 'wx',
  })
  if (replace) await rename(path + '.tmp', path)
}

/** Host-owned product metadata; never reconfigure or restart the underlying agent. */
export function sessionWithMetadata(
  directory: string, initial: LiveSessionDescriptor, session: WorkbenchSession,
): WorkbenchSession {
  let current = initial
  let writing = Promise.resolve()
  const metadata = (): SessionMetadata => ({ title: current.title,
    ...(current.titleVersion === undefined ? {} : { titleVersion: current.titleVersion }),
    archived: current.archived === true, pinnedAt: current.pinnedAt ?? 0 })
  return {
    ...session,
    summary: async () => ({ ...await session.summary(), ...metadata() }),
    snapshot: async () => {
      const snapshot = await session.snapshot()
      return { ...snapshot, session: { ...snapshot.session, ...metadata() } }
    },
    updateMetadata(patch) {
      const update = writing.then(async () => {
        const next = { ...current, ...patch }
        if (next.archived && next.pinnedAt) throw new Error('Archived sessions cannot be pinned')
        if (next.title !== current.title) next.titleVersion = Math.max(Date.now(), (current.titleVersion ?? 0) + 1)
        if (next.title === current.title && !!next.archived === !!current.archived
          && (next.pinnedAt ?? 0) === (current.pinnedAt ?? 0)) return
        await saveSessionDescriptor(directory, next, true)
        current = next
      })
      writing = update.catch(() => {})
      return update
    },
  }
}
