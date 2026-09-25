import type { ToolExecution } from '../../tools.js'
import type { AdbExecutor } from '../executor.js'
import { launchViewUri } from '../intent-launch.js'
import { err, ok } from '../json.js'
import { isPackageInstalled } from '../packages.js'

export async function openInstalledApp(
  executor: AdbExecutor,
  uri: string,
  packageName: string,
  payload: Record<string, unknown>,
  hint: string,
): Promise<ToolExecution> {
  if (!await isPackageInstalled(executor, packageName)) {
    return err('app_not_installed', '目标应用未安装。', { package_name: packageName })
  }
  return await launchViewUri(executor, uri, packageName)
    ? ok(payload, hint)
    : err('open_failed', '无法打开目标应用。', { package_name: packageName })
}
