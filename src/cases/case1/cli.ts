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

function commandDetails(command: CliCommand): string {
  return [
    `- ${command.name}: ${command.summary}`, `  ${command.description}`,
    `  usage: ${renderUsage(command)}`,
    ...command.arguments.map(argument => `  ${argument.name}: ${argument.description}`),
    ...command.examples.map(example => `  example: ${example}`),
    ...(command.help === undefined ? [] : [`  help: ${command.help}`]),
  ].join('\n')
}

export function createCliCatalog(commands: readonly CliCommand[]): CliCatalog {
  const byName = new Map(commands.map(command => [command.name, command]))
  if (byName.size !== commands.length) throw new Error('duplicate CLI command')
  return {
    commands,
    usage: renderUsage,
    resolve(input) {
      let command: CliCommand | undefined
      try {
        const parsed = parseCliCommand(input)
        if (parsed.name === 'help') {
          if (parsed.flags.size || parsed.positional.length > 1) return failure('bad_arguments', 'usage: help [command]。示例：help shopping.search')
          const name = parsed.positional[0]
          const target = name === undefined ? undefined : byName.get(name)
          if (name !== undefined && target === undefined) return failure('command_not_found', `未知命令 ${name}。用 help 查看目录。`)
          return { content: JSON.stringify({ ok: true, help: target ? commandDetails(target)
            : commands.map(item => `${item.name}: ${item.summary}`).join('\n') }) }
        }
        command = byName.get(parsed.name)
        if (command === undefined) {
          return failure('command_not_found', `未知命令 ${parsed.name}。请调用 bash 执行 help 查看当前命令目录。`)
        }
        return { command, arguments: bindCliArguments(parsed, command) }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return failure('bad_arguments', `${message}。${command ? '\n' + commandDetails(command)
          : '请修正命令语法；用 help <command> 查看用法。'}`)
      }
    },
    detailsFor(query) {
      const normalized = query.toLowerCase()
      const matched = commands.filter(command =>
        command.keywords.some(keyword => normalized.includes(keyword.toLowerCase())),
      )
      return {
        names: matched.map(command => command.name),
        content: matched.map(commandDetails).join('\n'),
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
        description: `执行一条 CLI 命令。参数含空格时使用双引号。help 查看目录；help <command> 查看命令说明。可用命令：\n${compact}`,
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
      const result = await dispatcher.dispatch({ toolId: resolved.command.toolId, arguments: resolved.arguments, context })
      // Only declared argument errors need usage; business/permission failures do not.
      let content: Record<string, unknown> | undefined
      try { content = JSON.parse(result.content) as Record<string, unknown> } catch { return result }
      if (!content || typeof content !== 'object') return result
      if (content['ok'] === false && typeof content['error'] === 'string'
        && /^(invalid_|missing_|bad_|arithmetic_error$)/.test(content['error'])) {
        return { ...result, content: JSON.stringify({ ...content, usage_help: commandDetails(resolved.command) }) }
      }
      return result
    },
  }
}
