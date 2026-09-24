import { ANDROID_TOOL_CATALOG } from '../cases/case1/android-tool-catalog.js'
import { createPersistentCase1Agent } from '../cases/case1/case1.js'
import type { AskPort } from '../cases/case1/ask-port.js'
import type { ApprovalPort } from '../cases/case1/approval-port.js'
import { createBashTool, createCliCatalog } from '../cases/case1/cli.js'
import { createToolDispatcher } from '../cases/case1/dispatcher.js'
import { llmPlugin } from '../cases/case1/llm.js'
import { describeCase1Plugins } from '../cases/case1/plugin-definitions.js'
import {
  createMockCase1ToolRuntime,
  type Case1ToolRuntime,
} from '../cases/case1/tool-runtimes.js'
import { JSONL_STORE_METADATA } from '../plugins/jsonl.js'
import {
  defineAssembly,
  type AgentAssemblyFactory,
  type AssemblyBuildOptions,
} from './assembly.js'
import { JOURNAL_CHANGE_METADATA } from './journal-bridge.js'

const catalog = createCliCatalog(ANDROID_TOOL_CATALOG)
const bash = createBashTool(catalog, createToolDispatcher({}))

function pluginsFor() {
  const definitions = describeCase1Plugins([bash])
  return [
    definitions[0]!,
    { metadata: JSONL_STORE_METADATA },
    { metadata: JOURNAL_CHANGE_METADATA },
    ...definitions.slice(1),
  ]
}

export function case1AssemblyFactory(
  options: AssemblyBuildOptions,
  createToolRuntime: (ports: { readonly askPort?: AskPort; readonly approvalPort?: ApprovalPort }) => Case1ToolRuntime,
): AgentAssemblyFactory {
  return {
    id: 'case1',
    model: options.model,
    create: input => {
      const runtime = createToolRuntime({ askPort: input.askPort, approvalPort: input.approvalPort })
      return createPersistentCase1Agent({
        journalPath: input.journalPath,
        llm: llmPlugin(options.llm, { open: meta => input.liveOutput.open(meta) }),
        output: { content: () => undefined },
        dispatcher: runtime.dispatcher,
        appMatcher: runtime.appMatcher,
        platformPlugins: input.platformPlugins,
      })
    },
  }
}

export const case1Assembly = defineAssembly({
  id: 'case1',
  title: 'CASE1 mobile assistant',
  plugins: pluginsFor(),
  create: options => case1AssemblyFactory(
    options,
    ports => createMockCase1ToolRuntime({ askPort: ports.askPort }),
  ),
})
