export function parsePercent(raw: string, current: number): number {
  const text = raw.trim()
  if (!/^[+-]?\d+$/.test(text)) throw new Error(`invalid percent: ${raw}`)
  const value = Number(text.replace(/^[+-]/, ''))
  if (!Number.isFinite(value)) throw new Error(`invalid percent: ${raw}`)
  if (text.startsWith('+')) return Math.min(100, current + value)
  if (text.startsWith('-')) return Math.max(0, current - value)
  return Math.max(0, Math.min(100, value))
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
