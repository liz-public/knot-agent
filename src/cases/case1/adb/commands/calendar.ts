import type { ToolHandler } from '../../dispatcher.js'
import { deleteCalendarEvent, listCalendarEvents, upsertCalendarEvent } from '../calendar.js'
import type { AdbExecutor } from '../executor.js'
import { err } from '../json.js'

export function calendarHandlers(executor: AdbExecutor): Readonly<Record<string, ToolHandler>> {
  return {
    list_calendar_events(arguments_) {
      const ahead = Number(arguments_['days_ahead'] ?? 7)
      const before = Number(arguments_['days_before'] ?? 0)
      if (!Number.isInteger(ahead) || ahead < 1 || !Number.isInteger(before) || before < 0) return err('invalid_day_window')
      return listCalendarEvents(executor, ahead, before)
    },
    calendar_create_or_update_event(arguments_) {
      const title = arguments_['title']
      const dateExpr = arguments_['date_expr']
      if (typeof title !== 'string' || title.trim().length === 0) return err('need_title')
      if (typeof dateExpr !== 'string' || dateExpr.trim().length === 0) return err('need_date_expr')
      const durationHours = Number(arguments_['duration_hours'] ?? 1)
      if (!Number.isFinite(durationHours) || durationHours <= 0) return err('invalid_duration')
      const location = typeof arguments_['location'] === 'string' ? arguments_['location'] : undefined
      const eventId = arguments_['event_id'] === undefined ? undefined : Number(arguments_['event_id'])
      if (eventId !== undefined && (!Number.isInteger(eventId) || eventId < 1)) return err('invalid_event_id')
      return upsertCalendarEvent(executor, {
        title: title.trim(),
        dateExpr: dateExpr.trim(),
        durationHours,
        ...(location === undefined ? {} : { location }),
        ...(eventId === undefined ? {} : { eventId }),
      })
    },
    calendar_delete_event(arguments_) {
      const eventId = Number(arguments_['event_id'])
      return !Number.isInteger(eventId) || eventId < 1
        ? err('need_event_id', '需要 event_id。')
        : deleteCalendarEvent(executor, eventId)
    },
  }
}
