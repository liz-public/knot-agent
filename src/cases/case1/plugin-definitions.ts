import {
  definePlugin,
  pluginTools,
  type PluginDefinition,
  type PluginMetadata,
  type PluginNode,
} from '../../assembly-definition.js'
import type { Event, Plugin } from '../../journal.js'
import { tracePlugin } from '../../plugins/trace.js'
import { agentFlowPlugin } from './agent-flow.js'
import { compressHistoryPlugin, type CompressHistoryOptions } from './compress-history.js'
import { contentPlugin, llmContentSource, type ContentSource } from './content.js'
import { contextAssemblerPlugin } from './context-assembler.js'
import type { CliCatalog } from './cli.js'
import { outputPlugin, type OutputSinks } from './output.js'
import { runtimeContextPlugin } from './runtime-context.js'
import { androidCallRule, androidFlashlightRule, shortcutSource } from './shortcuts.js'
import { CASE1_SYSTEM_PROMPT, systemPromptPlugin } from './system-prompt.js'
import { case1ToolDefinitions } from './tool-definitions.js'
import { toolsPlugin, type ToolDefinition } from './tools.js'

interface BuildContext {
  readonly boundary: Plugin
  readonly cli?: CliCatalog
  readonly compression?: CompressHistoryOptions
  readonly contentSources?: readonly ContentSource[]
  readonly llm: Plugin
  readonly now: () => Date
  readonly output?: OutputSinks
  readonly tools: readonly ToolDefinition[]
  readonly trace?: (event: Event) => void
}

const boundary = definePlugin<BuildContext>({
  metadata: { id: 'controlled-boundary', name: 'ControlledEventBoundary', category: 'platform', responsibility: 'Pause delivery only between complete Journal events.', listens: ['*'], emits: [], source: 'src/plugins/controlled-boundary.ts' },
  create: context => context.boundary,
})

const describedTools = pluginTools(case1ToolDefinitions().tools)

const business: readonly PluginDefinition<BuildContext>[] = [
  definePlugin({ metadata: { id: 'system-prompt', name: 'SystemPrompt', category: 'context', responsibility: 'Install the stable mobile-assistant instruction once.', listens: ['session.start'], emits: ['system.prompt'], source: 'src/cases/case1/system-prompt.ts' }, create: () => systemPromptPlugin(CASE1_SYSTEM_PROMPT), inspect: () => ({ systemPrompts: [CASE1_SYSTEM_PROMPT] }) }),
  { metadata: { id: 'runtime-context', name: 'RuntimeContext', category: 'context', responsibility: 'Describe time, matched applications, commands, and active device state for the current user turn.', listens: ['user.message'], emits: ['context.dynamic'], source: 'src/cases/case1/runtime-context.ts' }, create: context => runtimeContextPlugin({ now: context.now, packages: { 电话: 'com.samsung.android.dialer' }, cli: context.cli }) },
  { metadata: { id: 'history-compression', name: 'CompressHistory', category: 'context', responsibility: 'Create a semantic checkpoint after the context threshold.', listens: ['llm.generated'], emits: ['history.compaction.required', 'history.checkpoint'], source: 'src/cases/case1/compress-history.ts' }, create: context => compressHistoryPlugin(context.compression) },
  { metadata: { id: 'agent-flow', name: 'AgentFlow', category: 'flow', responsibility: 'Advance one mobile-assistant turn from user or tool output to content generation.', listens: ['user.message', 'tool.result'], emits: ['content.request', 'llm.request'], source: 'src/cases/case1/agent-flow.ts' }, create: () => agentFlowPlugin() },
  { metadata: { id: 'content', name: 'ContentSources', category: 'content', responsibility: 'Select the first shortcut, configured source, or LLM source that can answer.', listens: ['content.request'], emits: ['assistant.message', 'tool.call', 'llm.request'], source: 'src/cases/case1/content.ts' }, create: context => contentPlugin([shortcutSource([androidCallRule, androidFlashlightRule]), ...(context.contentSources ?? []), llmContentSource]) },
  { metadata: { id: 'context-assembler', name: 'ContextAssembler', category: 'content', responsibility: 'Project Journal facts into a provider-neutral request.', listens: ['llm.request'], emits: ['llm.invoke'], source: 'src/cases/case1/context-assembler.ts' }, create: () => contextAssemblerPlugin() },
  { metadata: { id: 'llm', name: 'LLMProvider', category: 'content', responsibility: 'Produce one complete model decision.', listens: ['llm.invoke'], emits: ['llm.generated', 'assistant.reasoning', 'tool.call', 'assistant.message'], source: 'src/cases/case1/llm.ts' }, create: context => context.llm },
  definePlugin({ metadata: { id: 'tools', name: 'Tools', category: 'effect', responsibility: 'Execute one tool-call batch and return every outcome.', listens: ['tool.call'], emits: ['tool.registry', 'tool.result'], source: 'src/cases/case1/tools.ts' }, create: context => toolsPlugin(context.tools), inspect: () => ({ tools: describedTools }) }),
  { metadata: { id: 'output', name: 'Output', category: 'presentation', responsibility: 'Publish committed assistant replies.', listens: ['assistant.message'], emits: [], source: 'src/cases/case1/output.ts' }, create: context => outputPlugin(context.output ?? { content: () => undefined }) },
]

export const case1PluginDefinitions: readonly PluginDefinition<BuildContext>[] = [boundary, ...business]

const traceMetadata: PluginMetadata = {
  id: 'trace', name: 'Trace', category: 'platform', responsibility: 'Project every delivered event to the configured trace sink.', listens: ['*'], emits: [], source: 'src/plugins/trace.ts',
}

export function case1PluginMetadata(platform: readonly PluginMetadata[] = []): readonly PluginMetadata[] {
  return [boundary.metadata, ...platform, ...business.map(item => item.metadata)]
}

export function buildCase1PluginNodes(
  context: BuildContext,
  platform: readonly PluginNode[] = [],
): readonly PluginNode[] {
  const traceNodes: readonly PluginNode[] = context.trace === undefined ? [] : [{
    metadata: traceMetadata,
    plugin: tracePlugin(context.trace),
  }]
  return [
    { metadata: boundary.metadata, plugin: boundary.create(context) },
    ...platform,
    ...traceNodes,
    ...business.map(definition => ({ metadata: definition.metadata, plugin: definition.create(context) })),
  ]
}
