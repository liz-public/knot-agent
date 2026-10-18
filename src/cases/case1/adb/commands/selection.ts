import type { ToolHandler } from '../../dispatcher.js'
import type { AdbExecutor } from '../executor.js'
import { err, ok } from '../../tool-result.js'
import type { AdbDeviceSession } from '../session.js'
import { executeMapSelect } from './navigation.js'
import { requestDial } from '../intent-launch.js'

/** Owns the shared `select` command; domains only create their pending selections. */
export function selectionHandlers(
  executor: AdbExecutor,
  session: AdbDeviceSession,
): Readonly<Record<string, ToolHandler>> {
  return {
    async select(arguments_) {
      const ordinal = Number(arguments_['ordinal'])
      const pending = session.pending
      if (!Number.isInteger(ordinal) || ordinal < 1 || pending === undefined) return err('no_active_list')
      if (pending.kind !== 'contact') return executeMapSelect(executor, session, pending, ordinal)

      const picked = pending.candidates.find(item => item.ordinal_1based === ordinal)
      if (picked === undefined) return err('invalid_selection')
      if (picked.phone !== undefined) {
        if (!await requestDial(executor, picked.phone)) return err('call_failed', '系统未完成拨号请求。')
        session.pending = undefined
        return ok(
          { action: 'direct_dial', index_1based: ordinal, display_name: picked.display_name, source: 'contact' },
          '已向系统发起拨号请求。',
          { key: 'pending.selection', value: null },
        )
      }
      session.pending = undefined
      return ok(
        { action: 'selected', selected: ordinal },
        '已选择候选项。',
        { key: 'pending.selection', value: null },
      )
    },
  }
}
