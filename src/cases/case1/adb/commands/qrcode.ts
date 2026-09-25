import type { ToolHandler } from '../../dispatcher.js'
import type { AdbExecutor } from '../executor.js'
import { err, ok } from '../json.js'
import { listInstalledPackages, pickInstalledProvider } from '../packages.js'

const WECHAT = { id: 'wechat', packageName: 'com.tencent.mm' } as const
const ALIPAY = { id: 'alipay', packageName: 'com.eg.android.AlipayGphone' } as const
const UNIONPAY = { id: 'unionpay', packageName: 'com.unionpay' } as const
const MEITUAN = { id: 'meituan', packageName: 'com.sankuai.meituan' } as const

const SCAN_APPS = [WECHAT, ALIPAY, UNIONPAY, MEITUAN] as const
const PAY_APPS = [WECHAT, ALIPAY, UNIONPAY] as const
const RIDE_APPS = [ALIPAY, UNIONPAY] as const

export function qrcodeHandlers(executor: AdbExecutor): Readonly<Record<string, ToolHandler>> {
  return {
    async scan(arguments_) {
      const requested = typeof arguments_['provider'] === 'string' ? arguments_['provider'] : undefined
      if (requested !== undefined && !SCAN_APPS.some(app => app.id === requested)) return err('invalid_provider')
      const app = pickInstalledProvider(await listInstalledPackages(executor), SCAN_APPS, requested)
      if (app === undefined) return err('app_not_installed', '没有已安装的扫码应用。', requested === undefined ? {} : { provider: requested })
      if (app.id === 'wechat') await executor.shell('am start -n com.tencent.mm/.ui.LauncherUI --ez LauncherUI.From.Scaner.Shortcut true')
      else if (app.id === 'alipay') await executor.shell('am start -a android.intent.action.VIEW -d "alipayqr://platformapi/startapp?saId=10000007" com.eg.android.AlipayGphone')
      else if (app.id === 'unionpay') await executor.shell('am start -a android.intent.action.VIEW -d "upwallet://native/scanCode" com.unionpay')
      else await executor.shell('am start -a android.intent.action.VIEW -d "imeituan://www.meituan.com/scan"')
      return ok({ provider: app.id, action: 'scan_requested' }, '已向系统发起打开扫一扫请求。')
    },

    async pay(arguments_) {
      const requested = typeof arguments_['provider'] === 'string' ? arguments_['provider'] : undefined
      if (requested !== undefined && !PAY_APPS.some(app => app.id === requested)) return err('invalid_provider')
      const app = pickInstalledProvider(await listInstalledPackages(executor), PAY_APPS, requested)
      if (app === undefined) return err('app_not_installed', '没有已安装的付款码应用。', requested === undefined ? {} : { provider: requested })
      const receive = arguments_['receive'] === true
      if (app.id === 'wechat') await executor.shell('am start -n com.tencent.mm/.ui.ShortCutDispatchActivity --es LauncherUI.Shortcut.LaunchType launch_type_offline_wallet')
      else if (app.id === 'alipay') await executor.shell(`am start -a android.intent.action.VIEW -d "${receive ? 'alipays://platformapi/startapp?appId=20000123' : 'alipays://platformapi/startapp?appId=20000056'}" com.eg.android.AlipayGphone`)
      else await executor.shell('am start -a android.intent.action.VIEW -d "upwallet://native/qrcode" com.unionpay')
      return ok({ provider: app.id, receive }, '已向系统发起打开付款/收款码请求。')
    },

    async ride(arguments_) {
      const requested = typeof arguments_['provider'] === 'string' ? arguments_['provider'] : undefined
      if (requested !== undefined && !RIDE_APPS.some(app => app.id === requested)) return err('invalid_provider')
      const app = pickInstalledProvider(await listInstalledPackages(executor), RIDE_APPS, requested)
      if (app === undefined) return err('app_not_installed', '没有已安装的乘车码应用。', requested === undefined ? {} : { provider: requested })
      if (app.id === 'alipay') await executor.shell('am start -a android.intent.action.VIEW -d "alipayqr://platformapi/startapp?saId=200011235" com.eg.android.AlipayGphone')
      else await executor.shell('am start -a android.intent.action.VIEW -d "upwallet://native/rideCode" com.unionpay')
      return ok({ provider: app.id, action: 'ride_requested' }, '已向系统发起打开乘车码请求。')
    },
  }
}
