import type { CliArgument, CliCommand } from './cli.js'

export interface ParsedCliCommand {
  readonly name: string
  readonly positional: readonly string[]
  readonly flags: ReadonlyMap<string, string | true>
}

/** Parse CLI syntax only. This layer deliberately knows nothing about tools. */
export function parseCliCommand(input: string): ParsedCliCommand {
  const [name, ...tokens] = tokenize(input)
  if (name === undefined) throw new Error('empty_command')

  const positional: string[] = []
  const flags = new Map<string, string | true>()
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token === undefined) continue
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }

    const key = token.slice(2)
    if (key.length === 0) throw new Error('invalid_flag: --')
    const next = tokens[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(key, next)
      index += 1
    } else {
      flags.set(key, true)
    }
  }
  return { name, positional, flags }
}

/** Bind syntax to one Catalog command. Only protocol shape is validated here. */
export function bindCliArguments(
  parsed: ParsedCliCommand,
  command: CliCommand,
): Record<string, string | boolean> {
  const positionalDefinitions = command.arguments.filter(argument => argument.format === 'positional')
  if (parsed.positional.length > positionalDefinitions.length) {
    throw new Error(`unexpected positional argument: ${parsed.positional[positionalDefinitions.length]}`)
  }

  const result: Record<string, string | boolean> = {}
  positionalDefinitions.forEach((definition, index) => {
    const value = parsed.positional[index]
    if (value === undefined) {
      if (definition.required) throw new Error(`missing argument: ${placeholder(definition)}`)
      return
    }
    result[definition.name] = checkedValue(definition, value)
  })

  const flagDefinitions = new Map(command.arguments
    .filter(argument => argument.format !== 'positional')
    .map(argument => [flagName(argument), argument]))

  for (const [name, value] of parsed.flags) {
    const definition = flagDefinitions.get(name)
    if (definition === undefined) throw new Error(`unknown argument: --${name}`)
    if (definition.format === 'switch') {
      if (value !== true) throw new Error(`argument --${name} does not take a value`)
      result[definition.name] = true
    } else {
      if (value === true) throw new Error(`missing value: --${name}`)
      result[definition.name] = checkedValue(definition, value)
    }
  }

  for (const definition of command.arguments) {
    if (definition.format !== 'positional' && definition.required && result[definition.name] === undefined) {
      throw new Error(`missing argument: ${renderBareArgument(definition)}`)
    }
  }
  return result
}

export function renderUsage(command: Pick<CliCommand, 'name' | 'arguments'>): string {
  return [command.name, ...command.arguments.map(renderArgument)].join(' ')
}

function renderArgument(argument: CliArgument): string {
  const bare = renderBareArgument(argument)
  return argument.required ? bare : `[${bare}]`
}

function renderBareArgument(argument: CliArgument): string {
  if (argument.format === 'positional') return placeholder(argument)
  const flag = `--${flagName(argument)}`
  return argument.format === 'switch' ? flag : `${flag} ${placeholder(argument)}`
}

function placeholder(argument: CliArgument): string {
  if (argument.format === 'switch') throw new Error(`switch argument has no value: ${argument.name}`)
  return `<${argument.type === 'enum'
    ? argument.values.join('|')
    : ('label' in argument ? argument.label : undefined) ?? argument.name}>`
}

function flagName(argument: CliArgument): string {
  return (('flag' in argument ? argument.flag : undefined) ?? argument.name).replace(/^--/, '')
}

function checkedValue(argument: CliArgument, value: string): string {
  if (argument.format === 'switch') throw new Error(`switch argument has no value: ${argument.name}`)
  if (argument.type === 'enum' && !argument.values.includes(value)) {
    throw new Error(`invalid ${argument.name}: ${value}; expected ${argument.values.join('|')}`)
  }
  return value
}

function tokenize(command: string): string[] {
  const tokens: string[] = []
  let token = ''
  let quote: '"' | "'" | undefined
  let escaped = false
  let started = false
  for (const character of command.trim()) {
    if (escaped) {
      token += character
      started = true
      escaped = false
    } else if (character === '\\') {
      escaped = true
      started = true
    } else if (quote !== undefined) {
      if (character === quote) quote = undefined
      else token += character
    } else if (character === '"' || character === "'") {
      quote = character
      started = true
    } else if (/\s/.test(character)) {
      if (started) {
        tokens.push(token)
        token = ''
        started = false
      }
    } else {
      token += character
      started = true
    }
  }
  if (escaped) token += '\\'
  if (quote !== undefined) throw new Error('unterminated quote')
  if (started) tokens.push(token)
  return tokens
}
