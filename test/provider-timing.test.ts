import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openAiLlmProvider } from '../src/agent/providers/openai.js'
import { llmPlugin, type GenerationUpdate } from '../src/agent/plugins/llm.js'
import { createJournal } from '../src/journal.js'
import { projectMessages } from '../src/agent/projection.js'

test('Provider records first real output before UI delivery, excluding headers, empty deltas and tool ids', async t => {
  let clock = 0
  t.mock.method(performance, 'now', () => clock)
  const lines: [number, unknown][] = [
    [10, { choices: [{ delta: { role: 'assistant', content: '' } }] }],
    [20, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call' }] } }] }],
    [100, { choices: [{ delta: { reasoning_content: 'Think', tool_calls: [{ index: 0, function: { name: 'bash', arguments: '{}' } }] } }] }],
    [200, { choices: [], usage: { prompt_tokens: 5, completion_tokens: 3 } }],
  ]
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true,
    headers: new Headers({ 'content-type': 'text/event-stream' }), body: { getReader: () => ({ read: async () => {
      const row = lines.shift()
      if (!row) { clock = 210; return { done: true } }
      clock = row[0]
      return { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify(row[1])}\n\n`) }
    } }) },
  }))
  const updates: GenerationUpdate[] = []
  const result = await openAiLlmProvider({ baseUrl: 'https://test.invalid', model: 'test' })
    .generate({ request: { purpose: 'agent', turnId: 't' }, messages: [], tools: [] }, update => {
      updates.push(update); clock += 20 // Presentation must not become the TTFT probe.
    })
  assert.deepEqual(result.timing, { durationMs: 210, ttftMs: 100 })
  assert.equal(updates[0]?.kind, 'tool_call')
  assert.equal(result.generated.toolCalls[0]?.name, 'bash')
})

test('non-streaming and JSON fallback retain duration but never pretend to know first-token latency', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Done' } }] }),
    { headers: { 'content-type': 'application/json' } }))
  const provider = openAiLlmProvider({ baseUrl: 'https://test.invalid', model: 'test' })
  const call = { request: { purpose: 'agent' as const, turnId: 't' }, messages: [], tools: [] }
  for (const sink of [undefined, () => {}]) {
    const result = await provider.generate(call, sink)
    assert.ok(result.timing!.durationMs >= 0); assert.equal(result.timing!.ttftMs, undefined)
  }
})

test('LLM plugin commits Provider timing once and does not project it into model input', async () => {
  const { journal, runUntilIdle } = createJournal()
  const timing = { durationMs: 1000, ttftMs: 200 }
  llmPlugin({ generate: async () => ({ generated: { content: 'Done', toolCalls: [] }, usage: { contextWindow: 1000 }, timing }) })(journal)
  journal.append('llm.invoke', { requestId: 'r', request: { turnId: 't', purpose: 'agent' }, manifest: { kind: 'agent', dynamicTurnId: 't' } })
  await runUntilIdle()
  assert.deepEqual((journal.read().find(event => event.type === 'llm.generated')!.data as any).timing, timing)
  assert.equal(journal.read().some(event => event.type.includes('delta')), false)
  const invoke = { requestId: 'next', request: { turnId: 't', purpose: 'agent' as const }, manifest: { kind: 'agent' as const, dynamicTurnId: 't' } }
  journal.append('llm.invoke', invoke)
  assert.equal(JSON.stringify(projectMessages(journal.read(), invoke)).includes('durationMs'), false)
})
