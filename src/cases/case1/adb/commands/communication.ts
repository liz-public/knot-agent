import type { ToolHandler } from '../../dispatcher.js'
import type { AdbExecutor } from '../executor.js'
import { err, ok } from '../json.js'
import { parseContentRows, shellQuote } from '../parse.js'

export function communicationHandlers(executor: AdbExecutor): Readonly<Record<string, ToolHandler>> {
  return {
    async list_sms_messages(arguments_) {
      const parsedLimit = Number(arguments_['limit'] ?? 30)
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1) return err('invalid_limit')
      const limit = parsedLimit
      const rows = parseContentRows(await executor.shellLines("content query --uri content://sms/inbox --projection address:body:date --sort 'date DESC'")).slice(0, Math.min(limit, 100))
      return ok({ count: rows.length, messages: rows }, '已获取短信列表。')
    },
    async send_sms(arguments_) {
      const phone = arguments_['phone']; const text = arguments_['text']; if (typeof phone !== 'string' || typeof text !== 'string' || phone.length === 0) return err('invalid_arguments')
      await executor.shell(`am start -a android.intent.action.SENDTO -d smsto:${phone} --es sms_body ${shellQuote(text)}`); return ok({ phone }, '已向系统发起打开短信编辑页请求。')
    },
    async list_call_history(arguments_) {
      const parsedLimit = Number(arguments_['limit'] ?? 100)
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1) return err('invalid_limit')
      const limit = parsedLimit
      const rows = parseContentRows(await executor.shellLines('content query --uri content://call_log/calls --projection number:type:date --sort "date DESC"')).slice(0, Math.min(limit, 500))
      return ok({ count: rows.length, calls: rows }, '已列出通话记录。')
    },
    async reject_incoming_call() { await executor.shell('input keyevent KEYCODE_ENDCALL'); return ok({ action: 'end_call_requested' }, '已向系统发起挂断请求。') },
    async wechat_send(arguments_) {
      const text = arguments_['text']; if (typeof text !== 'string' || text.trim().length === 0) return err('invalid_args')
      await executor.shell(`am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT ${shellQuote(text)} -n com.tencent.mm/.ui.tools.ShareImgUI`)
      return ok({ action: 'wechat_share_requested' }, '已向系统发起打开微信分享页请求。')
    },
  }
}
