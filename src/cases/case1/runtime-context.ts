import type { Event, Plugin } from '../../journal.js'
import {
  CONTEXT_DYNAMIC,
  TOOL_RESULT,
  USER_MESSAGE,
  type ToolResult,
  type UserMessage,
} from './protocol.js'

export interface CommandDescription {
  readonly name: string
  readonly keywords: readonly string[]
  readonly description: string
}

export interface RuntimeContextOptions {
  readonly now: () => Date
  readonly packages: Readonly<Record<string, string>>
  readonly commands: readonly CommandDescription[]
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
    const matched = options.commands.filter(command =>
      command.keywords.some(keyword => message.content.includes(keyword)),
    )
    const state = activeState(journal.read())
    const sections = [
      `当前时间: ${options.now().toISOString()}`,
      matchedPackages.length === 0
        ? ''
        : `相关应用包名:\n${matchedPackages.map(item => `- ${item}`).join('\n')}`,
      matched.length === 0
        ? ''
        : `本轮匹配命令:\n${matched.map(command => `- ${command.description}`).join('\n')}`,
      Object.keys(state).length === 0
        ? ''
        : `当前有效工具状态:\n${JSON.stringify(state)}`,
    ].filter(section => section.length > 0)

    journal.append(CONTEXT_DYNAMIC, {
      turnId: message.turnId,
      content: sections.join('\n\n'),
      matchedPackages,
      matchedCommands: matched.map(command => command.name),
      activeState: state,
    })
  })

export const case1Commands: readonly CommandDescription[] = [
  {
    name: 'contact',
    keywords: ['电话', '拨打', '联系人', '号码'],
    description: 'contact <call|lookup> <name>：匹配联系人。候选不含号码；contact call 已负责外呼。',
  },
  {
    name: 'select',
    keywords: ['电话', '拨打', '选择', '第'],
    description: 'select <N>：选择最近候选列表中的第 N 项，N 从 1 开始。',
  },
]
