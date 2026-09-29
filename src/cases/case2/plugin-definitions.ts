import type { Plugin } from '../../journal.js'
import {
  definePlugin,
  pluginTools,
  type PluginDefinition,
  type PluginMetadata,
  type PluginNode,
} from '../../assembly-definition.js'
import { compressHistoryPlugin, type CompressHistoryOptions } from '../../agent/plugins/compress-history.js'
import { contextAssemblerPlugin } from '../../agent/plugins/context-assembler.js'
import { llmPlugin, type LiveOutput, type LlmProviderSource } from '../../agent/plugins/llm.js'
import { outputPlugin, type OutputSinks } from '../../agent/plugins/output.js'
import { toolsPlugin, type ToolDefinition } from '../../agent/plugins/tools.js'
import { codingFlowPlugin } from './coding-flow.js'
import { CASE2_SYSTEM_PROMPT, codingSystemPromptPlugin } from './system-prompt.js'
import { case2ToolDefinitions } from './tool-definitions.js'
import { workspaceContextPlugin } from './workspace-context.js'

interface BuildContext {
  readonly boundary: Plugin
  readonly cwd: string
  readonly compression?: CompressHistoryOptions
  readonly llm: LlmProviderSource
  readonly liveOutput?: LiveOutput
  readonly tools: readonly ToolDefinition[]
  readonly output?: OutputSinks
}

const boundary = definePlugin<BuildContext>({
  metadata: { id: 'controlled-boundary', name: 'ControlledEventBoundary', category: 'platform', responsibility: 'Pause delivery only between complete Journal events.', listens: ['*'], emits: [], source: 'src/plugins/controlled-boundary.ts' },
  create: context => context.boundary,
})

const describedTools = pluginTools(case2ToolDefinitions({
  cwd: '/',
  askPort: { ask: async () => ({ answer: '' }) },
  subagentFactory: { run: async () => ({ summary: '' }) },
}))

const business: readonly PluginDefinition<BuildContext>[] = [
  definePlugin({ metadata: { id: 'system-prompt', name: 'CodingSystemPrompt', category: 'context', responsibility: 'Install the stable coding instruction once.', listens: ['session.start'], emits: ['system.prompt'], source: 'src/cases/case2/system-prompt.ts' }, create: () => codingSystemPromptPlugin(CASE2_SYSTEM_PROMPT), inspect: () => ({ systemPrompts: [CASE2_SYSTEM_PROMPT] }) }),
  { metadata: { id: 'workspace-context', name: 'WorkspaceContext', category: 'context', responsibility: 'Describe the workspace and load AGENTS.md or CLAUDE.md for the active user turn.', listens: ['user.message'], emits: ['context.dynamic'], source: 'src/cases/case2/workspace-context.ts' }, create: context => workspaceContextPlugin(context.cwd) },
  { metadata: { id: 'history-compression', name: 'CompressHistory', category: 'context', responsibility: 'Create a semantic checkpoint after the context threshold.', listens: ['llm.generated', 'history.compress.request'], emits: ['history.compaction.required', 'history.checkpoint', 'llm.request'], source: 'src/agent/plugins/compress-history.ts' }, create: context => compressHistoryPlugin(context.compression) },
  { metadata: { id: 'coding-flow', name: 'CodingFlow', category: 'flow', responsibility: 'Advance one coding turn and guard completion.', listens: ['user.message', 'tool.result', 'llm.generated'], emits: ['llm.request', 'assistant.message'], source: 'src/cases/case2/coding-flow.ts' }, create: () => codingFlowPlugin() },
  { metadata: { id: 'context-assembler', name: 'ContextAssembler', category: 'content', responsibility: 'Project Journal facts into a provider-neutral request.', listens: ['llm.request'], emits: ['history.compress.request', 'llm.invoke'], source: 'src/agent/plugins/context-assembler.ts' }, create: () => contextAssemblerPlugin() },
  { metadata: { id: 'llm', name: 'LLMProvider', category: 'content', responsibility: 'Produce one complete model decision.', listens: ['llm.invoke'], emits: ['llm.generated', 'assistant.reasoning', 'tool.call'], source: 'src/agent/plugins/llm.ts' }, create: context => llmPlugin(context.llm, context.liveOutput, { commitAssistantMessage: false }) },
  definePlugin({ metadata: { id: 'tools', name: 'Tools', category: 'effect', responsibility: 'Execute one tool-call batch and return every outcome.', listens: ['session.start', 'tool.call'], emits: ['tool.registry', 'tool.result'], source: 'src/agent/plugins/tools.ts' }, create: context => toolsPlugin(context.tools), inspect: () => ({ tools: describedTools }) }),
  { metadata: { id: 'output', name: 'Output', category: 'presentation', responsibility: 'Publish committed assistant replies.', listens: ['assistant.reasoning', 'assistant.message'], emits: [], source: 'src/agent/plugins/output.ts' }, create: context => outputPlugin(context.output ?? { content: () => undefined }) },
]

export const case2PluginDefinitions: readonly PluginDefinition<BuildContext>[] = [boundary, ...business]

export function case2PluginMetadata(
  platform: readonly PluginMetadata[] = [],
): readonly PluginMetadata[] {
  return [boundary.metadata, ...platform, ...business.map(item => item.metadata)]
}

export function buildCase2PluginNodes(
  context: BuildContext,
  platform: readonly PluginNode[] = [],
): readonly PluginNode[] {
  return [
    { metadata: boundary.metadata, plugin: boundary.create(context) },
    ...platform,
    ...business.map(definition => ({
      metadata: definition.metadata,
      plugin: definition.create(context),
    })),
  ]
}
