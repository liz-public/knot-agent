import type { ToolHandler } from '../../dispatcher.js'
import {
  marketStoreSearchUri,
  SAMSUNG_GALAXY_STORE_PACKAGE,
  samsungGalaxyStoreSearchUri,
} from '../app-store.js'
import { contentSearchTarget, isContentSearchProvider } from '../content-deeplinks.js'
import type { AdbExecutor } from '../executor.js'
import { launchViewUri } from '../intent-launch.js'
import { err, ok } from '../json.js'
import { isPackageInstalled } from '../packages.js'

export function discoveryHandlers(executor: AdbExecutor): Readonly<Record<string, ToolHandler>> {
  return {
    async search_app_store(arguments_) {
      const keyword = arguments_['keyword']
      if (typeof keyword !== 'string' || keyword.trim().length === 0) return err('missing_keyword')
      const value = keyword.trim()
      if (await isPackageInstalled(executor, SAMSUNG_GALAXY_STORE_PACKAGE)) {
        const launched = await launchViewUri(
          executor,
          samsungGalaxyStoreSearchUri(value),
          SAMSUNG_GALAXY_STORE_PACKAGE,
        )
        return launched
          ? ok({ action: 'store_search', keyword: value, store: 'samsung' }, '已向三星应用商店发起搜索。')
          : err('open_failed', '无法打开三星应用商店搜索页。', { package_name: SAMSUNG_GALAXY_STORE_PACKAGE })
      }
      const launched = await launchViewUri(executor, marketStoreSearchUri(value))
      return launched
        ? ok({ action: 'store_search', keyword: value, store: 'market' }, '已向系统应用商店发起搜索。')
        : err('app_not_installed', '本机没有可响应 market:// 的应用商店。')
    },

    async content_app_search(arguments_) {
      const keyword = arguments_['keyword']
      const provider = arguments_['provider']
      if (typeof keyword !== 'string' || keyword.trim().length === 0) return err('missing_keyword')
      if (typeof provider !== 'string' || !isContentSearchProvider(provider)) return err('invalid_provider')
      const target = contentSearchTarget(provider)
      if (!await isPackageInstalled(executor, target.packageName)) {
        return err('app_not_installed', '目标应用未安装。', { provider, package_name: target.packageName })
      }
      const value = keyword.trim()
      const launched = await launchViewUri(executor, target.buildUri(value), target.packageName)
      return launched
        ? ok({ action: 'content_search_opened', provider, keyword: value }, '已在指定 App 内打开搜索。')
        : err('open_failed', '无法打开目标应用搜索页。', { provider, package_name: target.packageName })
    },
  }
}
