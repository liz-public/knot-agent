import { performance } from 'node:perf_hooks'
import { createInterface } from 'node:readline'
import type { Event, Plugin } from '../../journal.js'
import {
  createCase1Agent,
  createPersistentCase1Agent,
} from './case1.js'
import type { LiveOutput } from './llm.js'
import { mockLlmPlugin } from './llm-mock.js'
import { openAiLlmPlugin } from './llm-openai.js'
import { createTerminalUi } from './terminal-ui.js'

function configuredLlm(liveOutput: LiveOutput): Plugin {
  const baseUrl = process.env['KNOT_BASE_URL']
  const model = process.env['KNOT_MODEL']
  if (baseUrl === undefined || model === undefined) {
    return mockLlmPlugin({}, liveOutput)
  }
  const extra = process.env['KNOT_REQUEST_EXTRA_JSON']
  return openAiLlmPlugin({
    baseUrl,
    model,
    ...(process.env['KNOT_API_KEY'] === undefined
      ? {}
      : { apiKey: process.env['KNOT_API_KEY'] }),
    ...(extra === undefined
      ? {}
      : { extraBody: JSON.parse(extra) as Record<string, unknown> }),
    ...(process.env['KNOT_CONTEXT_WINDOW'] === undefined
      ? {}
      : { contextWindow: Number(process.env['KNOT_CONTEXT_WINDOW']) }),
  }, liveOutput)
}

const query = process.argv.slice(2).join(' ')
const interactive = query.length === 0
const traceEnabled = process.env['KNOT_TRACE'] !== '0'
const startedAt = performance.now()
let eventNumber = 0
const ui = createTerminalUi(interactive)
const options = {
  llm: configuredLlm(ui.live),
  trace(event) {
    if (!traceEnabled) return
    eventNumber += 1
    process.stderr.write(
      `${String(eventNumber).padStart(3, '0')} +${(performance.now() - startedAt).toFixed(1).padStart(8)}ms ${event.type}\n`,
    )
  },
  output: ui.output,
} satisfies Parameters<typeof createCase1Agent>[0]

const journalPath = process.env['KNOT_JOURNAL_PATH']
const agent = journalPath === undefined
  ? createCase1Agent(options)
  : await createPersistentCase1Agent({ ...options, journalPath })

if (!interactive) {
  const turnStartedAt = performance.now()
  await agent.submit(query)
  process.stderr.write(
    `[idle] ${(performance.now() - turnStartedAt).toFixed(1)}ms this turn${traceEnabled ? `, ${eventNumber} traced events` : ''}\n`,
  )
} else {
  await agent.start()
  if (process.stdin.isTTY) {
    process.stdout.write('Knot CASE1 interactive CLI. Type /exit to quit.\n')
  }

  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  if (process.stdin.isTTY) process.stdout.write('you> ')
  for await (const input of lines) {
    const content = input.trim()
    if (content === '/exit' || content === '/quit') break
    if (content.length === 0) {
      if (process.stdin.isTTY) process.stdout.write('you> ')
      continue
    }

    const turnStartedAt = performance.now()
    await agent.submit(content)
    process.stderr.write(`[idle] ${(performance.now() - turnStartedAt).toFixed(1)}ms this turn\n`)
    if (process.stdin.isTTY) process.stdout.write('you> ')
  }
  lines.close()
}
