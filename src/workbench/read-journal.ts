import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'

export interface ReadEvent {
  readonly position: number
  readonly type: string
  readonly data: unknown
  readonly observedAt?: string
  readonly elapsedMs?: number
}

export interface JournalSnapshotDto {
  readonly source: {
    readonly name: string
    readonly readOnly: true
  }
  readonly eventCount: number
  readonly events: readonly ReadEvent[]
}

export type JournalReadErrorCode =
  | 'source_not_found'
  | 'invalid_jsonl'
  | 'source_too_large'
  | 'read_failed'

export class JournalReadError extends Error {
  constructor(
    readonly code: JournalReadErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export interface JournalReadLimits {
  readonly maxBytes?: number
  readonly maxEvents?: number
}

const defaultMaxBytes = 8 * 1024 * 1024
const defaultMaxEvents = 20_000

export async function readJournalSnapshot(
  path: string,
  limits: JournalReadLimits = {},
): Promise<JournalSnapshotDto> {
  const maxBytes = limits.maxBytes ?? defaultMaxBytes
  const maxEvents = limits.maxEvents ?? defaultMaxEvents

  let size: number
  try {
    size = (await stat(path)).size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new JournalReadError('source_not_found', 'Journal source was not found')
    }
    throw new JournalReadError('read_failed', 'Journal source could not be inspected')
  }
  if (size > maxBytes) {
    throw new JournalReadError(
      'source_too_large',
      `Journal source exceeds the ${maxBytes} byte read limit`,
    )
  }

  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    throw new JournalReadError('read_failed', 'Journal source could not be read')
  }

  const lines = text.length === 0 ? [] : text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  if (lines.length > maxEvents) {
    throw new JournalReadError(
      'source_too_large',
      `Journal source exceeds the ${maxEvents} event read limit`,
    )
  }

  let previousObservedAt: number | undefined
  const events: ReadEvent[] = lines.map((line, position) => {
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      throw new JournalReadError('invalid_jsonl', `Invalid JSONL at line ${position + 1}`)
    }
    if (
      typeof value !== 'object'
      || value === null
      || !('type' in value)
      || typeof value.type !== 'string'
      || !Object.hasOwn(value, 'data')
    ) {
      throw new JournalReadError(
        'invalid_jsonl',
        `Expected { type: string, data: ... } at line ${position + 1}`,
      )
    }
    const event = value as {
      type: string
      data: unknown
      meta?: { observedAt?: unknown }
    }
    const observedAt = typeof event.meta?.observedAt === 'string'
      && Number.isFinite(Date.parse(event.meta.observedAt))
      ? event.meta.observedAt
      : undefined
    const observedAtMs = observedAt === undefined ? undefined : Date.parse(observedAt)
    const elapsedMs = observedAtMs === undefined || previousObservedAt === undefined
      ? undefined
      : Math.max(0, observedAtMs - previousObservedAt)
    if (observedAtMs !== undefined) previousObservedAt = observedAtMs
    return {
      position,
      type: event.type,
      data: event.data,
      ...(observedAt === undefined ? {} : { observedAt }),
      ...(elapsedMs === undefined ? {} : { elapsedMs }),
    }
  })

  return {
    source: { name: basename(path), readOnly: true },
    eventCount: events.length,
    events,
  }
}
