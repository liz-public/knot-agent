import type { Event, Plugin } from '../../journal.js'
import type { CliCatalog } from './cli.js'
import {
  CONTEXT_DYNAMIC,
  TOOL_RESULT,
  USER_MESSAGE,
  type ToolResult,
  type UserMessage,
} from './protocol.js'

export interface RuntimeContextOptions {
  readonly now: () => Date
  readonly packages: Readonly<Record<string, string>>
  readonly cli?: CliCatalog
}

function activeState(events: readonly Event[]): Record<string, unknown> {
  const state: Record<string, unknown> = {}
  for (const event of events) {
    if (event.type !== TOOL_RESULT) continue
    for (const result of (event.data as ToolResult).results) {
      const update = result.state
      if (update === undefined) continue
      if (update.value === null) delete state[update.key]
      else state[update.key] = update.value
    }
  }
  return state
}

export const runtimeContextPlugin = (options: RuntimeContextOptions): Plugin =>
  journal => journal.subscribe(USER_MESSAGE, event => {
    const message = event.data as UserMessage
    const matchedPackages = Object.entries(options.packages)
      .filter(([label]) => message.content.includes(label))
      .map(([label, packageName]) => `${label}: ${packageName}`)
    const matched = options.cli?.detailsFor(message.content) ?? { names: [], content: '' }
    const state = activeState(journal.read())
    const sections = [
      `当前时间: ${options.now().toISOString()}`,
      matchedPackages.length === 0
        ? ''
        : `相关应用包名:\n${matchedPackages.map(item => `- ${item}`).join('\n')}`,
      matched.content.length === 0
        ? ''
        : `本轮可用命令详细说明:\n${matched.content}`,
      Object.keys(state).length === 0
        ? ''
        : `当前有效工具状态:\n${JSON.stringify(state)}`,
    ].filter(section => section.length > 0)

    journal.append(CONTEXT_DYNAMIC, {
      turnId: message.turnId,
      content: sections.join('\n\n'),
      matchedPackages,
      matchedCommands: matched.names,
      activeState: state,
    })
  })
