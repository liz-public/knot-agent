import type { Plugin } from '../../journal.js'
import { SESSION_START, SYSTEM_PROMPT } from '../case1/protocol.js'

export const CASE2_SYSTEM_PROMPT = `You are a coding agent working in the provided workspace.
Inspect the relevant files before editing. Use read, write, edit, and bash tools to make the requested change and verify it.
Do not claim success until the relevant verification command has passed. Keep the final response concise and describe the change and verification.`

export const codingSystemPromptPlugin = (content = CASE2_SYSTEM_PROMPT): Plugin => journal => {
  journal.subscribe(SESSION_START, () => {
    journal.append(SYSTEM_PROMPT, { content })
  })
}
