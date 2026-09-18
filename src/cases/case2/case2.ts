import { createJournal, type Event, type Plugin } from '../../journal.js'
import { JSONL_LOAD, jsonlLoadPlugin, jsonlStorePlugin } from '../../plugins/jsonl.js'
import { tracePlugin } from '../../plugins/trace.js'
import { compressHistoryPlugin, type CompressHistoryOptions } from '../case1/compress-history.js'
import { contentPlugin, llmContentSource } from '../case1/content.js'
import { contextAssemblerPlugin } from '../case1/context-assembler.js'
import { llmPlugin, type LiveOutput, type LlmProvider } from '../case1/llm.js'
import { outputPlugin, type OutputSinks } from '../case1/output.js'
import { SESSION_START, USER_MESSAGE } from '../case1/protocol.js'
import { toolsPlugin, type ToolDefinition } from '../case1/tools.js'
import { codingTools, type ToolOutput } from './coding-tools.js'
import { codingSystemPromptPlugin } from './system-prompt.js'
import { workspaceContextPlugin } from './workspace-context.js'
import { todoTool } from './todo-tool.js'
import { codingFlowPlugin } from './coding-flow.js'
import { controlledEventBoundary } from './controlled-boundary.js'
import { goalTool } from './goal-tool.js'
import { spawnAgentTool, type SubagentFactory } from './subagent-tool.js'
import {
  askTool,
  permissionTools,
  type ApprovalPort,
  type AskPort,
  type PermissionPolicy,
} from './tool-interaction.js'

export interface Case2Options {
  readonly cwd: string
  readonly llm: LlmProvider
  readonly liveOutput?: LiveOutput
  readonly toolOutput?: ToolOutput
  readonly output?: OutputSinks
  readonly trace?: (event: Event) => void
  readonly permissionPolicy?: PermissionPolicy
  readonly approvalPort?: ApprovalPort
  readonly askPort?: AskPort
  readonly extraTools?: readonly ToolDefinition[]
  readonly subagentFactory?: SubagentFactory
  readonly compression?: CompressHistoryOptions
  /** Optional outward observers assembled before business plugins. */
  readonly platformPlugins?: readonly Plugin[]
}

export interface PersistentCase2Options extends Case2Options {
  readonly journalPath: string
}

type JournalRuntime = ReturnType<typeof createJournal>

function assembleCase2Agent(
  options: Case2Options,
  runtime: JournalRuntime,
  restored: boolean,
  platformPlugins: readonly Plugin[] = [],
) {
  const { journal, runUntilIdle } = runtime
  const boundary = controlledEventBoundary()
  const baseTools = [
    ...codingTools(options.cwd, options.toolOutput),
    todoTool(),
    goalTool(),
    ...(options.subagentFactory === undefined
      ? []
      : [spawnAgentTool(options.cwd, options.subagentFactory)]),
    ...(options.extraTools ?? []),
  ]
  const tools = permissionTools(
    [...baseTools, ...(options.askPort === undefined ? [] : [askTool(options.askPort)])],
    options.permissionPolicy,
    options.approvalPort,
  )
  const plugins: Plugin[] = [
    boundary.plugin,
    ...platformPlugins,
    ...(options.trace === undefined ? [] : [tracePlugin(options.trace)]),
    codingSystemPromptPlugin(),
    workspaceContextPlugin(options.cwd),
    compressHistoryPlugin(options.compression),
    codingFlowPlugin(),
    contentPlugin([llmContentSource]),
    contextAssemblerPlugin(),
    llmPlugin(options.llm, options.liveOutput, { commitAssistantMessage: false }),
    toolsPlugin(tools),
    outputPlugin(options.output ?? { content: () => undefined }),
  ]
  for (const plugin of plugins) plugin(journal)

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

  async function submit(content: string): Promise<void> {
    if (running) throw new Error('CASE2 agent is already running')
    await start()
    running = true
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
  const before = runtime.journal.read().length
  runtime.journal.append(JSONL_LOAD, {})
  await runtime.runUntilIdle()
  const restored = runtime.journal.read().length > before + 1

  return assembleCase2Agent(
    caseOptions,
    runtime,
    restored,
    [jsonlStorePlugin(journalPath), ...(caseOptions.platformPlugins ?? [])],
  )
}
