import { performance } from 'node:perf_hooks'
import type { Event } from '../../journal.js'
import { openAiLlmProvider } from '../case1/llm-openai.js'
import { createTerminalUi } from '../case1/terminal-ui.js'
import {
  TOOL_CALL,
  TOOL_RESULT,
  type ToolCall,
  type ToolResult,
} from '../case1/protocol.js'
import { createCase2Agent } from './case2.js'

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`)
  return value
}

function describe(event: Event): string {
  if (event.type === TOOL_CALL) {
    const calls = (event.data as ToolCall).calls
    return ` [${calls.map(call => `${call.name}:${call.callId}`).join(', ')}]`
  }
  if (event.type === TOOL_RESULT) {
    const results = (event.data as ToolResult).results
    return ` [${results.map(result => {
      let status = 'result'
      try {
        const content = JSON.parse(result.content) as { ok?: unknown; error?: unknown; exitCode?: unknown }
        status = content.ok === false
          ? `error=${String(content.error ?? content.exitCode ?? 'unknown')}`
          : content.exitCode === undefined ? 'ok' : `exit=${String(content.exitCode)}`
      } catch {
        // The full result remains in the Journal; trace only shows a compact status.
      }
      return `${result.name}:${result.callId}:${status}`
    }).join(', ')}]`
  }
  return ''
}

const query = process.argv.slice(2).join(' ').trim()
if (query.length === 0) throw new Error('Pass one coding task as the command-line argument')

const extra = process.env['KNOT_REQUEST_EXTRA_JSON']
const contextWindow = process.env['KNOT_CONTEXT_WINDOW']
const ui = createTerminalUi(false)
const startedAt = performance.now()
let eventNumber = 0
const agent = createCase2Agent({
  cwd: process.env['KNOT_CWD'] ?? process.cwd(),
  llm: openAiLlmProvider({
    baseUrl: required('KNOT_BASE_URL'),
    model: required('KNOT_MODEL'),
    ...(process.env['KNOT_API_KEY'] === undefined ? {} : { apiKey: process.env['KNOT_API_KEY'] }),
    ...(extra === undefined ? {} : { extraBody: JSON.parse(extra) as Record<string, unknown> }),
    ...(contextWindow === undefined ? {} : { contextWindow: Number(contextWindow) }),
  }),
  liveOutput: ui.live,
  output: ui.output,
  trace(event) {
    eventNumber += 1
    process.stderr.write(
      `${String(eventNumber).padStart(3, '0')} +${(performance.now() - startedAt).toFixed(1).padStart(8)}ms ${event.type}${describe(event)}\n`,
    )
  },
})

await agent.submit(query)
process.stderr.write(
  `[idle] ${(performance.now() - startedAt).toFixed(1)}ms total, ${eventNumber} traced events\n`,
)
