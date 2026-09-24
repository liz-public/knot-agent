import type { Plugin } from '../../journal.js'
import type { CliCatalog } from './cli.js'
import {
  CONTEXT_CONTRIBUTION,
  USER_MESSAGE,
  type UserMessage,
} from './protocol.js'

export interface AppMatch {
  readonly label: string
  readonly packageName: string
}

/** Environment-neutral view used by the app matcher plugin. */
export interface AppMatcher {
  match(query: string): Promise<readonly AppMatch[]> | readonly AppMatch[]
}

export const appMatchPlugin = (matcher?: AppMatcher): Plugin => journal => {
  journal.subscribe(USER_MESSAGE, async event => {
    if (matcher === undefined) return
    const message = event.data as UserMessage
    const apps = await matcher.match(message.content)
    if (apps.length === 0) return
    const matchedPackages = apps.map(app => `${app.label}: ${app.packageName}`)
    journal.append(CONTEXT_CONTRIBUTION, {
      turnId: message.turnId,
      source: 'apps',
      content: `相关应用包名:\n${matchedPackages.map(item => `- ${item}`).join('\n')}`,
      matchedPackages,
    })
  })
}

export const toolIntentMatchPlugin = (catalog: CliCatalog): Plugin => journal => {
  journal.subscribe(USER_MESSAGE, event => {
    const message = event.data as UserMessage
    const match = catalog.detailsFor(message.content)
    if (match.names.length === 0) return
    journal.append(CONTEXT_CONTRIBUTION, {
      turnId: message.turnId,
      source: 'tools',
      content: `本轮相关 CLI 详细用法:\n${match.content}`,
      matchedCommands: match.names,
    })
  })
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
