import type { ToolHandler } from '../../dispatcher.js'
import {
  marketStoreSearchUri,
  SAMSUNG_GALAXY_STORE_PACKAGE,
  samsungGalaxyStoreSearchUri,
} from '../app-store.js'
import {
  CONTENT_SEARCH_PROVIDER_ORDER,
  contentSearchTarget,
  isContentSearchProvider,
} from '../content-deeplinks.js'
import { CTRIP_PACKAGE, ctripTicketInquireUri, ctripTicketListUri } from '../ctrip-uri.js'
import type { AdbExecutor } from '../executor.js'
import { launchAction, launchViewUri } from '../intent-launch.js'
import { err, ok } from '../json.js'
import { isPackageInstalled, listInstalledPackages } from '../packages.js'
import { resolveSettingsPage, suggestSettingsPages } from '../settings-catalog.js'

const EXPRESS_TRACKING_RE = /^[A-Za-z0-9]{6,32}$/
const ALIPAY_EXPRESS_URI = 'alipays://platformapi/startapp?appId=20000754'
const KUAIDI100_HOME = 'https://m.kuaidi100.com'
const WEMEET_PACKAGE = 'com.tencent.wemeet.app'
const YUNSHIXUN_PACKAGE = 'com.zhongtai.ysx'

const FOOD_APPS = [
  { id: 'dianping', packageName: 'com.dianping.v1' },
  { id: 'meituan', packageName: 'com.sankuai.meituan' },
] as const

const SHOP_APPS = [
  { id: 'taobao', packageName: 'com.taobao.taobao' },
  { id: 'jd', packageName: 'com.jingdong.app.mall' },
  { id: 'pdd', packageName: 'com.xunmeng.pinduoduo' },
] as const

function pickInstalled<T extends { readonly id: string; readonly packageName: string }>(
  installed: ReadonlySet<string>,
  apps: readonly T[],
  preferredId?: string,
): T | undefined {
  if (preferredId !== undefined) {
    const picked = apps.find(app => app.id === preferredId)
    return picked !== undefined && installed.has(picked.packageName) ? picked : undefined
  }
  return apps.find(app => installed.has(app.packageName))
}

async function requireInstalled(
  executor: AdbExecutor,
  packageName: string,
): Promise<boolean> {
  return isPackageInstalled(executor, packageName)
}

async function openOrAppNotInstalled(
  executor: AdbExecutor,
  uri: string,
  packageName: string,
  payload: Record<string, unknown>,
  hint: string,
) {
  if (!await requireInstalled(executor, packageName)) {
    return err('app_not_installed', '目标应用未安装。', { package_name: packageName })
  }
  const launched = await launchViewUri(executor, uri, packageName)
  return launched
    ? ok(payload, hint)
    : err('open_failed', '无法打开目标应用。', { package_name: packageName })
}

