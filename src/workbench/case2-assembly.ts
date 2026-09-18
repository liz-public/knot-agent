import type { LlmProvider } from '../cases/case1/llm.js'
import { createPersistentCase2Agent } from '../cases/case2/case2.js'
import type { PermissionPolicy } from '../cases/case2/tool-interaction.js'
import type { AgentAssemblyFactory } from './assembly.js'
import type { ApprovalMode } from './session.js'

export interface Case2AssemblyOptions {
  readonly llm: LlmProvider
  readonly model: string
  readonly permissionPolicy?: PermissionPolicy
  readonly approvalMode?: ApprovalMode
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
      platformPlugins: input.platformPlugins,
    }),
  }
}
