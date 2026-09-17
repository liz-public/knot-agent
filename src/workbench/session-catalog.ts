import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface LiveSessionDescriptor {
  readonly id: string
  readonly title: string
  readonly cwd: string
  readonly journalPath: string
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
