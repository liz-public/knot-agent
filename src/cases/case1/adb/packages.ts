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

export interface PackageProvider {
  readonly id: string
  readonly packageName: string
}

export function pickInstalledProvider<T extends PackageProvider>(
  installed: ReadonlySet<string>,
  providers: readonly T[],
  preferredId?: string,
): T | undefined {
  if (preferredId !== undefined) {
    const preferred = providers.find(provider => provider.id === preferredId)
    return preferred !== undefined && installed.has(preferred.packageName) ? preferred : undefined
  }
  return providers.find(provider => installed.has(provider.packageName))
}
