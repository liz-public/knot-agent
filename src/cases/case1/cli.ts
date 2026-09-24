import type { ToolDispatcher } from './dispatcher.js'
import type { ToolDefinition, ToolExecution } from './tools.js'
import { bindCliArguments, parseCliCommand, renderUsage } from './cli-arguments.js'

export type CliArgument =
  | { readonly name: string; readonly description: string; readonly format: 'positional'; readonly required: boolean; readonly type: 'text'; readonly label?: string }
  | { readonly name: string; readonly description: string; readonly format: 'positional'; readonly required: boolean; readonly type: 'enum'; readonly values: readonly string[] }
  | { readonly name: string; readonly description: string; readonly format: 'flag'; readonly required: boolean; readonly flag?: string; readonly type: 'text'; readonly label?: string }
  | { readonly name: string; readonly description: string; readonly format: 'flag'; readonly required: boolean; readonly flag?: string; readonly type: 'enum'; readonly values: readonly string[] }
  | { readonly name: string; readonly description: string; readonly format: 'switch'; readonly required: boolean; readonly flag?: string }

export interface CliCommand {
  readonly toolId: string
  readonly name: string
  readonly summary: string
  readonly description: string
  readonly help?: string
  readonly arguments: readonly CliArgument[]
  readonly examples: readonly string[]
  readonly keywords: readonly string[]
}

export interface CliCatalog {
  readonly commands: readonly CliCommand[]
  usage(command: CliCommand): string
  detailsFor(query: string): { names: readonly string[]; content: string }
  resolve(input: string): { command: CliCommand; arguments: Record<string, string | boolean> } | ToolExecution
}

const failure = (error: string, hint: string): ToolExecution => ({
  content: JSON.stringify({ ok: false, error, hint }),
})

export function createCliCatalog(commands: readonly CliCommand[]): CliCatalog {
  const byName = new Map(commands.map(command => [command.name, command]))
  if (byName.size !== commands.length) throw new Error('duplicate CLI command')
  return {
    commands,
    usage: renderUsage,
    resolve(input) {
      try {
        const parsed = parseCliCommand(input)
        const command = byName.get(parsed.name)
        if (command === undefined) {
          return failure('command_not_found', `未知命令 ${parsed.name}。请从 bash 工具目录选择命令。`)
        }
        return { command, arguments: bindCliArguments(parsed, command) }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return failure('bad_arguments', `${message}。请按本轮动态上下文中的 usage 重试。`)
      }
    },
    detailsFor(query) {
      const normalized = query.toLowerCase()
      const matched = commands.filter(command =>
        command.keywords.some(keyword => normalized.includes(keyword.toLowerCase())),
      )
      return {
        names: matched.map(command => command.name),
        content: matched.map(command => [
          `- ${command.name}: ${command.summary}`,
          `  ${command.description}`,
          `  usage: ${renderUsage(command)}`,
          ...command.arguments.map(argument => `  ${argument.name}: ${argument.description}`),
          ...command.examples.map(example => `  example: ${example}`),
          ...(command.help === undefined ? [] : [`  help: ${command.help}`]),
        ].join('\n')).join('\n'),
      }
    },
  }
}

export function createBashTool(catalog: CliCatalog, dispatcher: ToolDispatcher): ToolDefinition {
  const compact = catalog.commands.map(command => `${command.name}: ${command.summary}`).join('\n')
  return {
    name: 'bash',
    schema: {
      type: 'function',
      function: {
        name: 'bash',
        description: `执行一条 Android CLI 命令。参数含空格时使用双引号。可用命令：\n${compact}`,
        parameters: {
          type: 'object',
          properties: { command: { type: 'string', description: '一条 CLI 命令。' } },
          required: ['command'],
          additionalProperties: false,
        },
      },
    },
    async execute(arguments_, context) {
      const input = arguments_['command']
      if (typeof input !== 'string') return failure('invalid_command', 'command 必须是字符串。')
      const resolved = catalog.resolve(input)
      if ('content' in resolved) return resolved
      return dispatcher.dispatch({ toolId: resolved.command.toolId, arguments: resolved.arguments, context })
    },
  }
}
