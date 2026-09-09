import type { ToolDefinition, ToolExecution } from './tools.js'

export interface CliCommand {
  readonly name: string
  readonly summary: string
  readonly usage: string
  readonly examples: readonly string[]
  readonly keywords: readonly string[]
  readonly tool: ToolDefinition
  parse(arguments_: readonly string[]): Record<string, unknown>
}

export interface CliCatalog {
  readonly commands: readonly CliCommand[]
  readonly bash: ToolDefinition
  detailsFor(query: string): { names: readonly string[]; content: string }
}

function tokenize(command: string): string[] {
  const tokens: string[] = []
  let token = ''
  let quote: '"' | "'" | undefined
  let escaped = false

  for (const character of command.trim()) {
    if (escaped) {
      token += character
      escaped = false
    } else if (character === '\\') {
      escaped = true
    } else if (quote !== undefined) {
      if (character === quote) quote = undefined
      else token += character
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (/\s/.test(character)) {
      if (token.length > 0) {
        tokens.push(token)
        token = ''
      }
    } else {
      token += character
    }
  }
  if (escaped) token += '\\'
  if (quote !== undefined) throw new Error('unterminated quote')
  if (token.length > 0) tokens.push(token)
  return tokens
}

const failure = (error: string, hint: string): ToolExecution => ({
  content: JSON.stringify({ ok: false, error, hint }),
})

export function createCliCatalog(commands: readonly CliCommand[]): CliCatalog {
  const byName = new Map(commands.map(command => [command.name, command]))
  if (byName.size !== commands.length) throw new Error('duplicate CLI command')

  const compactCatalog = commands
    .map(command => `${command.name}: ${command.summary}`)
    .join('\n')

  return {
    commands,
    bash: {
      name: 'bash',
      schema: {
        type: 'function',
        function: {
          name: 'bash',
          description: `执行一条 Android CLI 命令。可用命令：\n${compactCatalog}`,
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string', description: '一条 CLI 命令。' },
            },
            required: ['command'],
            additionalProperties: false,
          },
        },
      },
      async execute(arguments_) {
        const input = arguments_['command']
        if (typeof input !== 'string') return failure('invalid_command', 'command 必须是字符串。')
        try {
          const [name, ...argv] = tokenize(input)
          if (name === undefined) return failure('empty_command', '请提供 CLI 命令。')
          const command = byName.get(name)
          if (command === undefined) {
            return failure('command_not_found', `未知命令 ${name}。请从 bash 工具目录选择命令。`)
          }
          return await command.tool.execute(command.parse(argv))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return failure('invalid_arguments', `${message}。请按本轮动态上下文中的 usage 重试。`)
        }
      },
    },
    detailsFor(query) {
      const matched = commands.filter(command =>
        command.keywords.some(keyword => query.toLowerCase().includes(keyword.toLowerCase())),
      )
      return {
        names: matched.map(command => command.name),
        content: matched.map(command => [
          `- ${command.name}: ${command.summary}`,
          `  usage: ${command.usage}`,
          ...command.examples.map(example => `  example: ${example}`),
        ].join('\n')).join('\n'),
      }
    },
  }
}
