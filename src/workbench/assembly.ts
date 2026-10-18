import type { ApprovalPort, AskPort } from '../agent/interactions.js'
import type { ToolOutput } from '../cases/case2/command-process.js'
import type {
  PluginInspection,
  PluginMetadata,
  PluginNode,
  PluginToolDescription,
} from '../assembly-definition.js'
import type { LiveOutput, LlmProviderSource } from '../agent/plugins/llm.js'
import type { SessionConfiguration } from '../agent/session-configuration.js'
import type { AttachmentRef } from '../agent/protocol.js'
import type { SubagentFactory } from '../cases/case2/subagent-tool.js'

export interface SessionRuntime {
  submit(content: string, configuration?: SessionConfiguration, attachments?: readonly AttachmentRef[]): Promise<void>
  steer(content: string, attachments?: readonly AttachmentRef[]): void
  pause(): void
  resume(): void
  status(): 'idle' | 'running' | 'paused'
  rename?(title: string): Promise<void>
  /** Release optional external execution resources; never called by pause or idle. */
  close?(): Promise<void>
}

export interface AssemblyInput {
  readonly devicePort?: import('../device/port.js').DevicePort
  readonly cwd: string
  readonly journalPath: string
  readonly llm: LlmProviderSource
  readonly liveOutput: LiveOutput
  readonly toolOutput: ToolOutput
  readonly approvalPort: ApprovalPort
  readonly askPort: AskPort
  readonly platformPlugins: readonly PluginNode[]
  readonly subagentFactory?: SubagentFactory
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
}

export interface WorkbenchAssemblyDefinition {
  readonly description: AssemblyDescription
  create(input: AssemblyInput): Promise<SessionRuntime>
}

export function defineAssembly(input: {
  readonly id: string
  readonly title: string
  readonly plugins?: readonly AssemblyPluginDeclaration[]
  create(input: AssemblyInput): Promise<SessionRuntime>
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
  const description = { id: input.id, title: input.title, systemPrompt, plugins, tools, protocols }
  return { description, create: input.create }
}
