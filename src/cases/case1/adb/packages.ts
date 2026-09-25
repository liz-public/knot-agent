import type { AdbExecutor } from './executor.js'

export async function isPackageInstalled(executor: AdbExecutor, packageName: string): Promise<boolean> {
  const output = await executor.shell(`pm list packages ${packageName}`)
  return output.split('\n').some(line => line.trim() === `package:${packageName}`)
}

export async function listInstalledPackages(executor: AdbExecutor): Promise<ReadonlySet<string>> {
  const lines = await executor.shellLines('pm list packages')
  const packages = new Set<string>()
  for (const line of lines) {
    const match = /^package:(.+)$/.exec(line.trim())
    if (match !== null) packages.add(match[1]!)
  }
  return packages
}
