import type { Plugin } from '../../journal.js'
import {
  CONTEXT_DYNAMIC,
  USER_MESSAGE,
  type UserMessage,
} from '../case1/protocol.js'

export const workspaceContextPlugin = (cwd: string): Plugin => journal => {
  journal.subscribe(USER_MESSAGE, event => {
    const message = event.data as UserMessage
    journal.append(CONTEXT_DYNAMIC, {
      turnId: message.turnId,
      content: `Current workspace: ${cwd}`,
      matchedPackages: [],
      matchedCommands: [],
      activeState: {},
    })
  })
}
