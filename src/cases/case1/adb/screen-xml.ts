export function extractScreenText(xml: string): string {
  const chunks: string[] = []
  for (const match of xml.matchAll(/<node\b[^>]*>/g)) {
    const tag = match[0]
    const text = / text="([^"]*)"/.exec(tag)?.[1]?.trim()
    const desc = / content-desc="([^"]*)"/.exec(tag)?.[1]?.trim()
    const value = text !== undefined && text.length > 0 ? text : desc
    if (value === undefined || value.length === 0) continue
    if (chunks.at(-1) === value) continue
    chunks.push(value)
  }
  return chunks.join('\n')
}
