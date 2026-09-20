import { createHash } from 'node:crypto'
import type { PluginMetadata } from '../assembly-definition.js'
import { case1PluginMetadata } from '../cases/case1/plugin-definitions.js'
import { CASE1_SYSTEM_PROMPT } from '../cases/case1/system-prompt.js'
import { case1ToolDefinitions } from '../cases/case1/tool-definitions.js'
import type { LlmProvider } from '../cases/case1/llm.js'
import { case2PluginMetadata } from '../cases/case2/plugin-definitions.js'
import { CASE2_SYSTEM_PROMPT } from '../cases/case2/system-prompt.js'
import type { SubagentFactory } from '../cases/case2/subagent-tool.js'
import { case2ToolDefinitions } from '../cases/case2/tool-definitions.js'
import { JSONL_STORE_METADATA } from '../plugins/jsonl.js'
import type { AgentAssemblyFactory } from './assembly.js'
import { case1AssemblyFactory } from './case1-assembly.js'
import { case2AssemblyFactory } from './case2-assembly.js'
import { JOURNAL_CHANGE_METADATA } from './journal-bridge.js'
import type { ApprovalMode } from './session.js'

export interface AssemblyToolDescription {
  readonly name: string
  readonly description: string
}

export interface AssemblyDescription {
  readonly id: string
  readonly title: string
  readonly systemPrompt: string
  readonly plugins: readonly PluginMetadata[]
  readonly tools: readonly AssemblyToolDescription[]
  readonly protocols: readonly string[]
  readonly fingerprint: string
}

export interface AssemblyBuildOptions {
  readonly llm: LlmProvider
  readonly model: string
  readonly approvalMode?: ApprovalMode
  readonly subagentFactory?: SubagentFactory
}

export interface WorkbenchAssemblyDefinition {
  readonly description: AssemblyDescription
  create(options: AssemblyBuildOptions): AgentAssemblyFactory
}

export interface AssemblyCatalog {
  list(): readonly WorkbenchAssemblyDefinition[]
  get(id: string): WorkbenchAssemblyDefinition | undefined
}

function toolsFrom(definitions: readonly { schema: Readonly<Record<string, unknown>> }[]): readonly AssemblyToolDescription[] {
  return definitions.map(definition => {
    const fn = definition.schema['function'] as Record<string, unknown>
    return {
      name: String(fn['name']),
      description: typeof fn['description'] === 'string' ? fn['description'] : '',
    }
  })
}

function describe(input: Omit<AssemblyDescription, 'protocols' | 'fingerprint'>): AssemblyDescription {
  const protocols = [...new Set(input.plugins.flatMap(plugin => [...plugin.listens, ...plugin.emits]))]
    .filter(protocol => protocol !== '*')
    .sort()
  const source = { ...input, protocols }
  return {
    ...source,
    fingerprint: createHash('sha256').update(JSON.stringify(source)).digest('hex').slice(0, 16),
  }
}

const platform = [JSONL_STORE_METADATA, JOURNAL_CHANGE_METADATA]

function case1Definition(): WorkbenchAssemblyDefinition {
  const toolSet = case1ToolDefinitions()
  return {
    description: describe({
      id: 'case1',
      title: 'CASE1 mobile assistant',
      systemPrompt: CASE1_SYSTEM_PROMPT,
      plugins: case1PluginMetadata(platform),
      tools: toolsFrom(toolSet.tools),
    }),
    create: options => case1AssemblyFactory(options),
  }
}

function case2Definition(): WorkbenchAssemblyDefinition {
  const tools = case2ToolDefinitions({
    cwd: '/',
    askPort: { ask: async () => ({ answer: '' }) },
    subagentFactory: { run: async () => ({ summary: '' }) },
  })
  return {
    description: describe({
      id: 'case2',
      title: 'CASE2 coding agent',
      systemPrompt: CASE2_SYSTEM_PROMPT,
      plugins: case2PluginMetadata(platform),
      tools: toolsFrom(tools),
    }),
    create: options => case2AssemblyFactory(options),
  }
}

export function createAssemblyCatalog(
  definitions: readonly WorkbenchAssemblyDefinition[] = [case1Definition(), case2Definition()],
): AssemblyCatalog {
  const byId = new Map(definitions.map(definition => [definition.description.id, definition]))
  if (byId.size !== definitions.length) throw new Error('duplicate assembly id')
  return {
    list: () => definitions,
    get: id => byId.get(id),
  }
}
