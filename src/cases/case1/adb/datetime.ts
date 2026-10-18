import { parseDeviceDate } from '../device-clock.js'

export function parseDateExpr(expr: string, now = new Date()): Date | undefined {
  const epoch = parseDeviceDate(expr.trim(), now.getTime(), Intl.DateTimeFormat().resolvedOptions().timeZone)
  return epoch === undefined ? undefined : new Date(epoch)
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

export function localDateFields(date: Date): Record<string, string> {
  const local = formatLocalDateTime(date.getTime())
  return { local_date: local.slice(0, 10), local_time: local.slice(11),
    weekday: ['日', '一', '二', '三', '四', '五', '六'][date.getDay()]!,
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone }
}
