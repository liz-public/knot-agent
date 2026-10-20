import type { Plugin } from '../../journal.js'
import { CONTEXT_FIXED, USER_MESSAGE, type FixedContext } from './protocol.js'
import type { CliCatalog } from './cli.js'

/** Keep command reference out of native function descriptions and turn requests. */
export const catalogContextPlugin = (catalog: CliCatalog): Plugin => {
  const content = '手机业务 CLI 命令目录（完整命令填入 bash 的 command 参数）：\n'
    + catalog.commands.map(command => `${command.name}: ${command.summary}`).join('\n')
  return journal => journal.subscribe(USER_MESSAGE, () => {
    if (journal.read().some(event => event.type === CONTEXT_FIXED
      && (event.data as FixedContext).content === content)) return
    journal.append(CONTEXT_FIXED, { content })
  })
}
