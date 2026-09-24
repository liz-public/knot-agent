export function one(arguments_: readonly string[], usage: string): string {
  if (arguments_.length !== 1 || arguments_[0] === undefined) throw new Error(`usage: ${usage}`)
  return arguments_[0]
}

export function onOff(arguments_: readonly string[], usage: string): boolean {
  const value = one(arguments_, usage)
  if (value === 'on') return true
  if (value === 'off') return false
  throw new Error(`usage: ${usage}`)
}

export function parseFlags(arguments_: readonly string[]) {
  const positional: string[] = []
  const flags = new Map<string, string | true>()
  for (let index = 0; index < arguments_.length; index++) {
    const token = arguments_[index]
    if (token === undefined) continue
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }
    const key = token.slice(2)
    const next = arguments_[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(key, next)
      index += 1
    } else {
      flags.set(key, true)
    }
  }
  return { positional, flags }
}
