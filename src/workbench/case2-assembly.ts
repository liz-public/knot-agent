import { createPersistentCase2Agent } from '../cases/case2/case2.js'
import { case2PluginDefinitions } from '../cases/case2/plugin-definitions.js'
import type { PermissionPolicy } from '../cases/case2/tool-interaction.js'
import { JSONL_STORE_METADATA } from '../plugins/jsonl.js'
import {
  defineAssembly,
  type AgentAssemblyFactory,
  type AssemblyBuildOptions,
} from './assembly.js'
import { JOURNAL_CHANGE_METADATA } from './journal-bridge.js'

export interface Case2AssemblyOptions extends AssemblyBuildOptions {
  readonly permissionPolicy?: PermissionPolicy
}

const defaultPermissionPolicy: PermissionPolicy = {
  evaluate({ toolName }) {
    return toolName === 'write' || toolName === 'edit' || toolName === 'bash'
      ? 'ask'
      : 'allow'
  },
}

export function case2AssemblyFactory(options: Case2AssemblyOptions): AgentAssemblyFactory {
  const permissionPolicy = options.permissionPolicy
    ?? (options.approvalMode === 'auto'
      ? { evaluate: () => 'allow' as const }
      : defaultPermissionPolicy)
  return {
    id: 'case2',
    model: options.model,
    create: input => createPersistentCase2Agent({
      cwd: input.cwd,
      journalPath: input.journalPath,
      llm: options.llm,
      liveOutput: {
        open: meta => input.liveOutput.open(meta),
      },
      toolOutput: input.toolOutput,
      output: { content: () => undefined },
      permissionPolicy,
      approvalPort: input.approvalPort,
      askPort: input.askPort,
      subagentFactory: options.subagentFactory,
      platformPlugins: input.platformPlugins,
    }),
  }
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
  create: case2AssemblyFactory,
})
