import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ApprovalMode, ReasoningEffort } from './session.js'

export interface LiveSessionDescriptor {
  readonly id: string
  readonly title: string
  readonly cwd: string
  readonly journalPath: string
  readonly assembly: string
  readonly assemblyGenerationId?: string
  readonly model?: string
  readonly providerProfileId?: string
  readonly reasoningEffort?: ReasoningEffort
  readonly approvalMode?: ApprovalMode
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
    cwd: item['cwd'],
    journalPath: item['journalPath'],
    assembly: typeof item['assembly'] === 'string' ? item['assembly'] : 'case2',
    ...(typeof item['assemblyGenerationId'] === 'string'
      ? { assemblyGenerationId: item['assemblyGenerationId'] }
      : {}),
    ...(typeof item['model'] === 'string' ? { model: item['model'] } : {}),
    ...(typeof item['providerProfileId'] === 'string'
      ? { providerProfileId: item['providerProfileId'] }
      : {}),
    ...(['none', 'low', 'high', 'max'].includes(String(item['reasoningEffort']))
      ? { reasoningEffort: item['reasoningEffort'] as ReasoningEffort }
      : {}),
    ...(['ask', 'auto'].includes(String(item['approvalMode']))
      ? { approvalMode: item['approvalMode'] as ApprovalMode }
      : {}),
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
): Promise<void> {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, `${value.id}.session.json`), `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  })
}
