import type { PluginNode } from '../../assembly-definition.js'
import { createJournal, type Event } from '../../journal.js'
import { JSONL_LOAD, JSONL_STORE_METADATA, jsonlLoadPlugin, jsonlStorePlugin } from '../../plugins/jsonl.js'
import { tracePlugin } from '../../plugins/trace.js'
import type { CompressHistoryOptions } from '../../agent/plugins/compress-history.js'
import type { LiveOutput, LlmProviderSource } from '../../agent/plugins/llm.js'
import {
  appendSessionConfiguration,
  projectSessionConfiguration,
  type SessionConfiguration,
} from '../../agent/session-configuration.js'
import type { OutputSinks } from '../../agent/plugins/output.js'
import { SESSION_START, USER_MESSAGE } from '../../agent/protocol.js'
import type { ToolDefinition } from '../../agent/plugins/tools.js'
import type { WebSearchProvider } from '../../agent/providers/deepseek-search.js'
import type { ToolOutput } from './coding-tools.js'
import { controlledEventBoundary } from '../../plugins/controlled-boundary.js'
import { buildCase2PluginNodes } from './plugin-definitions.js'
import type { SubagentFactory } from './subagent-tool.js'
import { case2ToolDefinitions } from './tool-definitions.js'
import type { ApprovalPort, AskPort, PermissionPolicy } from './tool-interaction.js'

export interface Case2Options {
  readonly cwd: string
  readonly llm: LlmProviderSource
  readonly liveOutput?: LiveOutput
  readonly toolOutput?: ToolOutput
  readonly output?: OutputSinks
  readonly trace?: (event: Event) => void
  readonly permissionPolicy?: PermissionPolicy
  readonly approvalPort?: ApprovalPort
  readonly askPort?: AskPort
  readonly extraTools?: readonly ToolDefinition[]
  readonly webSearch?: WebSearchProvider
  readonly subagentFactory?: SubagentFactory
  readonly compression?: CompressHistoryOptions
  /** Optional outward observers assembled before business plugins. */
  readonly platformPlugins?: readonly PluginNode[]
}

export interface PersistentCase2Options extends Case2Options {
  readonly journalPath: string
}

type JournalRuntime = ReturnType<typeof createJournal>

function assembleCase2Agent(
  options: Case2Options,
  runtime: JournalRuntime,
  restored: boolean,
  platformPlugins: readonly PluginNode[] = [],
) {
  const { journal, runUntilIdle } = runtime
  const boundary = controlledEventBoundary()
  const tools = case2ToolDefinitions({
    ...options,
    approvalMode: () => projectSessionConfiguration(journal.read()).approvalMode ?? 'ask',
  })
  const traceNodes: readonly PluginNode[] = options.trace === undefined ? [] : [{
    plugin: tracePlugin(options.trace),
    metadata: { id: 'trace', name: 'Trace', category: 'platform', responsibility: 'Project every delivered event to the configured trace sink.', listens: ['*'], emits: [], source: 'src/plugins/trace.ts' },
  }]
  const nodes = buildCase2PluginNodes({
    boundary: boundary.plugin,
    cwd: options.cwd,
    compression: options.compression,
    llm: options.llm,
    liveOutput: options.liveOutput,
    tools,
    output: options.output,
  }, [...platformPlugins, ...traceNodes])
  for (const node of nodes) node.plugin(journal)

  let started = restored
  let messageNumber = 0
  let running = false
  const messageIds = new Set(journal.read()
    .filter(event => event.type === USER_MESSAGE)
    .map(event => (event.data as { turnId: string }).turnId))

  function nextMessageId(prefix: 'turn' | 'steer'): string {
    let turnId: string
    do {
      messageNumber += 1
      turnId = `${prefix}-${messageNumber}`
    } while (messageIds.has(turnId))
    messageIds.add(turnId)
    return turnId
  }

  async function start(): Promise<void> {
    if (started) return
    started = true
    journal.append(SESSION_START, {})
    await runUntilIdle()
  }

  async function submit(content: string, configuration?: SessionConfiguration): Promise<void> {
    if (running) throw new Error('CASE2 agent is already running')
    await start()
    running = true
    if (configuration !== undefined) appendSessionConfiguration(journal, configuration)
    journal.append(USER_MESSAGE, { turnId: nextMessageId('turn'), content })
    try {
      await runUntilIdle()
    } finally {
      running = false
    }
  }

  function steer(content: string): void {
    if (!running) throw new Error('CASE2 agent is idle; use submit instead')
    journal.append(USER_MESSAGE, { turnId: nextMessageId('steer'), content })
  }

  return {
    journal,
    start,
    submit,
    steer,
    pause: () => { if (running) boundary.control.pause() },
    resume: () => boundary.control.resume(),
    status: () => boundary.control.status() === 'paused'
      ? 'paused' as const
      : running ? 'running' as const : 'idle' as const,
  }
}

export function createCase2Agent(options: Case2Options) {
  return assembleCase2Agent(options, createJournal(), false, options.platformPlugins)
}

export async function createPersistentCase2Agent(options: PersistentCase2Options) {
  const { journalPath, ...caseOptions } = options
  const runtime = createJournal()

  jsonlLoadPlugin(journalPath)(runtime.journal)
  runtime.journal.append(JSONL_LOAD, {})
  await runtime.runUntilIdle()
  const restored = runtime.journal.read().some(event => event.type === SESSION_START)

  return assembleCase2Agent(
    caseOptions,
    runtime,
    restored,
    [{ plugin: jsonlStorePlugin(journalPath), metadata: JSONL_STORE_METADATA }, ...(caseOptions.platformPlugins ?? [])],
  )
}
