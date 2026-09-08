import { performance } from 'node:perf_hooks'
import type { Event, Plugin } from '../../journal.js'
import { createCase1Agent } from './case1.js'
import { mockLlmPlugin } from './llm-mock.js'
import { openAiLlmPlugin } from './llm-openai.js'

function configuredLlm(): Plugin {
  const baseUrl = process.env['KNOT_BASE_URL']
  const model = process.env['KNOT_MODEL']
  if (baseUrl === undefined || model === undefined) {
    return mockLlmPlugin()
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
  })
}

const startedAt = performance.now()
const trace: Event[] = []
const agent = createCase1Agent({
  llm: configuredLlm(),
  trace(event) {
    trace.push(event)
    process.stderr.write(
      `${String(trace.length).padStart(2, '0')} +${(performance.now() - startedAt).toFixed(1).padStart(7)}ms ${event.type}\n`,
    )
  },
  output: {
    reasoning: content => process.stderr.write(`[reasoning] ${content}\n`),
    content: content => process.stdout.write(`${content}\n`),
  },
})

const query = process.argv.slice(2).join(' ') || '给李行素打电话'
await agent.submit(query)
process.stderr.write(`[done] ${(performance.now() - startedAt).toFixed(1)}ms, ${trace.length} events\n`)
