import type { PluginNode } from '../../assembly-definition.js'
import { createJournal, type Event, type Plugin } from '../../journal.js'
import { JSONL_LOAD, JSONL_STORE_METADATA, jsonlLoadPlugin, jsonlStorePlugin } from '../../plugins/jsonl.js'
import { controlledEventBoundary } from '../../plugins/controlled-boundary.js'
import type { CompressHistoryOptions } from './compress-history.js'
import { ANDROID_TOOL_CATALOG } from './android-tool-catalog.js'
import { createBashTool, createCliCatalog } from './cli.js'
import type { ContentSource } from './content.js'
import type { AppMatcher } from './context-contributions.js'
import type { ToolDispatcher } from './dispatcher.js'
import type { OutputSinks } from './output.js'
import { buildCase1PluginNodes } from './plugin-definitions.js'
import { SESSION_START, USER_MESSAGE } from './protocol.js'
import { androidCallRule, androidFlashlightRule, shortcutSource } from './shortcuts.js'

export interface Case1Options {
  readonly llm: Plugin
  readonly dispatcher: ToolDispatcher
  readonly appMatcher?: AppMatcher
  /** Extra content sources, tried after the built-in shortcut rules. */
  readonly contentSources?: readonly ContentSource[]
  readonly output?: OutputSinks
  readonly trace?: (event: Event) => void
  readonly compression?: CompressHistoryOptions
  readonly now?: () => Date
  /** Optional outward observers assembled before business plugins. */
  readonly platformPlugins?: readonly PluginNode[]
}

export interface PersistentCase1Options extends Case1Options {
  readonly journalPath: string
}

type JournalRuntime = ReturnType<typeof createJournal>

function assembleCase1Agent(
  options: Case1Options,
  runtime: JournalRuntime,
  restored: boolean,
  platformPlugins: readonly PluginNode[] = [],
) {
  const { journal, runUntilIdle } = runtime
  const catalog = createCliCatalog(ANDROID_TOOL_CATALOG)
  const tools = [createBashTool(catalog, options.dispatcher)]
  const boundary = controlledEventBoundary()
  let started = restored
  let turnNumber = 0
  let running = false
  const turnIds = new Set(journal.read()
    .filter(event => event.type === USER_MESSAGE)
    .map(event => (event.data as { turnId: string }).turnId))

  const nodes = buildCase1PluginNodes({
    boundary: boundary.plugin,
    compression: options.compression,
    appMatcher: options.appMatcher,
    catalog,
    contentSources: [shortcutSource([androidCallRule, androidFlashlightRule]), ...(options.contentSources ?? [])],
    llm: options.llm,
    now: options.now ?? (() => new Date()),
    output: options.output,
    tools,
    trace: options.trace,
  }, platformPlugins)
  for (const node of nodes) node.plugin(journal)

  async function start(): Promise<void> {
    if (started) return
    started = true
    journal.append(SESSION_START, {})
    await runUntilIdle()
  }

  function nextTurnId(prefix: 'turn' | 'steer'): string {
    let turnId: string
    do {
      turnNumber += 1
      turnId = `${prefix}-${turnNumber}`
    } while (turnIds.has(turnId))
    turnIds.add(turnId)
    return turnId
  }

  async function submit(content: string): Promise<void> {
    if (running) throw new Error('CASE1 agent is already running')
    await start()
    running = true
    journal.append(USER_MESSAGE, { turnId: nextTurnId('turn'), content })
    try {
      await runUntilIdle()
    } finally {
      running = false
    }
  }

  function steer(content: string): void {
    if (!running) throw new Error('CASE1 agent is idle; use submit instead')
    journal.append(USER_MESSAGE, { turnId: nextTurnId('steer'), content })
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

export function createCase1Agent(options: Case1Options) {
  return assembleCase1Agent(options, createJournal(), false, options.platformPlugins)
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
    [{ plugin: jsonlStorePlugin(journalPath), metadata: JSONL_STORE_METADATA }, ...(caseOptions.platformPlugins ?? [])],
  )
}
