import type { ToolHandler } from '../../dispatcher.js'
import type { AdbExecutor } from '../executor.js'
import { launchViewUri } from '../intent-launch.js'
import { err, ok } from '../json.js'
import { isPackageInstalled, listInstalledPackages, pickInstalledProvider } from '../packages.js'

const EXPRESS_TRACKING_RE = /^[A-Za-z0-9]{6,32}$/
const ALIPAY_PACKAGE = 'com.eg.android.AlipayGphone'
const ALIPAY_EXPRESS_URI = 'alipays://platformapi/startapp?appId=20000754'
const KUAIDI100_HOME = 'https://m.kuaidi100.com'

const FOOD_APPS = [
  { id: 'dianping', packageName: 'com.dianping.v1' },
  { id: 'meituan', packageName: 'com.sankuai.meituan' },
] as const

const SHOP_APPS = [
  { id: 'taobao', packageName: 'com.taobao.taobao' },
  { id: 'jd', packageName: 'com.jingdong.app.mall' },
  { id: 'pdd', packageName: 'com.xunmeng.pinduoduo' },
] as const

export function commerceHandlers(executor: AdbExecutor): Readonly<Record<string, ToolHandler>> {
  return {
    async open_express_tracking(arguments_) {
      const raw = typeof arguments_['tracking_no'] === 'string' ? arguments_['tracking_no'].trim() : ''
      if (raw.length > 0) {
        const trackingNumber = raw.replace(/\s+/g, '')
        if (!EXPRESS_TRACKING_RE.test(trackingNumber)) return err('invalid_tracking_number')
        const uri = `https://m.kuaidi100.com/app/query/?coname=contact_demo&nu=${encodeURIComponent(trackingNumber)}`
        return await launchViewUri(executor, uri)
          ? ok({ mode: 'with_number', tracking_number: trackingNumber }, '已打开快递查询页。')
          : err('open_failed', '无法打开快递查询页。')
      }
      if (await isPackageInstalled(executor, ALIPAY_PACKAGE)) {
        return await launchViewUri(executor, ALIPAY_EXPRESS_URI, ALIPAY_PACKAGE)
          ? ok({ mode: 'alipay' }, '已打开支付宝快递。')
          : err('open_failed', '无法打开支付宝快递。', { package_name: ALIPAY_PACKAGE })
      }
      return await launchViewUri(executor, KUAIDI100_HOME)
        ? ok({ mode: 'home' }, '已打开快递100首页。')
        : err('open_failed', '无法打开快递查询页。')
    },

    async explore_food(arguments_) {
      const provider = typeof arguments_['provider'] === 'string' ? arguments_['provider'] : undefined
      if (provider !== undefined && !FOOD_APPS.some(app => app.id === provider)) return err('invalid_provider')
      const app = pickInstalledProvider(await listInstalledPackages(executor), FOOD_APPS, provider)
      if (app === undefined) {
        return err('app_not_installed', '美食应用未安装。', provider === undefined ? {} : { provider })
      }
      const keyword = typeof arguments_['keyword'] === 'string' ? arguments_['keyword'].trim() : ''
      const uri = keyword.length === 0
        ? (app.id === 'dianping' ? 'dianping://foodmain' : 'imeituan://www.meituan.com/food/homepage')
        : (app.id === 'dianping'
          ? `dianping://shoplist?keyword=${encodeURIComponent(keyword)}`
          : `imeituan://www.meituan.com/search/?q=${encodeURIComponent(keyword)}`)
      const launched = await launchViewUri(executor, uri, app.packageName)
      if (!launched) return err('open_failed', '无法打开美食应用。', { provider: app.id, package_name: app.packageName })
      return keyword.length === 0
        ? ok({ action: 'food_home_opened', provider: app.id }, '已打开美食首页。')
        : ok({ action: 'food_search_opened', provider: app.id, keyword }, '已打开美食搜索结果。')
    },

    async search_shopping(arguments_) {
      const keyword = arguments_['keyword']
      if (typeof keyword !== 'string' || keyword.trim().length === 0) return err('missing_keyword')
      const provider = typeof arguments_['provider'] === 'string' ? arguments_['provider'] : undefined
      if (provider !== undefined && !SHOP_APPS.some(app => app.id === provider)) return err('invalid_provider')
      const app = pickInstalledProvider(await listInstalledPackages(executor), SHOP_APPS, provider)
      if (app === undefined) {
        return err('app_not_installed', '购物应用未安装。', provider === undefined ? {} : { provider })
      }
      const value = keyword.trim()
      let uri: string
      if (app.id === 'taobao') {
        uri = `taobao://s.taobao.com/search?q=${encodeURIComponent(value)}`
      } else if (app.id === 'jd') {
        uri = `openapp.jdmobile://virtual?params=${encodeURIComponent(JSON.stringify({
          des: 'productList', keyWord: value, from: 'search', category: 'jump',
          sourcePage: 'HomePage', sourceDetail: 'SearchBox', save: '1',
        }))}`
      } else {
        uri = `pinduoduo://com.xunmeng.pinduoduo/search_result.html?search_key=${encodeURIComponent(value)}`
      }
      return await launchViewUri(executor, uri, app.packageName)
        ? ok({ action: 'shopping_search_opened', provider: app.id, keyword: value }, '已在购物 App 打开搜索结果。')
        : err('open_failed', '无法打开购物应用。', { provider: app.id, package_name: app.packageName })
    },
  }
}
