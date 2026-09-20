import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { deepSeekLlmProvider } from '../cases/case1/llm-deepseek.js'
import { openAiLlmProvider } from '../cases/case1/llm-openai.js'
import type {
  ProviderAdapter,
  ProviderProfile,
  ProviderProfileSummary,
} from './provider-profile.js'
import type { ReasoningEffort } from './session.js'

export interface ProviderProfileDraft {
  readonly label: string
  readonly adapter: ProviderAdapter
  readonly baseUrl?: string
  readonly apiKey?: string
  readonly model: string
  readonly contextWindow?: number
  readonly defaultReasoningEffort?: ReasoningEffort
}

interface StoredProviderProfile extends ProviderProfileDraft {
  readonly id: string
}

interface ProviderFile {
  readonly profiles: readonly StoredProviderProfile[]
}

export interface ProviderProfileStore {
  list(): readonly ProviderProfile[]
  get(id: string): ProviderProfile | undefined
  default(): ProviderProfile | undefined
  add(draft: ProviderProfileDraft): Promise<ProviderProfileSummary>
}

function nonEmpty(value: string, name: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error(`${name} must not be empty`)
  return trimmed
}

function validate(draft: ProviderProfileDraft): Omit<StoredProviderProfile, 'id'> {
  const label = nonEmpty(draft.label, 'label')
  const model = nonEmpty(draft.model, 'model')
  const apiKey = draft.apiKey?.trim()
  const contextWindow = draft.contextWindow
  if (contextWindow !== undefined && (!Number.isInteger(contextWindow) || contextWindow <= 0)) {
    throw new Error('contextWindow must be a positive integer')
  }
  if (draft.adapter === 'openai-compatible') {
    return {
      label,
      adapter: draft.adapter,
      baseUrl: nonEmpty(draft.baseUrl ?? '', 'baseUrl'),
      model,
      ...(apiKey === undefined || apiKey.length === 0 ? {} : { apiKey }),
      ...(contextWindow === undefined ? {} : { contextWindow }),
    }
  }
  if (apiKey === undefined || apiKey.length === 0) throw new Error('apiKey is required for DeepSeek')
  const defaultReasoningEffort = draft.defaultReasoningEffort ?? 'high'
  return {
    label,
    adapter: draft.adapter,
    ...(draft.baseUrl === undefined || draft.baseUrl.trim().length === 0
      ? {}
      : { baseUrl: draft.baseUrl.trim() }),
    apiKey,
    model,
    contextWindow: contextWindow ?? 1_000_000,
    defaultReasoningEffort,
  }
}

function runtimeProfile(definition: StoredProviderProfile): ProviderProfile {
  if (definition.adapter === 'deepseek') {
    const effort = definition.defaultReasoningEffort ?? 'high'
    return {
      id: definition.id,
      label: definition.label,
      adapter: definition.adapter,
      model: definition.model,
      configured: true,
      editable: true,
      reasoningEfforts: ['none', 'low', 'high', 'max'],
      defaultReasoningEffort: effort,
      create: options => {
        const selected = options?.reasoningEffort ?? effort
        return deepSeekLlmProvider({
          apiKey: definition.apiKey!,
          model: definition.model,
          ...(definition.baseUrl === undefined ? {} : { baseUrl: definition.baseUrl }),
          ...(definition.contextWindow === undefined ? {} : { contextWindow: definition.contextWindow }),
          thinking: selected === 'none' ? 'disabled' : 'enabled',
          ...(selected === 'none' ? {} : { reasoningEffort: selected }),
        })
      },
    }
  }
  return {
    id: definition.id,
    label: definition.label,
    adapter: definition.adapter,
    model: definition.model,
    configured: true,
    editable: true,
    create: () => openAiLlmProvider({
      baseUrl: definition.baseUrl!,
      model: definition.model,
      ...(definition.apiKey === undefined ? {} : { apiKey: definition.apiKey }),
      ...(definition.contextWindow === undefined ? {} : { contextWindow: definition.contextWindow }),
    }),
  }
}

function parseFile(value: unknown): readonly StoredProviderProfile[] {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as ProviderFile).profiles)) {
    throw new Error('provider profile file must contain a profiles array')
  }
  return (value as ProviderFile).profiles.map(item => {
    if (typeof item !== 'object' || item === null || typeof item.id !== 'string') {
      throw new Error('provider profile file contains an invalid profile')
    }
    return { id: nonEmpty(item.id, 'id'), ...validate(item) }
  })
}

async function load(path: string): Promise<readonly StoredProviderProfile[]> {
  try {
    return parseFile(JSON.parse(await readFile(path, 'utf8')) as unknown)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function save(path: string, profiles: readonly StoredProviderProfile[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify({ profiles }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
}

export async function createProviderProfileStore(
  path: string,
  environmentProfiles: readonly ProviderProfile[],
): Promise<ProviderProfileStore> {
  let stored = await load(path)

  function profiles(): readonly ProviderProfile[] {
    return [...environmentProfiles, ...stored.map(runtimeProfile)]
  }

  return {
    list: profiles,
    get: id => profiles().find(profile => profile.id === id),
    default: () => profiles().find(profile => profile.configured),
    async add(draft) {
      const definition: StoredProviderProfile = {
        id: `provider-${randomUUID().slice(0, 8)}`,
        ...validate(draft),
      }
      const next = [...stored, definition]
      await save(path, next)
      stored = next
      const { create: _create, ...summary } = runtimeProfile(definition)
      return summary
    },
  }
}
