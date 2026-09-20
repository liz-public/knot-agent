import { createPersistentCase1Agent } from '../cases/case1/case1.js'
import { llmPlugin, type LlmProvider } from '../cases/case1/llm.js'
import type { AgentAssemblyFactory } from './assembly.js'

export interface Case1AssemblyOptions {
  readonly llm: LlmProvider
  readonly model: string
}

export function case1AssemblyFactory(options: Case1AssemblyOptions): AgentAssemblyFactory {
  return {
    id: 'case1',
    model: options.model,
    create: input => createPersistentCase1Agent({
      journalPath: input.journalPath,
      llm: llmPlugin(options.llm, { open: meta => input.liveOutput.open(meta) }),
      output: { content: () => undefined },
      platformPlugins: input.platformPlugins,
    }),
  }
}
