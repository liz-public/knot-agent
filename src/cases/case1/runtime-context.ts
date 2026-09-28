import type { Event, Plugin } from '../../journal.js'
import type { ContextContribution, ContextSource } from './context-contributions.js'
import {
  CONTEXT_DYNAMIC,
  TOOL_RESULT,
  USER_MESSAGE,
  type ToolResult,
  type UserMessage,
} from './protocol.js'

export interface RuntimeContextOptions {
  readonly now: () => Date
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

export const runtimeContextPlugin = (
  sources: readonly ContextSource[],
  options: RuntimeContextOptions,
): Plugin => journal => journal.subscribe(USER_MESSAGE, async event => {
    const message = event.data as UserMessage
    const contributions: ContextContribution[] = []
    for (const source of sources) {
      const contribution = await source(message.content)
      if (contribution !== undefined) contributions.push(contribution)
    }
    const matchedPackages = contributions.flatMap(item => item.matchedPackages ?? [])
    const matchedCommands = contributions.flatMap(item => item.matchedCommands ?? [])
    const state = activeState(journal.read())
    const sections = [
      `当前时间: ${options.now().toISOString()}`,
      ...contributions.map(item => item.content).filter(Boolean),
      Object.keys(state).length === 0
        ? ''
        : `当前有效工具状态:\n${JSON.stringify(state)}`,
    ].filter(section => section.length > 0)

    journal.append(CONTEXT_DYNAMIC, {
      turnId: message.turnId,
      query: message.content,
      content: sections.join('\n\n'),
      matchedPackages,
      matchedCommands,
      activeState: state,
    })
  })
