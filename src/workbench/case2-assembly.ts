import { createPersistentCase2Agent } from '../cases/case2/case2.js'
import { case2PluginDefinitions } from '../cases/case2/plugin-definitions.js'
import type { PermissionPolicy } from '../cases/case2/tool-interaction.js'
import { JSONL_STORE_METADATA } from '../plugins/jsonl.js'
import {
  defineAssembly,
} from './assembly.js'
import { JOURNAL_CHANGE_METADATA } from './journal-bridge.js'

const defaultPermissionPolicy: PermissionPolicy = {
  evaluate({ toolName }) {
    return toolName === 'write' || toolName === 'edit' || toolName === 'bash'
      ? 'ask'
      : 'allow'
  },
}

const plugins = [
  case2PluginDefinitions[0]!,
  { metadata: JSONL_STORE_METADATA },
  { metadata: JOURNAL_CHANGE_METADATA },
  ...case2PluginDefinitions.slice(1),
]

export const case2Assembly = defineAssembly({
  id: 'case2',
  title: 'CASE2 coding agent',
  plugins,
  create: input => createPersistentCase2Agent({
    cwd: input.cwd,
    journalPath: input.journalPath,
    llm: input.llm,
    liveOutput: {
      open: meta => input.liveOutput.open(meta),
    },
    toolOutput: input.toolOutput,
    output: { content: () => undefined },
    permissionPolicy: defaultPermissionPolicy,
    approvalPort: input.approvalPort,
    askPort: input.askPort,
    subagentFactory: input.subagentFactory,
    platformPlugins: input.platformPlugins,
  }),
})
