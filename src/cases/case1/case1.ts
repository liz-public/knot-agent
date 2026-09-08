import { createJournal, type Event, type Plugin } from '../../journal.js'
import { tracePlugin } from '../../plugins/trace.js'
import { agentFlowPlugin } from './agent-flow.js'
import { compressHistoryPlugin, type CompressHistoryOptions } from './compress-history.js'
import { contentArbiterPlugin } from './content.js'
import { contextAssemblerPlugin } from './context-assembler.js'
import { outputPlugin, type OutputSinks } from './output.js'
import { SESSION_START, USER_MESSAGE } from './protocol.js'
import { case1Commands, runtimeContextPlugin } from './runtime-context.js'
import { androidCallRule, shortcutPlugin } from './shortcuts.js'
import { systemPromptPlugin } from './system-prompt.js'
import { mockAndroidBashTool, toolsPlugin, type ToolDefinition } from './tools.js'

export interface Case1Options {
  readonly llm: Plugin
  /** Extra content providers, tried after the built-in shortcut rules. */
  readonly contentProviders?: readonly Plugin[]
  readonly tools?: readonly ToolDefinition[]
  readonly output?: OutputSinks
  readonly trace?: (event: Event) => void
  readonly compression?: CompressHistoryOptions
  readonly now?: () => Date
}

export function createCase1Agent(options: Case1Options) {
  const { journal, runUntilIdle } = createJournal()
  const tools = options.tools ?? [mockAndroidBashTool()]
  let started = false
  let turnNumber = 0

  const plugins: Plugin[] = [
    ...(options.trace === undefined ? [] : [tracePlugin(options.trace)]),
    systemPromptPlugin(),
    runtimeContextPlugin({
      now: options.now ?? (() => new Date()),
      packages: { 电话: 'com.samsung.android.dialer' },
      commands: case1Commands,
    }),
    compressHistoryPlugin(options.compression),
    agentFlowPlugin(),
    shortcutPlugin([androidCallRule]),
    ...(options.contentProviders ?? []),
    contentArbiterPlugin(),
    contextAssemblerPlugin(),
    options.llm,
    toolsPlugin(tools),
    outputPlugin(options.output ?? { content: () => undefined }),
  ]
  for (const plugin of plugins) plugin(journal)

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
