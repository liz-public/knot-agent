import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Plugin } from '../../journal.js'
import {
  CONTEXT_DYNAMIC,
  USER_MESSAGE,
  type UserMessage,
} from '../case1/protocol.js'

const instructionFiles = ['AGENTS.md', 'CLAUDE.md'] as const

async function projectInstructions(cwd: string): Promise<readonly { name: string; content: string }[]> {
  const instructions: { name: string; content: string }[] = []
  for (const name of instructionFiles) {
    try {
      const content = await readFile(join(cwd, name), 'utf8')
      if (content.trim().length > 0) instructions.push({ name, content })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return instructions
}

export const workspaceContextPlugin = (cwd: string): Plugin => journal => {
  journal.subscribe(USER_MESSAGE, async event => {
    const message = event.data as UserMessage
    const instructions = await projectInstructions(cwd)
    journal.append(CONTEXT_DYNAMIC, {
      turnId: message.turnId,
      content: [
        `Current workspace: ${cwd}`,
        ...instructions.map(item => `Project instructions from ${item.name}:\n${item.content}`),
      ].join('\n\n'),
      matchedPackages: [],
      matchedCommands: [],
      activeState: {},
    })
  })
}
