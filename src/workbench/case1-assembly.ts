import { createPersistentCase1Agent } from '../cases/case1/case1.js'
import { case1PluginDefinitions } from '../cases/case1/plugin-definitions.js'
import { llmPlugin } from '../cases/case1/llm.js'
import { JSONL_STORE_METADATA } from '../plugins/jsonl.js'
import {
  defineAssembly,
  type AgentAssemblyFactory,
  type AssemblyBuildOptions,
} from './assembly.js'
import { JOURNAL_CHANGE_METADATA } from './journal-bridge.js'

const plugins = [
  case1PluginDefinitions[0]!,
  { metadata: JSONL_STORE_METADATA },
  { metadata: JOURNAL_CHANGE_METADATA },
  ...case1PluginDefinitions.slice(1),
]

export function case1AssemblyFactory(options: AssemblyBuildOptions): AgentAssemblyFactory {
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

export const case1Assembly = defineAssembly({
  id: 'case1',
  title: 'CASE1 mobile assistant',
  plugins,
  create: case1AssemblyFactory,
})
