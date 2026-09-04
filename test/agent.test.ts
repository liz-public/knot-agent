import assert from 'node:assert/strict'
import test from 'node:test'
import { Runtime } from '../src/core.js'
import { events } from '../src/protocol.js'
import { MockLlmPlugin } from '../src/plugins/llm.js'
import { OutputPlugin } from '../src/plugins/output.js'
import { demoLookupTool, ToolPlugin } from '../src/plugins/tool.js'

test('mock agent reaches a final answer through a tool call', async () => {
  const output: string[] = []
  const runtime = new Runtime([
    new MockLlmPlugin(),
    new ToolPlugin([demoLookupTool]),
    new OutputPlugin(content => output.push(content)),
  ])
  runtime.ingress(events.userMessage, { content: 'Check knot-agent.' })

  const deliveries = await runtime.runUntilIdle()

  assert.equal(deliveries, 4)
  assert.deepEqual(runtime.journal.read().map(event => event.type), [
    events.userMessage,
    events.toolCall,
    events.toolResult,
    events.assistantMessage,
  ])
  assert.match(output[0] ?? '', /journal-driven tool path completed successfully/)
})

