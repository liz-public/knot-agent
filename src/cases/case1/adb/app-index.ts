import type { AppMatch, AppMatcher } from '../context-contributions.js'
import type { AdbExecutor } from './executor.js'

export interface AppIndex extends AppMatcher {
  search(query: string): Promise<readonly AppMatch[]>
  invalidate(): void
}

const KNOWN_LABELS: Readonly<Record<string, string>> = {
  '电话': 'com.samsung.android.dialer',
  '微信': 'com.tencent.mm',
  '支付宝': 'com.eg.android.AlipayGphone',
  '美团': 'com.sankuai.meituan',
}

export function createAdbAppIndex(executor: AdbExecutor): AppIndex {
  let packages: readonly string[] | undefined

  async function load(): Promise<readonly string[]> {
    if (packages !== undefined) return packages
    const lines = await executor.shellLines('pm list packages')
    packages = lines.map(line => line.replace(/^package:/, '')).filter(Boolean)
    return packages
  }

  async function search(query: string): Promise<readonly AppMatch[]> {
    const normalized = query.trim().toLowerCase()
    if (normalized.length === 0) return []
    const installed = await load()
    const known = Object.entries(KNOWN_LABELS)
      .filter(([label, packageName]) => label.includes(normalized) || normalized.includes(label) || packageName.toLowerCase().includes(normalized))
      .filter(([, packageName]) => installed.includes(packageName))
      .map(([label, packageName]) => ({ label, packageName }))
    const knownPackages = new Set(known.map(item => item.packageName))
    return [
      ...known,
      ...installed
        .filter(packageName => !knownPackages.has(packageName) && packageName.toLowerCase().includes(normalized))
        .map(packageName => ({ label: packageName, packageName })),
    ]
  }

  return {
    search,
    match: search,
    invalidate() { packages = undefined },
  }
}
