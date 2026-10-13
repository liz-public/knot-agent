import type { AdbExecutor } from './executor.js'
import { shellQuote } from './parse.js'

function launchSucceeded(output: string): boolean {
  if (/intent has been delivered to currently running/i.test(output)) return true
  return !/Error(?: type)?|Unable to resolve|No Activity found|Activity class .* does not exist|Exception/i.test(output)
}

/** Normalize system contact formatting; never return raw commands containing numbers to the model. */
export async function requestDial(executor: AdbExecutor, phone: string): Promise<boolean> {
  const normalized = phone.replace(/\s+/g, '')
  if (!normalized) return false
  try {
    return await launchAction(executor, 'android.intent.action.CALL', [`-d ${shellQuote('tel:' + normalized)}`])
  } catch {
    return false
  }
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