export function deeplinkHandlers(executor: AdbExecutor): Readonly<Record<string, ToolHandler>> {
  return {
    async search_app_store(arguments_) {
      const keyword = arguments_['keyword']
      if (typeof keyword !== 'string' || keyword.trim().length === 0) return err('missing_keyword')
      const kw = keyword.trim()
      if (await isPackageInstalled(executor, SAMSUNG_GALAXY_STORE_PACKAGE)) {
        const uri = samsungGalaxyStoreSearchUri(kw)
        const launched = await launchViewUri(executor, uri, SAMSUNG_GALAXY_STORE_PACKAGE)
        return launched
          ? ok({ action: 'store_search', keyword: kw, store: 'samsung' }, '已向三星应用商店发起搜索。')
          : err('open_failed', '无法打开三星应用商店搜索页。', { package_name: SAMSUNG_GALAXY_STORE_PACKAGE })
      }
      const uri = marketStoreSearchUri(kw)
      const launched = await launchViewUri(executor, uri)
      return launched
        ? ok({ action: 'store_search', keyword: kw, store: 'market' }, '已向系统应用商店发起搜索。')
        : err('app_not_installed', '本机没有可响应 market:// 的应用商店。')
    },

    async content_app_search(arguments_) {
      const keyword = arguments_['keyword']
      if (typeof keyword !== 'string' || keyword.trim().length === 0) return err('missing_keyword')
      const kw = keyword.trim()
      const providerRaw = typeof arguments_['provider'] === 'string' ? arguments_['provider'].trim() : ''
      const installed = await listInstalledPackages(executor)

      if (providerRaw.length > 0) {
        if (!isContentSearchProvider(providerRaw)) return err('invalid_provider')
        const target = contentSearchTarget(providerRaw)
        if (!installed.has(target.packageName)) {
          return err('app_not_installed', '目标应用未安装。', { provider: providerRaw, package_name: target.packageName })
        }
        const launched = await launchViewUri(executor, target.buildUri(kw), target.packageName)
        return launched
          ? ok({ action: 'content_search_opened', provider: providerRaw, keyword: kw }, '已在指定 App 内打开搜索。')
          : err('open_failed', '无法打开目标应用搜索页。', { provider: providerRaw, package_name: target.packageName })
      }

      for (const provider of CONTENT_SEARCH_PROVIDER_ORDER) {
        const target = contentSearchTarget(provider)
        if (!installed.has(target.packageName)) continue
        const launched = await launchViewUri(executor, target.buildUri(kw), target.packageName)
        if (launched) {
          return ok({ action: 'content_search_opened', provider, keyword: kw }, '已在已安装 App 内打开搜索。')
        }
      }
      return err('app_not_installed', '没有已安装且可打开搜索页的目标应用。')
    },

    async open_express_tracking(arguments_) {
      const raw = typeof arguments_['tracking_no'] === 'string' ? arguments_['tracking_no'].trim() : ''
      if (raw.length > 0) {
        const compact = raw.replace(/\s+/g, '')
        if (!EXPRESS_TRACKING_RE.test(compact)) return err('invalid_tracking_number')
        const uri = `https://m.kuaidi100.com/app/query/?coname=contact_demo&nu=${encodeURIComponent(compact)}`
        const launched = await launchViewUri(executor, uri)
        return launched
          ? ok({ mode: 'with_number', tracking_number: compact }, '已打开快递查询页。')
          : err('open_failed', '无法打开快递查询页。')
      }
      if (await requireInstalled(executor, 'com.eg.android.AlipayGphone')) {
        return openOrAppNotInstalled(
          executor,
          ALIPAY_EXPRESS_URI,
          'com.eg.android.AlipayGphone',
          { mode: 'alipay' },
          '已打开支付宝快递。',
        )
      }
      const launched = await launchViewUri(executor, KUAIDI100_HOME)
      return launched
        ? ok({ mode: 'home' }, '已打开快递100首页。')
        : err('open_failed', '无法打开快递查询页。')
    },

    async explore_food(arguments_) {
      const installed = await listInstalledPackages(executor)
      const provider = typeof arguments_['provider'] === 'string' ? arguments_['provider'] : undefined
      if (provider !== undefined && !FOOD_APPS.some(app => app.id === provider)) return err('invalid_provider')
      const app = pickInstalled(installed, FOOD_APPS, provider)
      if (app === undefined) {
        return err('app_not_installed', '美食应用未安装。', {
          ...(provider === undefined ? {} : { provider }),
        })
      }
      const kw = typeof arguments_['keyword'] === 'string' ? arguments_['keyword'].trim() : ''
      const uri = kw.length === 0
        ? (app.id === 'dianping' ? 'dianping://foodmain' : 'imeituan://www.meituan.com/food/homepage')
        : (app.id === 'dianping'
          ? `dianping://shoplist?keyword=${encodeURIComponent(kw)}`
          : `imeituan://www.meituan.com/search/?q=${encodeURIComponent(kw)}`)
      const action = kw.length === 0 ? 'food_home_opened' : 'food_search_opened'
      const hint = kw.length === 0 ? '已打开美食首页。' : '已打开美食搜索结果。'
      return openOrAppNotInstalled(executor, uri, app.packageName, { action, provider: app.id, ...(kw.length > 0 ? { keyword: kw } : {}) }, hint)
    },

    async search_shopping(arguments_) {
      const keyword = arguments_['keyword']
      if (typeof keyword !== 'string' || keyword.trim().length === 0) return err('missing_keyword')
      const kw = keyword.trim()
      const installed = await listInstalledPackages(executor)
      const provider = typeof arguments_['provider'] === 'string' ? arguments_['provider'] : undefined
      if (provider !== undefined && !SHOP_APPS.some(app => app.id === provider)) return err('invalid_provider')
      const app = pickInstalled(installed, SHOP_APPS, provider)
      if (app === undefined) {
        return err('app_not_installed', '购物应用未安装。', {
          ...(provider === undefined ? {} : { provider }),
        })
      }
      let uri = ''
      if (app.id === 'taobao') {
        uri = `taobao://s.taobao.com/search?q=${encodeURIComponent(kw)}`
      } else if (app.id === 'jd') {
        const params = JSON.stringify({
          des: 'productList',
          keyWord: kw,
          from: 'search',
          category: 'jump',
          sourcePage: 'HomePage',
          sourceDetail: 'SearchBox',
          save: '1',
        })
        uri = `openapp.jdmobile://virtual?params=${encodeURIComponent(params)}`
      } else {
        uri = `pinduoduo://com.xunmeng.pinduoduo/search_result.html?search_key=${encodeURIComponent(kw)}`
      }
      return openOrAppNotInstalled(
        executor,
        uri,
        app.packageName,
        { action: 'shopping_search_opened', provider: app.id, keyword: kw },
        '已在购物 App 打开搜索结果。',
      )
    },

    async join_meeting(arguments_) {
      const provider = typeof arguments_['provider'] === 'string' ? arguments_['provider'] : ''
      const meetingCode = typeof arguments_['meeting_code'] === 'string' ? arguments_['meeting_code'].trim().replace(/\D/g, '') : ''
      if (meetingCode.length === 0) return err('empty_meeting_code')
      const password = typeof arguments_['password'] === 'string' ? arguments_['password'].trim() : ''

      if (provider === 'wemeet') {
        const query = new URLSearchParams({ meeting_code: meetingCode })
        if (password.length > 0) query.set('password', password)
        const uri = `wemeet://page/inmeeting?${query.toString()}`
        return openOrAppNotInstalled(
          executor,
          uri,
          WEMEET_PACKAGE,
          { action: 'meeting_join', provider: 'wemeet', meeting_code: meetingCode },
          '已向腾讯会议发起加入请求。',
        )
      }
      if (provider === 'yunshixun') {
        const uri = `https://yunshixun.125339.com.cn/share/${meetingCode}?xlocation=PROD`
        return openOrAppNotInstalled(
          executor,
          uri,
          YUNSHIXUN_PACKAGE,
          { action: 'meeting_join', provider: 'yunshixun', meeting_code: meetingCode },
          '已向云视讯发起加入请求。',
        )
      }
      return err('invalid_provider')
    },

    async query_scenic_ticket(arguments_) {
      const keyword = typeof arguments_['keyword'] === 'string' ? arguments_['keyword'].trim() : ''
      const uri = keyword.length === 0 ? ctripTicketInquireUri() : ctripTicketListUri(keyword)
      return openOrAppNotInstalled(
        executor,
        uri,
        CTRIP_PACKAGE,
        {
          action: keyword.length === 0 ? 'ticket_inquire' : 'ticket_search',
          ...(keyword.length > 0 ? { keyword } : {}),
        },
        keyword.length === 0 ? '已打开景区门票首页。' : '已打开景区门票搜索。',
      )
    },

    async open_settings_page(arguments_) {
      const page = arguments_['page']
      if (typeof page !== 'string' || page.trim().length === 0) return err('missing_page')
      const resolved = resolveSettingsPage(page.trim())
      if (resolved === undefined) {
        const suggestions = suggestSettingsPages(page.trim()).map(entry => ({ id: entry.id, label: entry.label }))
        return err('settings_not_matched', '未匹配到设置页。', { page: page.trim(), suggestions })
      }
      const launched = await launchAction(executor, resolved.action)
      return launched
        ? ok({ matched_id: resolved.id, matched_label: resolved.label, page: page.trim() }, '已打开设置页。')
        : err('open_failed', '无法打开设置页。', { matched_id: resolved.id })
    },
  }
}
