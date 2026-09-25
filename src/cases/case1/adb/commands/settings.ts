import type { ToolHandler } from '../../dispatcher.js'
import type { AdbExecutor } from '../executor.js'
import { launchAction } from '../intent-launch.js'
import { err, ok } from '../json.js'
import { resolveSettingsPage, suggestSettingsPages } from '../settings-catalog.js'

export function settingsHandlers(executor: AdbExecutor): Readonly<Record<string, ToolHandler>> {
  return {
    async open_settings_page(arguments_) {
      const page = arguments_['page']
      if (typeof page !== 'string' || page.trim().length === 0) return err('missing_page')
      const value = page.trim()
      const resolved = resolveSettingsPage(value)
      if (resolved === undefined) {
        const suggestions = suggestSettingsPages(value).map(entry => ({ id: entry.id, label: entry.label }))
        return err('settings_not_matched', '未匹配到设置页。', { page: value, suggestions })
      }
      return await launchAction(executor, resolved.action)
        ? ok({ matched_id: resolved.id, matched_label: resolved.label, page: value }, '已打开设置页。')
        : err('open_failed', '无法打开设置页。', { matched_id: resolved.id })
    },
  }
}
