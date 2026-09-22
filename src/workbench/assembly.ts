import { createHash } from 'node:crypto'
import type {
  PluginInspection,
  PluginMetadata,
  PluginNode,
  PluginToolDescription,
} from '../assembly-definition.js'
import type { LlmProvider } from '../cases/case1/llm.js'
import type { SubagentFactory } from '../cases/case2/subagent-tool.js'
import type { ApprovalMode } from './session.js'

export interface GenerationOutput {
  open(meta: { readonly requestId: string; readonly turnId: string; readonly purpose: string }): {
    write(update: unknown): void | Promise<void>
    close(): void | Promise<void>
  } | undefined
}

export interface HostApprovalPort {
  request(input: {
    readonly toolName: string
    readonly arguments: Readonly<Record<string, unknown>>
  }): Promise<'allow' | 'deny'>
}

export interface HostAskPort {
  ask(input: {
    readonly question: string
    readonly choices?: readonly string[]
  }): Promise<{ readonly answer: string }>
}

export interface ToolOutput {
  open(meta: {
    readonly turnId: string
    readonly callId: string
    readonly toolName: string
    readonly command: string
  }): {
    write(update: { readonly stream: 'stdout' | 'stderr'; readonly text: string }): void | Promise<void>
    close(result: { readonly exitCode: number }): void | Promise<void>
  } | undefined
}

export interface SessionRuntime {
  submit(content: string): Promise<void>
  steer(content: string): void
  pause(): void
  resume(): void
  status(): 'idle' | 'running' | 'paused'
}

export interface AssemblyInput {
  readonly cwd: string
  readonly journalPath: string
  readonly liveOutput: GenerationOutput
  readonly toolOutput: ToolOutput
  readonly approvalPort: HostApprovalPort
  readonly askPort: HostAskPort
  readonly platformPlugins: readonly PluginNode[]
}

export interface AgentAssemblyFactory {
  readonly id: string
  readonly model: string
  create(input: AssemblyInput): Promise<SessionRuntime>
}

export interface AssemblyPluginDeclaration {
  readonly metadata: PluginMetadata
  readonly inspect?: () => PluginInspection
}

export interface AssemblyDescription {
  readonly id: string
  readonly title: string
  /** Compatibility projection derived from plugin declarations; never an authoring source. */
  readonly systemPrompt: string
  readonly plugins: readonly PluginMetadata[]
  readonly tools: readonly PluginToolDescription[]
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

export function defineAssembly(input: {
  readonly id: string
  readonly title: string
  readonly plugins?: readonly AssemblyPluginDeclaration[]
  create(options: AssemblyBuildOptions): AgentAssemblyFactory
}): WorkbenchAssemblyDefinition {
  const declarations = input.plugins ?? []
  const plugins = declarations.map(item => item.metadata)
  const pluginIds = plugins.map(plugin => plugin.id)
  if (new Set(pluginIds).size !== pluginIds.length) throw new Error(`duplicate plugin id in ${input.id}`)

  const inspections = declarations.flatMap(item => item.inspect?.() ?? [])
  const systemPrompt = inspections.flatMap(item => item.systemPrompts ?? []).join('\n\n')
  const tools = inspections.flatMap(item => item.tools ?? [])
  const toolNames = tools.map(tool => tool.name)
  if (new Set(toolNames).size !== toolNames.length) throw new Error(`duplicate tool name in ${input.id}`)

  const protocols = [...new Set(plugins.flatMap(plugin => [...plugin.listens, ...plugin.emits]))]
    .filter(protocol => protocol !== '*')
    .sort()
  const source = { id: input.id, title: input.title, systemPrompt, plugins, tools, protocols }
  const description = {
    ...source,
    fingerprint: createHash('sha256').update(JSON.stringify(source)).digest('hex').slice(0, 16),
  }
  return { description, create: input.create }
}
