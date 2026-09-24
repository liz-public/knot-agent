import type { AdbExecutor } from './executor.js'
import { formatLocalDateTime, parseDateExpr, startOfLocalDay } from './datetime.js'
import { err, ok } from './json.js'
import { parseContentRows, shellQuote } from './parse.js'

async function writableCalendarId(executor: AdbExecutor): Promise<string | undefined> {
  const lines = await executor.shellLines(
    'content query --uri content://com.android.calendar/calendars --projection _id:isPrimary:visible',
  )
  const rows = parseContentRows(lines)
  const primary = rows.find(row => row['isPrimary'] === '1' && row['visible'] === '1')
  if (primary?.['_id'] !== undefined) return primary['_id']
  const visible = rows.find(row => row['visible'] === '1')
  return visible?.['_id']
}

export async function listCalendarEvents(
  executor: AdbExecutor,
  daysAhead = 7,
  daysBefore = 0,
) {
  const ahead = Math.min(30, Math.max(1, daysAhead))
  const before = Math.min(30, Math.max(0, daysBefore))
  const todayStart = startOfLocalDay()
  const start = todayStart - before * 86_400_000
  const end = todayStart + ahead * 86_400_000
  const lines = await executor.shellLines(
    'content query --uri content://com.android.calendar/events --projection _id:title:dtstart:dtend:eventLocation',
  )
  const events = parseContentRows(lines)
    .map(row => {
      const begin = Number(row['dtstart'])
      const finish = Number(row['dtend'])
      if (!Number.isFinite(begin) || begin < start || begin >= end) return undefined
      return {
        event_id: Number(row['_id']),
        title: row['title'] ?? '',
        begin_millis: begin,
        end_millis: Number.isFinite(finish) ? finish : begin,
        begin_label: formatLocalDateTime(begin),
        ...(row['eventLocation'] === undefined || row['eventLocation'].length === 0
          ? {}
          : { location: row['eventLocation'] }),
      }
    })
    .filter((event): event is NonNullable<typeof event> => event !== undefined)
    .sort((left, right) => left.begin_millis - right.begin_millis)
  return ok({
    days_ahead: ahead,
    days_before: before,
    count: events.length,
    events,
  }, '已列出日历事件。')
}

export async function upsertCalendarEvent(
  executor: AdbExecutor,
  input: {
    readonly title: string
    readonly dateExpr: string
    readonly durationHours: number
    readonly location?: string
    readonly eventId?: number
  },
) {
  const startMs = parseDateExpr(input.dateExpr)?.getTime()
  if (startMs === undefined || !Number.isFinite(startMs)) {
    return err('bad_start_time', '无法解析日期/时刻。')
  }
  const durationMs = Math.max(1, input.durationHours) * 3_600_000
  const endMs = startMs + durationMs
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const title = shellQuote(input.title)
  const location = input.location === undefined || input.location.length === 0
    ? undefined
    : shellQuote(input.location)

  if (input.eventId !== undefined && input.eventId > 0) {
    const binds = [
      `--bind title:s:${title}`,
      `--bind dtstart:l:${startMs}`,
      `--bind dtend:l:${endMs}`,
      ...(location === undefined ? [] : [`--bind eventLocation:s:${location}`]),
    ].join(' ')
    await executor.shell(
      `content update --uri content://com.android.calendar/events/${input.eventId} ${binds}`,
    )
    return ok({
      action: 'updated',
      event_id: input.eventId,
      begin_label: formatLocalDateTime(startMs),
    }, '已更新日程。')
  }

  const calendarId = await writableCalendarId(executor)
  if (calendarId === undefined) return err('no_writable_calendar', '未找到可写日历。')
  const binds = [
    `--bind calendar_id:i:${calendarId}`,
    `--bind title:s:${title}`,
    `--bind dtstart:l:${startMs}`,
    `--bind dtend:l:${endMs}`,
    `--bind eventTimezone:s:${shellQuote(timezone)}`,
    ...(location === undefined ? [] : [`--bind eventLocation:s:${location}`]),
  ].join(' ')
  const output = await executor.shell(
    `content insert --uri content://com.android.calendar/events ${binds}`,
  )
  const match = /content:\/\/com\.android\.calendar\/events\/(\d+)/.exec(output)
  const eventId = match === null ? undefined : Number(match[1])
  return ok({
    action: 'created',
    ...(eventId === undefined ? {} : { event_id: eventId }),
    begin_label: formatLocalDateTime(startMs),
  }, '已创建日程。')
}

export async function deleteCalendarEvent(executor: AdbExecutor, eventId: number) {
  if (!Number.isFinite(eventId) || eventId <= 0) return err('need_event_id', '需要 event_id。')
  await executor.shell(`content delete --uri content://com.android.calendar/events/${eventId}`)
  return ok({ action: 'deleted', event_id: eventId }, '已删除日程。')
}
