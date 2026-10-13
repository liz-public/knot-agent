import type { DevicePort } from './device-port.js'
import type { ToolHandler } from './dispatcher.js'
import { deviceResult } from './device-result.js'
import { err, ok } from './adb/json.js'

export function deviceContactHandlers(port: DevicePort): Readonly<Record<string, ToolHandler>> {
  return {
    async contact_add(args, context) {
      const phone = args['phone'], name = args['name']
      if (typeof phone !== 'string' || !phone.trim() || typeof name !== 'string' || !name.trim()) return err('need_phone_and_name')
      const result = await port.request('contacts.upsert', { phone: phone.trim(), name: name.trim() }, context)
      return deviceResult(result, { action: result['action'] }, '联系人写入已处理。')
    },
    async contact_delete(args, context) {
      const phone = args['phone']
      if (typeof phone !== 'string' || !phone.trim()) return err('need_phone')
      const result = await port.request('contacts.delete', { phone: phone.trim() }, context)
      return deviceResult(result, { action: result['action'] }, '联系人删除已处理。')
    },
    async contact(args, context) {
      const sub = args['sub'], query = args['query']
      if (!['lookup', 'call'].includes(String(sub)) || typeof query !== 'string' || !query.trim()) return err('invalid_contact_request')
      const result = await port.request('contacts.resolve', { query: query.trim(), action: sub }, context)
      if (result['ok'] !== true) return deviceResult(result, {}, '')
      const candidates = result['candidates'] as { ordinal_1based: number; display_name: string; contactRef: string }[]
      if (!candidates.length) return { ...err('no_match', '没有匹配联系人。'), state: { key: 'pending.selection', value: null } }
      if (sub === 'call' && candidates.length === 1) {
        const dial = await port.request('call.request', { contactRef: candidates[0]!.contactRef }, context)
        return deviceResult(dial, { action: 'dial_requested', display_name: candidates[0]!.display_name }, '已向系统发起拨号请求。')
      }
      const visible = candidates.map(({ ordinal_1based, display_name }) => ({ ordinal_1based, display_name }))
      return ok({ action: 'candidates', count: visible.length, candidates: visible }, '请用户选择哪位联系人。',
        { key: 'pending.selection', value: { kind: 'contact', candidates: visible } })
    },
    async dial(args, context) {
      const phone = args['phone']
      if (typeof phone !== 'string' || !phone.trim()) return err('empty_or_invalid_number')
      return deviceResult(await port.request('call.request', { phone: phone.trim() }, context),
        { action: 'dial_requested' }, '已向系统发起拨号请求。')
    },
    async select(args, context) {
      const ordinal = Number(args['ordinal'])
      if (!Number.isInteger(ordinal) || ordinal < 1) return err('invalid_selection')
      const result = await port.request('selection.consume', { ordinal }, context)
      const reply = deviceResult(result, result, '选择操作已处理。')
      return result['ok'] === true ? { ...reply, state: { key: 'pending.selection', value: null } } : reply
    },
  }
}
