import type { ToolHandler } from '../../dispatcher.js'
import { CTRIP_PACKAGE, ctripTicketInquireUri, ctripTicketListUri } from '../ctrip-uri.js'
import type { AdbExecutor } from '../executor.js'
import { openInstalledApp } from './app-link.js'

export function travelHandlers(executor: AdbExecutor): Readonly<Record<string, ToolHandler>> {
  return {
    async query_scenic_ticket(arguments_) {
      const keyword = typeof arguments_['keyword'] === 'string' ? arguments_['keyword'].trim() : ''
      return openInstalledApp(
        executor,
        keyword.length === 0 ? ctripTicketInquireUri() : ctripTicketListUri(keyword),
        CTRIP_PACKAGE,
        {
          action: keyword.length === 0 ? 'ticket_inquire' : 'ticket_search',
          ...(keyword.length > 0 ? { keyword } : {}),
        },
        keyword.length === 0 ? '已打开景区门票首页。' : '已打开景区门票搜索。',
      )
    },
  }
}
