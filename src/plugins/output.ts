import type { Plugin } from '../journal.js'
import { ASSISTANT_MESSAGE, type AssistantMessage } from '../protocol.js'

export const outputPlugin = (write: (content: string) => void): Plugin =>
  journal =>
    journal.subscribe(ASSISTANT_MESSAGE, event => {
      write((event.data as AssistantMessage).content)
    })
