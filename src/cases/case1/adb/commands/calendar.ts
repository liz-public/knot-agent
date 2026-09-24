import type { ToolHandler } from '../../dispatcher.js'
import { deleteCalendarEvent, listCalendarEvents, upsertCalendarEvent } from '../calendar.js'
import type { AdbExecutor } from '../executor.js'
import { err } from '../json.js'

export function calendarHandlers(executor: AdbExecutor): Readonly<Record<string, ToolHandler>> {
  return {
    list_calendar_events(arguments_) {
      const ahead = typeof arguments_['days_ahead'] === 'number' ? arguments_['days_ahead'] : 7
      const before = typeof arguments_['days_before'] === 'number' ? arguments_['days_before'] : 0
      return listCalendarEvents(executor, ahead, before)
    },
    calendar_create_or_update_event(arguments_) {
      const title = arguments_['title']
      const dateExpr = arguments_['date_expr']
      if (typeof title !== 'string' || title.trim().length === 0) return err('need_title')
      if (typeof dateExpr !== 'string' || dateExpr.trim().length === 0) return err('need_date_expr')
      const durationHours = typeof arguments_['duration_hours'] === 'number' ? arguments_['duration_hours'] : 1
      const location = typeof arguments_['location'] === 'string' ? arguments_['location'] : undefined
      const eventId = typeof arguments_['event_id'] === 'number' ? arguments_['event_id'] : undefined
      return upsertCalendarEvent(executor, {
        title: title.trim(),
        dateExpr: dateExpr.trim(),
        durationHours,
        ...(location === undefined ? {} : { location }),
        ...(eventId === undefined ? {} : { eventId }),
      })
    },
    calendar_delete_event(arguments_) {
      const eventId = arguments_['event_id']
      return typeof eventId !== 'number'
        ? err('need_event_id', '需要 event_id。')
        : deleteCalendarEvent(executor, eventId)
    },
  }
}
