import { Runtime } from './core.js'
import { events } from './protocol.js'
import { MockLlmPlugin, OpenAiChatPlugin } from './plugins/llm.js'
import { OutputPlugin } from './plugins/output.js'
import { demoLookupTool, ToolPlugin } from './plugins/tool.js'

function optionalJson(value: string | undefined): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  const parsed = JSON.parse(value) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('KNOT_REQUEST_EXTRA_JSON must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

const tool = new ToolPlugin([demoLookupTool])
const baseUrl = process.env['KNOT_BASE_URL']
const model = process.env['KNOT_MODEL']
const llm = baseUrl !== undefined && model !== undefined
  ? new OpenAiChatPlugin({
      baseUrl,
      apiKey: process.env['KNOT_API_KEY'],
      model,
      tools: tool.schemas,
      system: [
        'You are a concise assistant.',
        'Use demo_lookup before answering questions about a project status.',
      ].join(' '),
      extraBody: optionalJson(process.env['KNOT_REQUEST_EXTRA_JSON']),
    })
  : new MockLlmPlugin()

const runtime = new Runtime(
  [llm, tool, new OutputPlugin()],
  { trace: line => console.error(line) },
)
const query = process.argv.slice(2).join(' ')
  || 'Look up the status of knot-agent and report it.'

runtime.ingress(events.userMessage, { content: query })
await runtime.runUntilIdle()

