import type { ToolHandler } from '../../dispatcher.js'
import type { AdbExecutor } from '../executor.js'
import { err } from '../json.js'
import { openInstalledApp } from './app-link.js'
import type { ToolExecution } from '../../tools.js'

const WEMEET_PACKAGE = 'com.tencent.wemeet.app'
const YUNSHIXUN_PACKAGE = 'com.zhongtai.ysx'

export function meetingTarget(arguments_: Record<string, unknown>):
  { uri: string; packageName: string; payload: Record<string, unknown>; hint: string } | ToolExecution {
      const provider = typeof arguments_['provider'] === 'string' ? arguments_['provider'] : ''
      const meetingCode = typeof arguments_['meeting_code'] === 'string'
        ? arguments_['meeting_code'].trim().replace(/\D/g, '')
        : ''
      if (meetingCode.length === 0) return err('empty_meeting_code')
      const password = typeof arguments_['password'] === 'string' ? arguments_['password'].trim() : ''
      if (provider === 'wemeet') {
        const query = new URLSearchParams({ meeting_code: meetingCode })
        if (password.length > 0) query.set('password', password)
        return { uri: `wemeet://page/inmeeting?${query.toString()}`, packageName: WEMEET_PACKAGE,
          payload: { action: 'meeting_join', provider, meeting_code: meetingCode }, hint: '已向腾讯会议发起加入请求。' }
      }
      if (provider === 'yunshixun') {
        return { uri: `https://yunshixun.125339.com.cn/share/${meetingCode}?xlocation=PROD`, packageName: YUNSHIXUN_PACKAGE,
          payload: { action: 'meeting_join', provider, meeting_code: meetingCode }, hint: '已向云视讯发起加入请求。' }
      }
      return err('invalid_provider')
}
export function meetingHandlers(executor: AdbExecutor): Readonly<Record<string, ToolHandler>> {
  return {
    async join_meeting(arguments_) {
      const target = meetingTarget(arguments_)
      if ('content' in target) return target
      return openInstalledApp(executor, target.uri, target.packageName, target.payload, target.hint)
    },
  }
}
