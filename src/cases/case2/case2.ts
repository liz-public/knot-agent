import { createJournal, type Event, type Plugin } from '../../journal.js'
import { contentPlugin, llmContentSource } from '../case1/content.js'
import { contextAssemblerPlugin } from '../case1/context-assembler.js'
import { llmPlugin, type LiveOutput, type LlmProvider } from '../case1/llm.js'
import { outputPlugin, type OutputSinks } from '../case1/output.js'
import { SESSION_START, USER_MESSAGE } from '../case1/protocol.js'
import { toolsPlugin } from '../case1/tools.js'
import { tracePlugin } from '../../plugins/trace.js'
import { codingTools } from './coding-tools.js'
import { codingSystemPromptPlugin } from './system-prompt.js'
import { workspaceContextPlugin } from './workspace-context.js'
import { todoTool } from './todo-tool.js'
import { codingFlowPlugin } from './coding-flow.js'
import { controlledEventBoundary } from './controlled-boundary.js'
import {
  askTool,
  permissionTools,
  type ApprovalPort,
  type AskPort,
  type PermissionPolicy,
} from './tool-interaction.js'
import type { ToolDefinition } from '../case1/tools.js'

export interface Case2Options {
  readonly cwd: string
  readonly llm: LlmProvider
  readonly liveOutput?: LiveOutput
  readonly output?: OutputSinks
  readonly trace?: (event: Event) => void
  readonly permissionPolicy?: PermissionPolicy
  readonly approvalPort?: ApprovalPort
  readonly askPort?: AskPort
  readonly extraTools?: readonly ToolDefinition[]
}

export function createCase2Agent(options: Case2Options) {
  const { journal, runUntilIdle } = createJournal()
  const boundary = controlledEventBoundary()
  const baseTools = [...codingTools(options.cwd), todoTool(), ...(options.extraTools ?? [])]
  const tools = permissionTools(
    [...baseTools, ...(options.askPort === undefined ? [] : [askTool(options.askPort)])],
    options.permissionPolicy,
    options.approvalPort,
  )
  const plugins: Plugin[] = [
    boundary.plugin,
    ...(options.trace === undefined ? [] : [tracePlugin(options.trace)]),
    codingSystemPromptPlugin(),
    workspaceContextPlugin(options.cwd),
    codingFlowPlugin(),
    contentPlugin([llmContentSource]),
    contextAssemblerPlugin(),
    llmPlugin(options.llm, options.liveOutput, { commitAssistantMessage: false }),
    toolsPlugin(tools),
    outputPlugin(options.output ?? { content: () => undefined }),
  ]
  for (const plugin of plugins) plugin(journal)

  let started = false
  let turnNumber = 0
  let running = false

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
    turnNumber += 1
    journal.append(USER_MESSAGE, { turnId: `turn-${turnNumber}`, content })
    try {
      await runUntilIdle()
    } finally {
      running = false
    }
  }

  function steer(content: string): void {
    if (!running) throw new Error('CASE2 agent is idle; use submit instead')
    turnNumber += 1
    journal.append(USER_MESSAGE, { turnId: `steer-${turnNumber}`, content })
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
