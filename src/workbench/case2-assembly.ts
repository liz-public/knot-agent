import { createPersistentCase2Agent } from '../cases/case2/case2.js'
import { case2PluginDefinitions } from '../cases/case2/plugin-definitions.js'
import { case2ToolDefinitions } from '../cases/case2/tool-definitions.js'
import { pluginTools } from '../assembly-definition.js'
import type { WebSearchProvider } from '../agent/providers/deepseek-search.js'
import type { PermissionPolicy } from '../cases/case2/tool-interaction.js'
import { JSONL_STORE_METADATA } from '../plugins/jsonl.js'
import {
  defineAssembly,
} from './assembly.js'
import { JOURNAL_CHANGE_METADATA } from './journal-bridge.js'
import { SESSION_TITLE_METADATA } from '../agent/plugins/session-title.js'

const defaultPermissionPolicy: PermissionPolicy = {
  evaluate({ toolName }) {
    return toolName === 'write' || toolName === 'edit' || toolName === 'bash'
      ? 'ask'
      : 'allow'
  },
}

export function createCase2Assembly(webSearch?: WebSearchProvider) {
  const definitions = webSearch === undefined ? case2PluginDefinitions : case2PluginDefinitions.map(definition =>
    definition.metadata.id !== 'tools' ? definition : {
      ...definition,
      inspect: () => ({ tools: pluginTools(case2ToolDefinitions({
        cwd: '/', webSearch,
        askPort: { ask: async () => ({ answer: '' }) },
        subagentFactory: { run: async () => ({ summary: '' }) },
      })) }),
    })
  const plugins = [
    definitions[0]!,
    { metadata: JSONL_STORE_METADATA },
    { metadata: JOURNAL_CHANGE_METADATA },
    { metadata: SESSION_TITLE_METADATA },
    ...definitions.slice(1),
  ]

  return defineAssembly({
    id: 'case2',
    title: 'CASE2 coding agent',
    plugins,
    create: input => createPersistentCase2Agent({
      cwd: input.cwd,
      journalPath: input.journalPath,
      llm: input.llm,
      titleProvider: input.llm,
      liveOutput: { open: meta => input.liveOutput.open(meta) },
      toolOutput: input.toolOutput,
      output: { content: () => undefined },
      permissionPolicy: defaultPermissionPolicy,
      approvalPort: input.approvalPort,
      askPort: input.askPort,
      subagentFactory: input.subagentFactory,
      webSearch,
      platformPlugins: input.platformPlugins,
    }),
  })
}

export const case2Assembly = createCase2Assembly()
