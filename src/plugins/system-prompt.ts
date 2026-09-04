import type { Plugin } from '../journal.js'
import { SESSION_START, SYSTEM_PROMPT } from '../protocol.js'

export const systemPromptPlugin = (content: string): Plugin =>
  journal =>
    journal.subscribe(SESSION_START, () => {
      journal.append(SYSTEM_PROMPT, { content })
    })
