import type { ApprovalPort } from '../../approval-port.js'
import type { ToolHandler } from '../../dispatcher.js'
import type { AdbExecutor } from '../executor.js'
import { err, ok } from '../json.js'
import { parseContentRows, shellQuote } from '../parse.js'
import type { AdbDeviceSession, ContactCandidate } from '../session.js'

export interface TelecomHandlerOptions { readonly approvalPort?: ApprovalPort }

async function queryContacts(executor: AdbExecutor, query: string): Promise<ContactCandidate[]> {
  const rows = parseContentRows(await executor.shellLines('content query --uri content://com.android.contacts/data/phones --projection display_name:data1'))
  const normalized = query.trim().toLowerCase(); const seen = new Set<string>(); const result: ContactCandidate[] = []
  for (const row of rows.filter(item => (item['display_name'] ?? '').toLowerCase().includes(normalized))) {
    const display_name = row['display_name'] ?? ''; const phone = row['data1'] ?? ''; const key = `${display_name}\0${phone}`
    if (seen.has(key)) continue
    seen.add(key); result.push({ ordinal_1based: result.length + 1, display_name, ...(phone.length === 0 ? {} : { phone }) })
  }
  return result
}

function pendingState(session: AdbDeviceSession, value: AdbDeviceSession['pending']) {
  session.pending = value
  return { key: 'pending.selection', value: value ?? null }
}

export function telecomHandlers(executor: AdbExecutor, session: AdbDeviceSession, options: TelecomHandlerOptions = {}): Readonly<Record<string, ToolHandler>> {
  return {
    async contact(arguments_) {
      const sub = arguments_['sub']
      if (sub === 'add') {
        const phone = arguments_['phone']; const name = arguments_['name']
        if (typeof phone !== 'string' || typeof name !== 'string' || phone.length === 0 || name.length === 0) return err('need_phone_and_name')
        await executor.shell('content insert --uri content://com.android.contacts/raw_contacts --bind account_type:s:com.android.local --bind account_name:s:Phone')
        return ok({ action: 'contact_add_requested', phone, name }, '已请求新建联系人。')
      }
      if (sub === 'delete') {
        const phone = arguments_['phone']; const id = arguments_['id']
        if (typeof phone === 'string' && phone.length > 0) {
          await executor.shell(`content delete --uri content://com.android.contacts/raw_contacts --where ${shellQuote(`phone=${phone}`)}`)
          return ok({ action: 'delete_requested', phone }, '已请求删除联系人。')
        }
        if (typeof id === 'string' && id.length > 0) {
          await executor.shell(`content delete --uri content://com.android.contacts/contacts --where ${shellQuote(`_id=${id}`)}`)
          return ok({ action: 'delete_requested', contact_id: id }, '已请求删除联系人。')
        }
        return err('need_contact_id_or_phone')
      }
      const query = arguments_['query']
      if ((sub !== 'lookup' && sub !== 'call') || typeof query !== 'string' || query.trim().length === 0) return err('invalid_contact_request')
      const candidates = await queryContacts(executor, query)
      if (candidates.length === 0) return err('no_match', '没有匹配联系人。')
      if (sub === 'call' && candidates.length === 1 && arguments_['explicit'] !== true) {
        const only = candidates[0]!
        if (only.phone === undefined) return err('no_phone')
        if (options.approvalPort === undefined) return err('approval_required', '拨号前需要用户审批。')
        const approval = await options.approvalPort.request({ toolName: 'contact.call', arguments: { display_name: only.display_name, phone: only.phone } })
        if (approval !== 'allow') return err('user_denied')
        await executor.shell(`am start -a android.intent.action.CALL -d tel:${only.phone}`); pendingState(session, undefined)
        return ok({ action: 'dial_requested', display_name: only.display_name, phone: only.phone }, '已向系统发起拨号请求。')
      }
      session.pending = { source: 'contact', candidates }
      const visible = candidates.map(item => ({ ordinal_1based: item.ordinal_1based, display_name: item.display_name }))
      return ok({ action: 'candidates', intent: sub, candidates: visible }, sub === 'lookup' ? '请让用户选择序号。' : '请调用 select 选择联系人。', { key: 'pending.selection', value: { source: 'contact', candidates: visible } })
    },
    async dial(arguments_) {
      const phone = arguments_['phone']; if (typeof phone !== 'string' || phone.trim().length === 0) return err('empty_or_invalid_number')
      const normalized = phone.replace(/\s+/g, ''); await executor.shell(`am start -a android.intent.action.CALL -d tel:${normalized}`)
      return ok({ action: 'dial_requested', phone_number: normalized }, '已向系统发起拨号请求。')
    },
    async select(arguments_) {
      const ordinal = arguments_['ordinal']; const pending = session.pending
      if (typeof ordinal !== 'number' || pending === undefined) return err('no_active_list')
      const picked = pending.candidates.find(item => item.ordinal_1based === ordinal); if (picked === undefined) return err('invalid_selection')
      session.pending = undefined
      if (pending.source === 'contact' && picked.phone !== undefined) {
        await executor.shell(`am start -a android.intent.action.CALL -d tel:${picked.phone}`)
        return ok({ action: 'dial_requested', selected: ordinal, display_name: picked.display_name, phone: picked.phone }, '已向系统发起拨号请求。', pendingState(session, undefined))
      }
      return ok({ action: 'selected', selected: ordinal }, '已选择候选项。', pendingState(session, undefined))
    },
  }
}
