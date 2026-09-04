import assert from 'node:assert/strict'
import test from 'node:test'
import { createJournal, type Event, type Plugin } from '../src/journal.js'
import { SESSION_START, USER_MESSAGE } from '../src/protocol.js'
import { mockLlmPlugin } from '../src/plugins/llm-mock.js'
import { openAiLlmPlugin } from '../src/plugins/llm-openai.js'
import { outputPlugin } from '../src/plugins/output.js'
import { systemPromptPlugin } from '../src/plugins/system-prompt.js'
import { demoLookupTool, toolSchemas, toolsPlugin } from '../src/plugins/tools.js'
import { tracePlugin } from '../src/plugins/trace.js'

function assemble(llm: Plugin) {
  const seen: Event[] = []
  const printed: string[] = []
  const { journal, runUntilIdle } = createJournal()

  for (const plugin of [
    tracePlugin(event => {
      seen.push(event)
    }),
    systemPromptPlugin('Use demo_lookup before reporting a project status.'),
    llm,
    toolsPlugin([demoLookupTool]),
    outputPlugin(content => printed.push(content)),
  ]) plugin(journal)

  return { journal, runUntilIdle, seen, printed }
}

test('a single drain carries a seeded session through the whole tool cycle', async () => {
  const { journal, runUntilIdle, seen, printed } = assemble(mockLlmPlugin())

  journal.append(SESSION_START, {})
  journal.append(USER_MESSAGE, { content: 'Check knot-agent.' })
  await runUntilIdle()

  // system.prompt lands after user.message because handlers append to the tail;
  // the llm plugin still sees it, which proves projection ignores position.
  assert.deepEqual(seen.map(event => event.type), [
    'session.start',
    'user.message',
    'system.prompt',
    'tool.call',
    'tool.result',
    'assistant.message',
  ])
  assert.match(printed[0] ?? '', /journal-driven tool path completed successfully/)
})

test('seeding across two drains reaches the same answer', async () => {
  const { journal, runUntilIdle, printed } = assemble(mockLlmPlugin())

  journal.append(SESSION_START, {})
  await runUntilIdle()
  journal.append(USER_MESSAGE, { content: 'Check knot-agent.' })
  await runUntilIdle()

  assert.match(printed[0] ?? '', /journal-driven tool path completed successfully/)
})

test('the openai-compatible assembly maps function calls to journal events', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<Record<string, unknown>> = []
  let call = 0
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    call += 1
    const message = call === 1
      ? {
        content: null,
        tool_calls: [{
          id: 'call-real-shape',
          function: { name: 'demo_lookup', arguments: '{"name":"knot-agent"}' },
        }],
      }
      : { content: 'The project is ready.' }
    return new Response(JSON.stringify({ choices: [{ message }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    const { journal, runUntilIdle, seen, printed } = assemble(openAiLlmPlugin({
      baseUrl: 'https://llm.invalid/v1',
      model: 'test-model',
      tools: toolSchemas([demoLookupTool]),
      extraBody: { model_provider: 'maas' },
    }))

    journal.append(SESSION_START, {})
    journal.append(USER_MESSAGE, { content: 'Check the project.' })
    await runUntilIdle()

    assert.deepEqual(seen.map(event => event.type), [
      'session.start',
      'user.message',
      'system.prompt',
      'tool.call',
      'tool.result',
      'assistant.message',
    ])
    assert.equal(printed[0], 'The project is ready.')
    assert.equal(requests[0]?.['model_provider'], 'maas')
    assert.deepEqual(
      (requests[0]?.['messages'] as Array<{ role: string }>).map(message => message.role),
      ['system', 'user'],
    )
    assert.deepEqual(
      (requests[1]?.['messages'] as Array<{ role: string }>).map(message => message.role),
      ['system', 'user', 'assistant', 'tool'],
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
