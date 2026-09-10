import { createJournal, type Event, type Plugin } from '../../journal.js'
import { JSONL_LOAD, jsonlLoadPlugin, jsonlStorePlugin } from '../../plugins/jsonl.js'
import { tracePlugin } from '../../plugins/trace.js'
import { agentFlowPlugin } from './agent-flow.js'
import { compressHistoryPlugin, type CompressHistoryOptions } from './compress-history.js'
import { contentPlugin, llmContentSource, type ContentSource } from './content.js'
import { contextAssemblerPlugin } from './context-assembler.js'
import { createCliCatalog, type CliCatalog } from './cli.js'
import { mockAndroidCliCommands } from './mock-android-tools.js'
import { outputPlugin, type OutputSinks } from './output.js'
import { SESSION_START, USER_MESSAGE } from './protocol.js'
import { runtimeContextPlugin } from './runtime-context.js'
import { androidCallRule, androidFlashlightRule, shortcutSource } from './shortcuts.js'
import { systemPromptPlugin } from './system-prompt.js'
import {
  createAndroidDeviceSession,
  toolsPlugin,
  type ToolDefinition,
} from './tools.js'

export interface Case1Options {
  readonly llm: Plugin
  /** Extra content sources, tried after the built-in shortcut rules. */
  readonly contentSources?: readonly ContentSource[]
  readonly tools?: readonly ToolDefinition[]
  readonly cli?: CliCatalog
  readonly output?: OutputSinks
  readonly trace?: (event: Event) => void
  readonly compression?: CompressHistoryOptions
  readonly now?: () => Date
}

export interface PersistentCase1Options extends Case1Options {
  readonly journalPath: string
}

type JournalRuntime = ReturnType<typeof createJournal>

function assembleCase1Agent(
  options: Case1Options,
  runtime: JournalRuntime,
  restored: boolean,
  platformPlugins: readonly Plugin[] = [],
) {
  const { journal, runUntilIdle } = runtime
  const device = createAndroidDeviceSession()
  const cli = options.cli ?? (options.tools === undefined
    ? createCliCatalog(mockAndroidCliCommands(device))
    : undefined)
  const tools = options.tools ?? [cli!.bash]
  let started = restored
  let turnNumber = 0
  const turnIds = new Set(journal.read()
    .filter(event => event.type === USER_MESSAGE)
    .map(event => (event.data as { turnId: string }).turnId))

  const plugins: Plugin[] = [
    ...platformPlugins,
    ...(options.trace === undefined ? [] : [tracePlugin(options.trace)]),
    systemPromptPlugin(),
    runtimeContextPlugin({
      now: options.now ?? (() => new Date()),
      packages: { 电话: 'com.samsung.android.dialer' },
      cli,
    }),
    compressHistoryPlugin(options.compression),
    agentFlowPlugin(),
    contentPlugin([
      shortcutSource([androidCallRule, androidFlashlightRule]),
      ...(options.contentSources ?? []),
      llmContentSource,
    ]),
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
    let turnId: string
    do {
      turnNumber += 1
      turnId = `turn-${turnNumber}`
    } while (turnIds.has(turnId))
    turnIds.add(turnId)
    journal.append(USER_MESSAGE, { turnId, content })
    await runUntilIdle()
  }

  return { journal, start, submit }
}

export function createCase1Agent(options: Case1Options) {
  return assembleCase1Agent(options, createJournal(), false)
}

export async function createPersistentCase1Agent(options: PersistentCase1Options) {
  const { journalPath, ...caseOptions } = options
  const runtime = createJournal()

  // Restore is a normal drain with only the loader installed. Historical
  // events therefore advance the private head without reaching business
  // handlers; those handlers are installed only after this drain is idle.
  jsonlLoadPlugin(journalPath)(runtime.journal)
  const before = runtime.journal.read().length
  runtime.journal.append(JSONL_LOAD, {})
  await runtime.runUntilIdle()
  const restored = runtime.journal.read().length > before + 1

  return assembleCase1Agent(
    caseOptions,
    runtime,
    restored,
    [jsonlStorePlugin(journalPath)],
  )
}
