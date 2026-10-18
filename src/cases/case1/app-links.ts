import type { ToolExecution } from './tools.js'

import { err } from './tool-result.js'

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
export const FOOD_APPS = [
  { id: 'dianping', packageName: 'com.dianping.v1' },
  { id: 'meituan', packageName: 'com.sankuai.meituan' },
] as const

export const SHOP_APPS = [
  { id: 'taobao', packageName: 'com.taobao.taobao' },
  { id: 'jd', packageName: 'com.jingdong.app.mall' },
  { id: 'pdd', packageName: 'com.xunmeng.pinduoduo' },
] as const

/** Pure target construction, shared by the ADB and native-device business handlers. */
export function foodUri(provider: string, keyword: string): string {
  return keyword.length === 0
    ? (provider === 'dianping' ? 'dianping://foodmain' : 'imeituan://www.meituan.com/food/homepage')
    : (provider === 'dianping' ? `dianping://shoplist?keyword=${encodeURIComponent(keyword)}` : `imeituan://www.meituan.com/search/?q=${encodeURIComponent(keyword)}`)
}
export function shoppingUri(provider: string, keyword: string): string {
  if (provider === 'taobao') return `taobao://s.taobao.com/search?q=${encodeURIComponent(keyword)}`
  if (provider === 'jd') return `openapp.jdmobile://virtual?params=${encodeURIComponent(JSON.stringify({
    des: 'productList', keyWord: keyword, from: 'search', category: 'jump', sourcePage: 'HomePage', sourceDetail: 'SearchBox', save: '1',
  }))}`
  return `pinduoduo://com.xunmeng.pinduoduo/search_result.html?search_key=${encodeURIComponent(keyword)}`
}
export function trackingUri(number: string): string {
  return `https://m.kuaidi100.com/app/query/?coname=contact_demo&nu=${encodeURIComponent(number)}`
}
