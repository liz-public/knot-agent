import assert from 'node:assert/strict'
import test from 'node:test'
import { Runtime } from '../src/core.js'
import { events } from '../src/protocol.js'
import { OpenAiChatPlugin } from '../src/plugins/llm.js'
import { OutputPlugin } from '../src/plugins/output.js'
import { demoLookupTool, ToolPlugin } from '../src/plugins/tool.js'

test('OpenAI-compatible plugin maps function calls to journal events', async () => {
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
            function: {
              name: 'demo_lookup',
              arguments: '{"name":"knot-agent"}',
            },
          }],
        }
      : { content: 'The project is ready.' }
    return new Response(JSON.stringify({ choices: [{ message }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    const tool = new ToolPlugin([demoLookupTool])
    const output: string[] = []
    const runtime = new Runtime([
      new OpenAiChatPlugin({
        baseUrl: 'https://llm.invalid/v1',
        model: 'test-model',
        system: 'Use the tool.',
        tools: tool.schemas,
        extraBody: { model_provider: 'maas' },
      }),
      tool,
      new OutputPlugin(content => output.push(content)),
    ])
    runtime.ingress(events.userMessage, { content: 'Check the project.' })

    await runtime.runUntilIdle()

    assert.deepEqual(runtime.journal.read().map(event => event.type), [
      events.userMessage,
      events.toolCall,
      events.toolResult,
      events.assistantMessage,
    ])
    assert.equal(output[0], 'The project is ready.')
    assert.equal(requests[0]?.['model_provider'], 'maas')
    assert.deepEqual(
      (requests[1]?.['messages'] as Array<{ role: string }>).map(message => message.role),
      ['system', 'user', 'assistant', 'tool'],
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

