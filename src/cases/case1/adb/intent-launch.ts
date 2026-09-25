import type { AdbExecutor } from './executor.js'
import { shellQuote } from './parse.js'

function launchSucceeded(output: string): boolean {
  return !/Error|Unable to resolve|Activity not started|No Activity found/i.test(output)
}

/** Launch a VIEW intent; returns false when the shell command fails. */
export async function launchViewUri(
  executor: AdbExecutor,
  uri: string,
  packageName?: string,
): Promise<boolean> {
  const pkgClause = packageName === undefined ? '' : ` -p ${packageName}`
  const output = await executor.shell(`am start -a android.intent.action.VIEW -d ${shellQuote(uri)}${pkgClause}`)
  return launchSucceeded(output)
}

export async function launchAction(
  executor: AdbExecutor,
  action: string,
  extras: readonly string[] = [],
): Promise<boolean> {
  const extraClause = extras.length === 0 ? '' : ` ${extras.join(' ')}`
  const output = await executor.shell(`am start -a ${action}${extraClause}`)
  return launchSucceeded(output)
}
