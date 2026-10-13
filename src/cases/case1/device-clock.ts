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
  const relative = text === '明天' ? 1 : text === '后天' ? 2 : /^\+(\d+)d$/.exec(text)?.[1]
  if (relative !== undefined) return wallToEpoch(Date.UTC(p['year']!, p['month']! - 1, p['day']! + Number(relative), p['hour']!, p['minute']!, p['second']!), timeZone)
  const plain = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text)
  if (plain) {
    const year = Number(plain[1]), month = Number(plain[2]), day = Number(plain[3])
    const hour = Number(plain[4] ?? 0), minute = Number(plain[5] ?? 0), second = Number(plain[6] ?? 0)
    const wall = Date.UTC(year, month - 1, day, hour, minute, second), date = new Date(wall)
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
      || hour > 23 || minute > 59 || second > 59) return undefined
    const epoch = wallToEpoch(wall, timeZone), actual = zonedParts(epoch, timeZone)
    return actual['hour'] === hour && actual['minute'] === minute ? epoch : undefined
  }
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : undefined
}
