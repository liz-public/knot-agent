export function parseDateExpr(expr: string, now = new Date()): Date | undefined {
  const text = expr.trim()
  if (text.length === 0) return undefined
  if (text === '明天') return new Date(now.getTime() + 86_400_000)
  if (text === '后天') return new Date(now.getTime() + 2 * 86_400_000)
  const relativeDays = /^\+(\d+)d$/.exec(text)
  if (relativeDays !== null) {
    const days = Number(relativeDays[1])
    if (!Number.isFinite(days)) return undefined
    return new Date(now.getTime() + days * 86_400_000)
  }
  const parsed = Date.parse(text)
  if (!Number.isFinite(parsed)) return undefined
  return new Date(parsed)
}

export function startOfLocalDay(now = new Date()): number {
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

export function formatLocalDateTime(millis: number): string {
  const date = new Date(millis)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
