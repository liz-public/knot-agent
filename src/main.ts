import { createJournal } from './journal.js'
import { SESSION_START, USER_MESSAGE } from './protocol.js'
import { mockLlmPlugin } from './plugins/llm-mock.js'
import { openAiLlmPlugin } from './plugins/llm-openai.js'
import { outputPlugin } from './plugins/output.js'
import { systemPromptPlugin } from './plugins/system-prompt.js'
import { demoLookupTool, toolSchemas, toolsPlugin } from './plugins/tools.js'
import { tracePlugin } from './plugins/trace.js'

function optionalJson(value: string | undefined): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  const parsed = JSON.parse(value) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('KNOT_REQUEST_EXTRA_JSON must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

const tools = [demoLookupTool]
const baseUrl = process.env['KNOT_BASE_URL']
const model = process.env['KNOT_MODEL']
const llm = baseUrl !== undefined && model !== undefined
  ? openAiLlmPlugin({
    baseUrl,
    apiKey: process.env['KNOT_API_KEY'],
    model,
    tools: toolSchemas(tools),
    extraBody: optionalJson(process.env['KNOT_REQUEST_EXTRA_JSON']),
  })
  : mockLlmPlugin()

const { journal, runUntilIdle } = createJournal()

for (const plugin of [
  tracePlugin(event => console.error(`[trace] ${event.type}`, event.data)),
  systemPromptPlugin(
    'You are a concise assistant. Use demo_lookup before answering questions about a project status.',
  ),
  llm,
  toolsPlugin(tools),
  outputPlugin(content => console.log(content)),
]) plugin(journal)

journal.append(SESSION_START, {})
await runUntilIdle()

journal.append(USER_MESSAGE, {
  content: process.argv.slice(2).join(' ')
    || 'Look up the status of knot-agent and report it.',
})
await runUntilIdle()
