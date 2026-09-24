import type { AskPort } from '../../ask-port.js'
import type { ToolHandler } from '../../dispatcher.js'
import type { AppIndex } from '../app-index.js'
import { parseDateExpr } from '../datetime.js'
import type { AdbExecutor } from '../executor.js'
import { err, ok } from '../json.js'
import { shellQuote } from '../parse.js'

export interface AppHandlerOptions { readonly askPort?: AskPort; readonly appIndex?: AppIndex }

export function appHandlers(executor: AdbExecutor, options: AppHandlerOptions = {}): Readonly<Record<string, ToolHandler>> {
  return {
    async launch_app(arguments_) { const packageName = arguments_['package_name']; if (typeof packageName !== 'string') return err('empty_package'); await executor.shell(`monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`); return ok({ package_name: packageName }, '已向系统发起应用启动请求。') },
    async list_apps(arguments_) { const query = arguments_['query']; if (options.appIndex === undefined) return err('app_index_unavailable'); if (typeof query !== 'string') return err('empty_query'); const apps = await options.appIndex.search(query); return ok({ query, count: apps.length, apps }, '已搜索安装应用。') },
    async open_android_uri(arguments_) { const uri = arguments_['uri']; if (typeof uri !== 'string') return err('empty_uri'); await executor.shell(`am start -a android.intent.action.VIEW -d ${shellQuote(uri)}`); return ok({ uri }, '已向系统发起打开 URI 请求。') },
    async set_alarm_clock(arguments_) { const hour = arguments_['hour']; const minute = arguments_['minute'] ?? 0; const label = typeof arguments_['label'] === 'string' ? arguments_['label'] : 'Alarm'; if (typeof hour !== 'number') return err('invalid_hour'); await executor.shell(`am start -a android.intent.action.SET_ALARM --ei android.intent.extra.alarm.HOUR ${hour} --ei android.intent.extra.alarm.MINUTES ${minute} --es android.intent.extra.alarm.MESSAGE ${shellQuote(label)}`); return ok({ hour, minute, label }, '已向系统发起设置闹钟请求。') },
    async show_alarm_clocks() { await executor.shell('am start -a android.intent.action.SHOW_ALARMS'); return ok({ action: 'show_alarms_requested' }, '已向系统发起打开闹钟列表请求。') },
    date(arguments_) { const expr = arguments_['expr']; const now = new Date(); if (typeof expr !== 'string' || expr.trim().length === 0) return ok({ iso: now.toISOString() }, '当前时间。'); const target = parseDateExpr(expr, now); return target === undefined ? err('bad_date') : ok({ expr: expr.trim(), iso: target.toISOString() }, '日期已解析。') },
    async ask(arguments_) { if (options.askPort === undefined) return err('no_ask_port'); const question = arguments_['question']; const choices = arguments_['choices']; if (typeof question !== 'string') return err('empty_question'); const response = await options.askPort.ask({ question, ...(Array.isArray(choices) ? { choices: choices.filter((item): item is string => typeof item === 'string') } : {}) }); return ok({ answer: response.answer }, '已收到用户回答。') },
  }
}
