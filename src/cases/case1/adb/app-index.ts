import type { AppMatch, AppMatcher } from '../context-contributions.js'
import type { AdbExecutor } from './executor.js'

export interface AppIndex extends AppMatcher {
  search(query: string, limit?: number): Promise<readonly AppMatch[]>
  invalidate(): void
}

const KNOWN_LABELS: Readonly<Record<string, string>> = {
  '电话': 'com.samsung.android.dialer',
  '微信': 'com.tencent.mm',
  '支付宝': 'com.eg.android.AlipayGphone',
  '美团': 'com.sankuai.meituan',
}

const LAUNCHER_QUERY = 'pm query-activities -a android.intent.action.MAIN -c android.intent.category.LAUNCHER'

function parseLaunchablePackages(lines: readonly string[]): readonly string[] {
  const packages = new Set<string>()
  for (const line of lines) {
    const fromField = /packageName=([^\s]+)/.exec(line)?.[1]
    if (fromField !== undefined && fromField.length > 0) {
      packages.add(fromField)
      continue
    }
    const fromComponent = /^([a-z][\w.]*)\/[^\s]+/.exec(line.trim())?.[1]
    if (fromComponent !== undefined && fromComponent.length > 0) packages.add(fromComponent)
  }
  return [...packages].sort()
}

function labelFor(packageName: string): string {
  for (const [label, knownPackage] of Object.entries(KNOWN_LABELS)) {
    if (knownPackage === packageName) return label
  }
  return packageName
}

export function createAdbAppIndex(executor: AdbExecutor): AppIndex {
  let launchable: readonly AppMatch[] | undefined

  async function load(): Promise<readonly AppMatch[]> {
    if (launchable !== undefined) return launchable
    const packages = parseLaunchablePackages(await executor.shellLines(LAUNCHER_QUERY))
    launchable = packages.map(packageName => ({ label: labelFor(packageName), packageName }))
    return launchable
  }

  async function search(query: string, limit = 40): Promise<readonly AppMatch[]> {
    const cap = Math.min(Math.max(limit, 1), 500)
    const installed = await load()
    const normalized = query.trim().toLowerCase()
    if (normalized.length === 0) return installed.slice(0, cap)

    const known = Object.entries(KNOWN_LABELS)
      .filter(([label, packageName]) =>
        (label.includes(normalized) || normalized.includes(label) || packageName.toLowerCase().includes(normalized))
        && installed.some(app => app.packageName === packageName),
      )
      .map(([label, packageName]) => ({ label, packageName }))
    const knownPackages = new Set(known.map(item => item.packageName))
    return [
      ...known,
      ...installed
        .filter(app => !knownPackages.has(app.packageName)
          && (app.label.toLowerCase().includes(normalized)
            || app.packageName.toLowerCase().includes(normalized))),
    ].slice(0, cap)
  }

  return {
    search,
    match: search,
    invalidate() { launchable = undefined },
  }
}
