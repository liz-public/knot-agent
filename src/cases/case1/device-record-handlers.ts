import type { DevicePort } from './device-port.js'
import type { ToolHandler } from './dispatcher.js'
import { deviceResult } from './device-result.js'
import { err } from './adb/json.js'
import { parseDeviceDate, startOfDeviceDay } from './device-clock.js'

export function deviceRecordHandlers(port: DevicePort): Readonly<Record<string, ToolHandler>> {
  const clock = async (context: Parameters<ToolHandler>[1]) => port.request('clock.read', {}, context)
  return {
    async list_notifications(args, context) {
      const limit = Number(args['limit'] ?? 30)
      if (!Number.isInteger(limit) || limit < 1) return err('invalid_limit')
      const result = await port.request('notifications.read', { limit: Math.min(limit, 500) }, context)
      return deviceResult(result, result, '已读取当前通知列表。')
    },
    async list_call_history(args, context) {
      const type = String(args['type'] ?? 'all'), scope = String(args['time_scope'] ?? 'today'), limit = Number(args['limit'] ?? 100)
      if (!['all', 'incoming', 'outgoing', 'missed'].includes(type)) return err('invalid_type')
      if (!['today', 'last_24h', 'last_7d'].includes(scope) || !Number.isInteger(limit) || limit < 1) return err('invalid_call_query')
      const time = await clock(context)
      if (time['ok'] !== true) return deviceResult(time, {}, '')
      const now = Number(time['epochMillis'])
      const sinceMillis = scope === 'today' ? startOfDeviceDay(now, String(time['timeZone'])) : now - (scope === 'last_7d' ? 7 : 1) * 86400000
      const result = await port.request('calls.read', { type, sinceMillis, limit: Math.min(limit, 500) }, context)
      const calls = ((result['calls'] ?? []) as Record<string, unknown>[]).map(({ callRef: _, ...visible }) => visible)
      const grouped: Record<string, Record<string, unknown>[]> | undefined = args['groupby_ctype'] === true ? {} : undefined
      if (grouped) for (const call of calls) (grouped[String(call['call_type'])] ??= []).push(call)
      const reply = deviceResult(result, { count: calls.length, calls, ...(grouped ? { groups: grouped } : {}) }, '已列出通话记录，可由用户明确选择回拨。')
      return result['ok'] === true ? { ...reply, state: { key: 'pending.selection',
        value: calls.length ? { kind: 'call_history', count: calls.length } : null } } : reply
    },
    async list_sms_messages(args, context) {
      const limit = Number(args['limit'] ?? 30)
      if (!Number.isInteger(limit) || limit < 1) return err('invalid_limit')
      const result = await port.request('sms.read', { limit: Math.min(limit, 100) }, context)
      return deviceResult(result, result, '已读取请求的短信列表。')
    },
    reject_incoming_call: async (_, context) => {
      const result = await port.request('call.reject', {}, context)
      return deviceResult(result, result, '系统已处理挂断请求。')
    },
    async list_calendar_events(args, context) {
      const ahead = Number(args['days_ahead'] ?? 7), before = Number(args['days_before'] ?? 0)
      if (!Number.isInteger(ahead) || ahead < 1 || !Number.isInteger(before) || before < 0) return err('invalid_day_window')
      const time = await clock(context)
      if (time['ok'] !== true) return deviceResult(time, {}, '')
      const now = Number(time['epochMillis']), zone = String(time['timeZone'])
      const result = await port.request('calendar.read', { startMillis: startOfDeviceDay(now, zone, -Math.min(before, 30)),
        endMillis: startOfDeviceDay(now, zone, Math.min(ahead, 30)) }, context)
      return deviceResult(result, result, '已列出日历事件。')
    },
    async calendar_create_or_update_event(args, context) {
      const title = args['title'], expr = args['date_expr'], duration = Number(args['duration_hours'] ?? 1)
      if (typeof title !== 'string' || !title.trim()) return err('need_title')
      if (typeof expr !== 'string' || !expr.trim()) return err('need_date_expr')
      if (!Number.isFinite(duration) || duration <= 0) return err('invalid_duration')
      const time = await clock(context)
      if (time['ok'] !== true) return deviceResult(time, {}, '')
      const begin = parseDeviceDate(expr.trim(), Number(time['epochMillis']), String(time['timeZone']))
      if (begin === undefined) return err('bad_start_time')
      const id = args['event_id'] === undefined ? undefined : Number(args['event_id'])
      if (id !== undefined && (!Number.isInteger(id) || id < 1)) return err('invalid_event_id')
      const result = await port.request('calendar.upsert', { title: title.trim(), beginMillis: begin, endMillis: begin + duration * 3600000,
        timeZone: time['timeZone'], ...(id ? { eventId: id } : {}), ...(typeof args['location'] === 'string' ? { location: args['location'] } : {}) }, context)
      return deviceResult(result, result, '日程写入已完成。')
    },
    async calendar_delete_event(args, context) {
      const id = Number(args['event_id'])
      if (!Number.isInteger(id) || id < 1) return err('need_event_id')
      const result = await port.request('calendar.delete', { eventId: id }, context)
      return deviceResult(result, result, '日程删除已完成。')
    },
  }
}
