import { deepSeekLlmProvider } from '../cases/case1/llm-deepseek.js'
import type { LlmProvider } from '../cases/case1/llm.js'
import { openAiLlmProvider } from '../cases/case1/llm-openai.js'
import type { ReasoningEffort } from './session.js'

export type ProviderAdapter = 'openai-compatible' | 'deepseek'

export interface ProviderProfileSummary {
  readonly id: string
  readonly label: string
  readonly adapter: ProviderAdapter
  readonly model: string
  readonly configured: boolean
  readonly editable?: boolean
  readonly reasoningEfforts?: readonly ReasoningEffort[]
  readonly defaultReasoningEffort?: ReasoningEffort
  readonly baseUrl?: string
  readonly contextWindow?: number
  readonly hasApiKey?: boolean
  readonly isDefault?: boolean
}

export interface ProviderProfile extends ProviderProfileSummary {
  create(options?: { readonly reasoningEffort?: ReasoningEffort }): LlmProvider
}

function optionalNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be a positive number`)
  return number
}

function jsonObject(value: string | undefined, name: string): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined
  const parsed = JSON.parse(value) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object`)
  }
  return parsed as Readonly<Record<string, unknown>>
}

function unavailable(summary: Omit<ProviderProfileSummary, 'configured'>): ProviderProfile {
  return {
    ...summary,
    configured: false,
    create() { throw new Error(`Provider profile ${summary.id} is not configured`) },
  }
}

export function providerProfilesFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): readonly ProviderProfile[] {
  const profiles: ProviderProfile[] = []
  const baseUrl = environment['KNOT_BASE_URL']
  const model = environment['KNOT_MODEL']
  if ((baseUrl === undefined) !== (model === undefined)) {
    throw new Error('KNOT_BASE_URL and KNOT_MODEL must be configured together')
  }
  if (baseUrl !== undefined && model !== undefined) {
    const contextWindow = optionalNumber(environment['KNOT_CONTEXT_WINDOW'], 'KNOT_CONTEXT_WINDOW')
    const extraBody = jsonObject(environment['KNOT_REQUEST_EXTRA_JSON'], 'KNOT_REQUEST_EXTRA_JSON')
    profiles.push({
      id: 'default',
      label: environment['KNOT_PROVIDER_LABEL'] ?? model,
      adapter: 'openai-compatible',
      model,
      configured: true,
      create: () => openAiLlmProvider({
        baseUrl,
        model,
        ...(environment['KNOT_API_KEY'] === undefined
          ? {}
          : { apiKey: environment['KNOT_API_KEY'] }),
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(extraBody === undefined ? {} : { extraBody }),
      }),
    })
  }

  const deepSeekModel = environment['KNOT_DEEPSEEK_MODEL'] ?? 'deepseek-flash'
  const deepSeekSummary = {
    id: 'deepseek',
    label: environment['KNOT_DEEPSEEK_LABEL'] ?? `DeepSeek · ${deepSeekModel}`,
    adapter: 'deepseek' as const,
    model: deepSeekModel,
    reasoningEfforts: ['none', 'low', 'high', 'max'] as const,
    defaultReasoningEffort: (environment['KNOT_DEEPSEEK_THINKING'] === 'disabled'
      ? 'none'
      : environment['KNOT_DEEPSEEK_REASONING_EFFORT'] ?? 'high') as ReasoningEffort,
  }
  const deepSeekKey = environment['DEEPSEEK_API_KEY']
  if (deepSeekKey === undefined || deepSeekKey.length === 0) {
    profiles.push(unavailable(deepSeekSummary))
  } else {
    const contextWindow = optionalNumber(
      environment['KNOT_DEEPSEEK_CONTEXT_WINDOW'],
      'KNOT_DEEPSEEK_CONTEXT_WINDOW',
    ) ?? 1_000_000
    const thinking = environment['KNOT_DEEPSEEK_THINKING']
    if (thinking !== undefined && thinking !== 'enabled' && thinking !== 'disabled') {
      throw new Error('KNOT_DEEPSEEK_THINKING must be enabled or disabled')
    }
    const effort = environment['KNOT_DEEPSEEK_REASONING_EFFORT']
    if (effort !== undefined && !['none', 'low', 'high', 'max'].includes(effort)) {
      throw new Error('KNOT_DEEPSEEK_REASONING_EFFORT must be none, low, high, or max')
    }
    profiles.push({
      ...deepSeekSummary,
      configured: true,
      create: options => {
        const selectedEffort = options?.reasoningEffort ?? deepSeekSummary.defaultReasoningEffort
        return deepSeekLlmProvider({
          apiKey: deepSeekKey,
          model: deepSeekModel,
          contextWindow,
          ...(environment['KNOT_DEEPSEEK_BASE_URL'] === undefined
            ? {}
            : { baseUrl: environment['KNOT_DEEPSEEK_BASE_URL'] }),
          thinking: selectedEffort === 'none' ? 'disabled' : 'enabled',
          ...(selectedEffort === 'none' ? {} : { reasoningEffort: selectedEffort }),
        })
      },
    })
  }
  return profiles
}

export function publicProviderProfile(profile: ProviderProfile): ProviderProfileSummary {
  const { create: _create, ...summary } = profile
  return summary
}
