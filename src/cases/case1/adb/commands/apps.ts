import type { AskPort } from '../../ask-port.js'
import type { ToolHandler } from '../../dispatcher.js'
import { parseAlarmRepeatWeekdays } from '../alarm.js'
import type { AppIndex } from '../app-index.js'
import { parseDateExpr } from '../datetime.js'
import type { AdbExecutor } from '../executor.js'
import { err, ok } from '../json.js'
import { shellQuote } from '../parse.js'

export interface AppHandlerOptions { readonly askPort?: AskPort; readonly appIndex?: AppIndex }

export function appHandlers(executor: AdbExecutor, options: AppHandlerOptions = {}): Readonly<Record<string, ToolHandler>> {
  return {
    async launch_app(arguments_) { const packageName = arguments_['package_name']; if (typeof packageName !== 'string') return err('empty_package'); await executor.shell(`monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`); return ok({ package_name: packageName }, '已向系统发起应用启动请求。') },
    async list_apps(arguments_) {
      if (options.appIndex === undefined) return err('app_index_unavailable')
      const parsedLimit = Number(arguments_['limit'] ?? 40)
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1) return err('invalid_limit')
      const query = typeof arguments_['query'] === 'string' ? arguments_['query'] : ''
      const apps = await options.appIndex.search(query, parsedLimit)
      return ok(
        { ...(query.length > 0 ? { query } : {}), count: apps.length, apps },
        query.length > 0 ? '已搜索安装应用。' : '已列出安装应用。',
      )
    },
    async open_android_uri(arguments_) { const uri = arguments_['uri']; if (typeof uri !== 'string') return err('empty_uri'); await executor.shell(`am start -a android.intent.action.VIEW -d ${shellQuote(uri)}`); return ok({ uri }, '已向系统发起打开 URI 请求。') },
    async set_alarm_clock(arguments_) {
      const hour = Number(arguments_['hour'])
      const minute = arguments_['minute'] === undefined ? 0 : Number(arguments_['minute'])
      if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
        return err('invalid_time')
      }
      const repeatRaw = typeof arguments_['repeat_weekdays'] === 'string' ? arguments_['repeat_weekdays'] : ''
      const repeatDays = repeatRaw.trim().length > 0 ? parseAlarmRepeatWeekdays(repeatRaw) : undefined
      if (repeatRaw.trim().length > 0 && repeatDays === undefined) return err('bad_repeat_days')
      const repeatClause = repeatDays === undefined ? '' : ` --eia android.intent.extra.alarm.DAYS ${repeatDays.join(',')}`
      await executor.shell(
        `am start -a android.intent.action.SET_ALARM --ei android.intent.extra.alarm.HOUR ${hour} --ei android.intent.extra.alarm.MINUTES ${minute} --ez android.intent.extra.SKIP_UI true${repeatClause}`,
      )
      return ok({ action: 'alarm_set' }, '已向系统发起设置闹钟请求。')
    },
    async show_alarm_clocks() { await executor.shell('am start -a android.intent.action.SHOW_ALARMS'); return ok({ action: 'show_alarms_requested' }, '已向系统发起打开闹钟列表请求。') },
    date(arguments_) { const expr = arguments_['expr']; const now = new Date(); if (typeof expr !== 'string' || expr.trim().length === 0) return ok({ iso: now.toISOString() }, '当前时间。'); const target = parseDateExpr(expr, now); return target === undefined ? err('bad_date') : ok({ expr: expr.trim(), iso: target.toISOString() }, '日期已解析。') },
    async ask(arguments_) { if (options.askPort === undefined) return err('no_ask_port'); const question = arguments_['question']; const choices = typeof arguments_['choices'] === 'string' ? arguments_['choices'].split(',').map(item => item.trim()).filter(Boolean) : undefined; if (typeof question !== 'string') return err('empty_question'); const response = await options.askPort.ask({ question, ...(choices === undefined ? {} : { choices }) }); return ok({ answer: response.answer }, '已收到用户回答。') },
  }
}
