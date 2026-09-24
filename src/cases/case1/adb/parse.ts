export function one(argv: readonly string[], usage: string): string {
  if (argv.length !== 1 || argv[0] === undefined) throw new Error(`usage: ${usage}`)
  return argv[0]
}

export function onOff(argv: readonly string[], usage: string): boolean {
  const value = one(argv, usage)
  if (value === 'on') return true
  if (value === 'off') return false
  throw new Error(`usage: ${usage}`)
}

export function parsePercent(raw: string, current: number): number {
  const text = raw.trim()
  if (!/^[+-]?\d+$/.test(text)) throw new Error(`invalid percent: ${raw}`)
  const value = Number(text.replace(/^[+-]/, ''))
  if (!Number.isFinite(value)) throw new Error(`invalid percent: ${raw}`)
  if (text.startsWith('+')) return Math.min(100, current + value)
  if (text.startsWith('-')) return Math.max(0, current - value)
  return Math.max(0, Math.min(100, value))
}

export function parseFlags(argv: readonly string[]): { positional: string[]; flags: Map<string, string | true> } {
  const positional: string[] = []
  const flags = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === undefined) continue
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(key, next)
        i++
      } else {
        flags.set(key, true)
      }
    } else {
      positional.push(token)
    }
  }
  return { positional, flags }
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Parse `content query` rows like `Row: 0 _id=1, title=foo` */
export function parseContentRows(lines: readonly string[]): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = []
  for (const line of lines) {
    const match = /^Row:\s*\d+\s+(.+)$/.exec(line)
    if (match === null) continue
    const record: Record<string, string> = {}
    const body = match[1]
    if (body === undefined) continue
    for (const part of body.split(', ')) {
      const eq = part.indexOf('=')
      if (eq <= 0) continue
      record[part.slice(0, eq)] = part.slice(eq + 1)
    }
    rows.push(record)
  }
  return rows
}
