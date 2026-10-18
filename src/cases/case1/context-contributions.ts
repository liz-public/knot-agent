import type { CliCatalog } from './cli.js'

export interface AppMatch {
  readonly label: string
  readonly packageName: string
}

/** Environment-neutral view used by the app matcher plugin. */
export interface AppMatcher {
  match(query: string, context?: { readonly turnId: string }): Promise<readonly AppMatch[]> | readonly AppMatch[]
}

export interface ContextContribution {
  readonly content: string
  readonly matchedPackages?: readonly string[]
  readonly matchedCommands?: readonly string[]
}

export type ContextSource = (
  query: string, context?: { readonly turnId: string },
) => Promise<ContextContribution | undefined> | ContextContribution | undefined

export const appMatchSource = (matcher?: AppMatcher): ContextSource => async (query, context) => {
  if (matcher === undefined) return
  const apps = await matcher.match(query, context)
  if (apps.length === 0) return
  const matchedPackages = apps.map(app => `${app.label}: ${app.packageName}`)
  return {
    content: `相关应用包名:\n${matchedPackages.map(item => `- ${item}`).join('\n')}`,
    matchedPackages,
  }
}

export const toolIntentMatchSource = (catalog: CliCatalog): ContextSource => query => {
  const match = catalog.detailsFor(query)
  if (match.names.length === 0) return
  return {
    content: `本轮相关 CLI 详细用法:\n${match.content}` +
      (match.names.some(name => ['date', 'calendar.set', 'flight.query', 'train.query', 'hotel.query'].includes(name))
        ? '\n\n日期填写：绝对日期用YYYY-MM-DD；相对日期直接用DSL，不心算成ISO。天偏移+dN/-dN；月偏移+mNdD/-mNdD（下个月3号+m1d3）；周偏移+wNdD/-wNdD（本周0、下周1、下下周2，周一1到周日7）。时刻接THH:mm，无空格，如+m1d3T17:00。携程仅日期，日历需时刻。' : ''),
    matchedCommands: match.names,
  }
}

export function createStaticAppMatcher(packages: Readonly<Record<string, string>>): AppMatcher {
  return {
    match(query) {
      return Object.entries(packages)
        .filter(([label, packageName]) => query.includes(label) || query.includes(packageName))
        .map(([label, packageName]) => ({ label, packageName }))
    },
  }
}
