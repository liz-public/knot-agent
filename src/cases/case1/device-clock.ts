export function zonedParts(epoch: number, timeZone: string): Record<string, number> {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epoch))
    .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]))
}
export function wallToEpoch(wall: number, timeZone: string): number {
  let epoch = wall
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(epoch, timeZone)
    const asUtc = Date.UTC(p['year']!, p['month']! - 1, p['day']!, p['hour']!, p['minute']!, p['second']!)
    epoch = wall - (asUtc - epoch)
  }
  return epoch
}
export function startOfDeviceDay(epoch: number, timeZone: string, daysFromToday = 0): number {
  const p = zonedParts(epoch, timeZone)
  return wallToEpoch(Date.UTC(p['year']!, p['month']! - 1, p['day']! + daysFromToday), timeZone)
}
export function parseDeviceDate(text: string, now: number, timeZone: string): number | undefined {
  const p = zonedParts(now, timeZone)
  const normalized = text.replace(/^([+-])(\d+)d(?=T|$)/, '$1d$2')
    .replace(/^([+-])(\d+)([mw])(\d+)d(?=T|$)/, '$1$3$2d$4')
  const match = /^(\d{4}-\d{2}-\d{2}|[+-]d\d+|[+-][mw]\d+d\d+)(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(normalized)
  if (!match) return undefined
  const [datePart, hour, minute] = [match[1]!, Number(match[2] ?? 0), Number(match[3] ?? 0)]
  let year: number, month: number, day: number
  if (/^\d/.test(datePart)) [year, month, day] = datePart.split('-').map(Number) as [number, number, number]
  else {
    const relative = /^([+-])([dmw])(\d+)(?:d(\d+))?$/.exec(datePart)!
    const offset = Number(relative[3]) * (relative[1] === '+' ? 1 : -1)
    if (!Number.isSafeInteger(offset)) return undefined
    const base = new Date(Date.UTC(p['year']!, p['month']! - 1, p['day']!))
    const targetDay = Number(relative[4])
    if (relative[2] === 'd') base.setUTCDate(base.getUTCDate() + offset)
    else if (relative[2] === 'm') { base.setUTCDate(1); base.setUTCMonth(base.getUTCMonth() + offset) }
    else {
      if (targetDay < 1 || targetDay > 7) return undefined
      base.setUTCDate(base.getUTCDate() - (base.getUTCDay() + 6) % 7 + offset * 7 + targetDay - 1)
    }
    year = base.getUTCFullYear(); month = base.getUTCMonth() + 1
    day = relative[2] === 'm' ? targetDay : base.getUTCDate()
  }
  const wall = Date.UTC(year, month - 1, day, hour, minute), date = new Date(wall)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
    || hour > 23 || minute > 59 || Number(match[4] ?? 0) > 59) return undefined
  const epoch = wallToEpoch(wall, timeZone), actual = zonedParts(epoch, timeZone)
  return actual['hour'] === hour && actual['minute'] === minute ? epoch : undefined
}
