import type { CliCatalog } from './cli.js'

export interface AppMatch {
  readonly label: string
  readonly packageName: string
}

/** Environment-neutral view used by the app matcher plugin. */
export interface AppMatcher {
  match(query: string): Promise<readonly AppMatch[]> | readonly AppMatch[]
}

export interface ContextContribution {
  readonly content: string
  readonly matchedPackages?: readonly string[]
  readonly matchedCommands?: readonly string[]
}

export type ContextSource = (
  query: string,
) => Promise<ContextContribution | undefined> | ContextContribution | undefined

export const appMatchSource = (matcher?: AppMatcher): ContextSource => async query => {
  if (matcher === undefined) return
  const apps = await matcher.match(query)
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
    content: `本轮相关 CLI 详细用法:\n${match.content}`,
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
