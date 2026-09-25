import type { ToolHandler } from '../../dispatcher.js'
import type { AdbExecutor } from '../executor.js'
import { err } from '../json.js'
import { openInstalledApp } from './app-link.js'

const WEMEET_PACKAGE = 'com.tencent.wemeet.app'
const YUNSHIXUN_PACKAGE = 'com.zhongtai.ysx'

export function meetingHandlers(executor: AdbExecutor): Readonly<Record<string, ToolHandler>> {
  return {
    async join_meeting(arguments_) {
      const provider = typeof arguments_['provider'] === 'string' ? arguments_['provider'] : ''
      const meetingCode = typeof arguments_['meeting_code'] === 'string'
        ? arguments_['meeting_code'].trim().replace(/\D/g, '')
        : ''
      if (meetingCode.length === 0) return err('empty_meeting_code')
      const password = typeof arguments_['password'] === 'string' ? arguments_['password'].trim() : ''
      if (provider === 'wemeet') {
        const query = new URLSearchParams({ meeting_code: meetingCode })
        if (password.length > 0) query.set('password', password)
        return openInstalledApp(
          executor,
          `wemeet://page/inmeeting?${query.toString()}`,
          WEMEET_PACKAGE,
          { action: 'meeting_join', provider, meeting_code: meetingCode },
          '已向腾讯会议发起加入请求。',
        )
      }
      if (provider === 'yunshixun') {
        return openInstalledApp(
          executor,
          `https://yunshixun.125339.com.cn/share/${meetingCode}?xlocation=PROD`,
          YUNSHIXUN_PACKAGE,
          { action: 'meeting_join', provider, meeting_code: meetingCode },
          '已向云视讯发起加入请求。',
        )
      }
      return err('invalid_provider')
    },
  }
}
