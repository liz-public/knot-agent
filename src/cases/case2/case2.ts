import { createJournal, type Event, type Plugin } from '../../journal.js'
import { agentFlowPlugin } from '../case1/agent-flow.js'
import { contentPlugin, llmContentSource } from '../case1/content.js'
import { contextAssemblerPlugin } from '../case1/context-assembler.js'
import { outputPlugin, type OutputSinks } from '../case1/output.js'
import { SESSION_START, USER_MESSAGE } from '../case1/protocol.js'
import { toolsPlugin } from '../case1/tools.js'
import { tracePlugin } from '../../plugins/trace.js'
import { codingTools } from './coding-tools.js'
import { codingSystemPromptPlugin } from './system-prompt.js'
import { workspaceContextPlugin } from './workspace-context.js'
import {
  askTool,
  permissionTools,
  type ApprovalPort,
  type AskPort,
  type PermissionPolicy,
} from './tool-interaction.js'

export interface Case2Options {
  readonly cwd: string
  readonly llm: Plugin
  readonly output?: OutputSinks
  readonly trace?: (event: Event) => void
  readonly permissionPolicy?: PermissionPolicy
  readonly approvalPort?: ApprovalPort
  readonly askPort?: AskPort
}

export function createCase2Agent(options: Case2Options) {
  const { journal, runUntilIdle } = createJournal()
  const baseTools = codingTools(options.cwd)
  const tools = permissionTools(
    [...baseTools, ...(options.askPort === undefined ? [] : [askTool(options.askPort)])],
    options.permissionPolicy,
    options.approvalPort,
  )
  const plugins: Plugin[] = [
    ...(options.trace === undefined ? [] : [tracePlugin(options.trace)]),
    codingSystemPromptPlugin(),
    workspaceContextPlugin(options.cwd),
    agentFlowPlugin(),
    contentPlugin([llmContentSource]),
    contextAssemblerPlugin(),
    options.llm,
    toolsPlugin(tools),
    outputPlugin(options.output ?? { content: () => undefined }),
  ]
  for (const plugin of plugins) plugin(journal)

  let started = false
  let turnNumber = 0

  async function start(): Promise<void> {
    if (started) return
    started = true
    journal.append(SESSION_START, {})
    await runUntilIdle()
  }

  async function submit(content: string): Promise<void> {
    await start()
    turnNumber += 1
    journal.append(USER_MESSAGE, { turnId: `turn-${turnNumber}`, content })
    await runUntilIdle()
  }

  return { journal, start, submit }
}
