import type { AdbExecutor } from './executor.js'
import { parseContentRows } from './parse.js'

const CALL_TYPE_INCOMING = 1
const CALL_TYPE_OUTGOING = 2
const CALL_TYPE_MISSED = 3

export interface CallLogRecord {
  readonly number: string
  readonly call_type: number
  readonly call_type_label: string
  readonly date_millis: number
  readonly cached_name?: string
}

export interface CallLogQuery {
  readonly type: string
  readonly time_scope: string
  readonly limit: number
  readonly groupby_ctype: boolean
}

function callTypeLabel(type: number): string {
  switch (type) {
    case CALL_TYPE_INCOMING: return '已接来电'
    case CALL_TYPE_OUTGOING: return '已拨出'
    case CALL_TYPE_MISSED: return '未接'
    case 4: return '语音留言'
    case 5: return '已拒接'
    case 6: return '已拦截'
    default: return `其他(${type})`
  }
}

async function deviceNowMs(executor: AdbExecutor): Promise<number> {
  const seconds = Number(await executor.shell('date +%s'))
  if (!Number.isFinite(seconds)) throw new Error('device_clock_unavailable')
  return seconds * 1000
}

async function deviceTimeZone(executor: AdbExecutor): Promise<string> {
  const tz = (await executor.shell('getprop persist.sys.timezone')).trim()
  return tz.length > 0 ? tz : 'UTC'
}

function startOfTodayMs(epochMs: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date(epochMs)).map(part => [part.type, part.value]),
  )
  const hour = Number(parts['hour'] ?? 0)
  const minute = Number(parts['minute'] ?? 0)
  const second = Number(parts['second'] ?? 0)
  const ms = new Date(epochMs).getMilliseconds()
  return epochMs - ((hour * 3600 + minute * 60 + second) * 1000 + ms)
}

async function sinceMillis(executor: AdbExecutor, timeScope: string): Promise<number> {
  const now = await deviceNowMs(executor)
  const scope = timeScope.trim().toLowerCase()
  if (scope === 'last_24h') return now - 86_400_000
  if (scope === 'last_7d') return now - 7 * 86_400_000
  const timeZone = await deviceTimeZone(executor)
  return startOfTodayMs(now, timeZone)
}

function matchesTypeFilter(callType: number, filterType: string): boolean {
  switch (filterType) {
    case 'missed': return callType === CALL_TYPE_MISSED
    case 'outgoing': return callType === CALL_TYPE_OUTGOING
    case 'incoming': return callType === CALL_TYPE_INCOMING
    case 'all': return true
    default: return true
  }
}

async function readCallRows(executor: AdbExecutor, maxRows: number): Promise<CallLogRecord[]> {
  const rows = parseContentRows(await executor.shellLines(
    'content query --uri content://call_log/calls --projection number:type:date:cached_name --sort "date DESC"',
  ))
  const result: CallLogRecord[] = []
  for (const row of rows) {
    const number = row['number'] ?? ''
    if (number.length === 0) continue
    const callType = Number(row['type'])
    const dateMillis = Number(row['date'])
    if (!Number.isFinite(callType) || !Number.isFinite(dateMillis)) continue
    const cachedName = row['cached_name']
    result.push({
      number,
      call_type: callType,
      call_type_label: callTypeLabel(callType),
      date_millis: dateMillis,
      ...(cachedName === undefined || cachedName.length === 0 ? {} : { cached_name: cachedName }),
    })
    if (result.length >= maxRows) break
  }
  return result
}

function withOrdinals(calls: readonly CallLogRecord[]): Array<CallLogRecord & { ordinal_1based: number }> {
  return calls.map((call, index) => ({ ...call, ordinal_1based: index + 1 }))
}

export async function queryCallLog(executor: AdbExecutor, query: CallLogQuery) {
  const filterType = query.type.trim().toLowerCase() || 'all'
  const timeScope = query.time_scope.trim().toLowerCase() || 'today'
  const limit = Math.min(Math.max(query.limit, 1), 500)
  const since = await sinceMillis(executor, timeScope)
  const fetchLimit = filterType === 'all' && query.groupby_ctype ? Math.min(limit * 15, 3000) : limit * 3
  const rows = (await readCallRows(executor, fetchLimit)).filter(call => call.date_millis >= since)

  if (filterType === 'all' && query.groupby_ctype) {
    const missed = withOrdinals(rows.filter(call => call.call_type === CALL_TYPE_MISSED).slice(0, limit))
    const outgoing = withOrdinals(rows.filter(call => call.call_type === CALL_TYPE_OUTGOING).slice(0, limit))
    const incoming = withOrdinals(rows.filter(call => call.call_type === CALL_TYPE_INCOMING).slice(0, limit))
    return {
      filter_type: filterType,
      time_scope: timeScope,
      limit_used: limit,
      groupby_ctype: true,
      missed_calls: missed,
      incoming_calls: incoming,
      outgoing_calls: outgoing,
      call_count: missed.length + incoming.length + outgoing.length,
    }
  }

  const calls = withOrdinals(rows.filter(call => matchesTypeFilter(call.call_type, filterType)).slice(0, limit))
  return {
    filter_type: filterType,
    time_scope: timeScope,
    limit_used: limit,
    groupby_ctype: false,
    call_count: calls.length,
    calls,
  }
}
