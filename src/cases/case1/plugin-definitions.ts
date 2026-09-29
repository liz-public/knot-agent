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
import { compressHistoryPlugin, type CompressHistoryOptions } from '../../agent/plugins/compress-history.js'
import type { CliCatalog } from './cli.js'
import { contentPlugin, llmContentSource, type ContentSource } from './content.js'
import { appMatchSource, toolIntentMatchSource, type AppMatcher } from './context-contributions.js'
import { contextAssemblerPlugin } from '../../agent/plugins/context-assembler.js'
import { outputPlugin, type OutputSinks } from '../../agent/plugins/output.js'
import { toolsPlugin, type ToolDefinition } from '../../agent/plugins/tools.js'
import { runtimeContextPlugin } from './runtime-context.js'
import { CASE1_SYSTEM_PROMPT, systemPromptPlugin } from './system-prompt.js'

interface BuildContext {
  readonly boundary: Plugin
  readonly appMatcher?: AppMatcher
  readonly catalog: CliCatalog
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

const business: readonly PluginDefinition<BuildContext>[] = [
  definePlugin({ metadata: { id: 'system-prompt', name: 'SystemPrompt', category: 'context', responsibility: 'Install the stable mobile-assistant instruction once.', listens: ['session.start'], emits: ['system.prompt'], source: 'src/cases/case1/system-prompt.ts' }, create: () => systemPromptPlugin(CASE1_SYSTEM_PROMPT), inspect: () => ({ systemPrompts: [CASE1_SYSTEM_PROMPT] }) }),
  { metadata: { id: 'runtime-context', name: 'RuntimeContext', category: 'context', responsibility: 'Build one turn-scoped context from app, tool-intent, time, and active-state sources.', listens: ['user.message'], emits: ['context.dynamic'], source: 'src/cases/case1/runtime-context.ts' }, create: context => runtimeContextPlugin([appMatchSource(context.appMatcher), toolIntentMatchSource(context.catalog)], { now: context.now }) },
  { metadata: { id: 'history-compression', name: 'CompressHistory', category: 'context', responsibility: 'Create a semantic checkpoint after the context threshold.', listens: ['llm.generated', 'history.compress.request'], emits: ['history.compaction.required', 'history.checkpoint', 'llm.request'], source: 'src/agent/plugins/compress-history.ts' }, create: context => compressHistoryPlugin(context.compression) },
  { metadata: { id: 'agent-flow', name: 'AgentFlow', category: 'flow', responsibility: 'Advance one mobile-assistant turn after dynamic context or tool output is complete.', listens: ['context.dynamic', 'tool.result'], emits: ['content.request', 'llm.request'], source: 'src/cases/case1/agent-flow.ts' }, create: () => agentFlowPlugin() },
  { metadata: { id: 'content', name: 'ContentSources', category: 'content', responsibility: 'Select the first configured source or LLM source that can answer.', listens: ['content.request'], emits: ['assistant.message', 'tool.call', 'llm.request'], source: 'src/cases/case1/content.ts' }, create: context => contentPlugin([...(context.contentSources ?? []), llmContentSource]) },
  { metadata: { id: 'context-assembler', name: 'ContextAssembler', category: 'content', responsibility: 'Project Journal facts into a provider-neutral request.', listens: ['llm.request'], emits: ['history.compress.request', 'llm.invoke'], source: 'src/agent/plugins/context-assembler.ts' }, create: () => contextAssemblerPlugin() },
  { metadata: { id: 'llm', name: 'LLMProvider', category: 'content', responsibility: 'Produce one complete model decision.', listens: ['llm.invoke'], emits: ['llm.generated', 'assistant.reasoning', 'tool.call', 'assistant.message'], source: 'src/agent/plugins/llm.ts' }, create: context => context.llm },
  definePlugin({ metadata: { id: 'tools', name: 'Tools', category: 'effect', responsibility: 'Register the current tool set at a turn boundary and execute tool-call batches.', listens: ['session.start', 'user.message', 'tool.call'], emits: ['tool.registry', 'tool.result'], source: 'src/agent/plugins/tools.ts' }, create: context => toolsPlugin(context.tools) }),
  { metadata: { id: 'output', name: 'Output', category: 'presentation', responsibility: 'Publish committed assistant replies.', listens: ['assistant.reasoning', 'assistant.message'], emits: [], source: 'src/agent/plugins/output.ts' }, create: context => outputPlugin(context.output ?? { content: () => undefined }) },
]

export const case1PluginDefinitions: readonly PluginDefinition<BuildContext>[] = [boundary, ...business]

export function describeCase1Plugins(tools: readonly ToolDefinition[]) {
  return case1PluginDefinitions.map(definition => definition.metadata.id === 'tools'
    ? { metadata: definition.metadata, inspect: () => ({ tools: pluginTools(tools) }) }
    : { metadata: definition.metadata, ...(definition.inspect === undefined ? {} : { inspect: definition.inspect }) })
}

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
