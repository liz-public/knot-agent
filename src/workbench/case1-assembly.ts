import { ANDROID_TOOL_CATALOG } from '../cases/case1/android-tool-catalog.js'
import { createPersistentCase1Agent } from '../cases/case1/case1.js'
import { createBashTool, createCliCatalog } from '../cases/case1/cli.js'
import { createToolDispatcher } from '../cases/case1/dispatcher.js'
import { llmPlugin } from '../agent/plugins/llm.js'
import { describeCase1Plugins } from '../cases/case1/plugin-definitions.js'
import { createMockCase1ToolRuntime } from '../cases/case1/tool-runtimes.js'
import { JSONL_STORE_METADATA } from '../plugins/jsonl.js'
import {
  defineAssembly,
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

export const case1Assembly = defineAssembly({
  id: 'case1',
  title: 'CASE1 mobile assistant',
  plugins: pluginsFor(),
  create: input => {
    const runtime = createMockCase1ToolRuntime({ askPort: input.askPort })
    return createPersistentCase1Agent({
      journalPath: input.journalPath,
      llm: llmPlugin(input.llm, { open: meta => input.liveOutput.open(meta) }),
      output: { content: () => undefined },
      dispatcher: runtime.dispatcher,
      approvalPort: input.approvalPort,
      appMatcher: runtime.appMatcher,
      platformPlugins: input.platformPlugins,
    })
  },
})
