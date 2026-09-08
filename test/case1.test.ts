import assert from 'node:assert/strict'
import test from 'node:test'
import type { Event } from '../src/journal.js'
import { createCase1Agent } from '../src/cases/case1/case1.js'
import { llmPlugin, type LlmProvider } from '../src/cases/case1/llm.js'
import { mockLlmPlugin } from '../src/cases/case1/llm-mock.js'
import { openAiLlmPlugin } from '../src/cases/case1/llm-openai.js'
import {
  ASSISTANT_MESSAGE,
  CONTEXT_DYNAMIC,
  HISTORY_CHECKPOINT,
  LLM_INVOKE,
  TOOL_CALL,
  TOOL_RESULT,
  type DynamicContext,
  type LlmInvoke,
  type ToolCall,
} from '../src/cases/case1/protocol.js'
import type { ToolDefinition } from '../src/cases/case1/tools.js'

const echoTool: ToolDefinition = {
  name: 'echo',
  schema: {
    type: 'function',
    function: {
      name: 'echo',
      description: 'Echo one string back.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
    },
  },
  execute: arguments_ => ({ content: JSON.stringify({ echoed: arguments_['text'] }) }),
}

function fixedUsage() {
  return { inputTokens: 10, outputTokens: 1, totalTokens: 11, contextWindow: 100000 }
}

test('CASE1 keeps one dynamic context through shortcut, tools, compression, and final reply', async () => {
  const seen: Event[] = []
  const replies: string[] = []
  const reasoning: string[] = []
  const agent = createCase1Agent({
    llm: mockLlmPlugin({ contextWindow: 1000, firstAgentInputTokens: 800 }),
    compression: { threshold: 0.8 },
    now: () => new Date('2026-07-07T06:56:27.000Z'),
    trace: event => seen.push(event),
    output: {
      content: content => replies.push(content),
      reasoning: content => reasoning.push(content),
    },
  })

  await agent.submit('给李行素打电话')

  assert.deepEqual(replies, ['已为您拨通李行素的电话。'])
  assert.equal(reasoning.length, 2)

  const dynamic = seen.filter(event => event.type === CONTEXT_DYNAMIC)
  assert.equal(dynamic.length, 1)
  assert.deepEqual((dynamic[0]!.data as DynamicContext).matchedPackages, [
    '电话: com.samsung.android.dialer',
  ])

  const commands = seen
    .filter(event => event.type === TOOL_CALL)
    .map(event => ((event.data as ToolCall).arguments['command']))
  assert.deepEqual(commands, ['contact call 李行素', 'select 1'])
  assert.equal(seen.filter(event => event.type === TOOL_RESULT).length, 2)
  assert.equal(seen.filter(event => event.type === HISTORY_CHECKPOINT).length, 1)

  const invocations = seen
    .filter(event => event.type === LLM_INVOKE)
    .map(event => event.data as LlmInvoke)
  assert.deepEqual(invocations.map(item => item.request.purpose), [
    'agent',
    'history.compress',
    'agent',
  ])
  const agentInvocations = invocations.filter(item => item.request.purpose === 'agent')
  const runtimeContextMessages = agentInvocations.map(invoke =>
    invoke.messages.filter(message =>
      message.content?.startsWith('以下是仅对当前用户请求有效的运行时上下文：'),
    ),
  )
  assert.equal(runtimeContextMessages[0]?.length, 1)
  assert.equal(runtimeContextMessages[1]?.length, 1)
  assert.equal(runtimeContextMessages[0]?.[0]?.content, runtimeContextMessages[1]?.[0]?.content)
  assert.ok(agentInvocations.every(invoke => invoke.tools.length === 1))
  assert.equal(invocations[1]?.tools.length, 0)

  const checkpointIndex = seen.findIndex(event => event.type === HISTORY_CHECKPOINT)
  const finalIndex = seen.findIndex(event => event.type === ASSISTANT_MESSAGE)
  assert.ok(checkpointIndex > 0 && checkpointIndex < finalIndex)
})

test('CASE1 creates a fresh dynamic context for the next user query', async () => {
  const seen: Event[] = []
  const agent = createCase1Agent({
    llm: mockLlmPlugin(),
    trace: event => seen.push(event),
    now: () => new Date('2026-07-07T06:56:27.000Z'),
  })

  await agent.submit('给李行素打电话')
  await agent.submit('你好')

  const dynamic = seen
    .filter(event => event.type === CONTEXT_DYNAMIC)
    .map(event => event.data as DynamicContext)
  assert.deepEqual(dynamic.map(item => item.turnId), ['turn-1', 'turn-2'])

  const latestInvoke = seen
    .filter(event => event.type === LLM_INVOKE)
    .map(event => event.data as LlmInvoke)
    .at(-1)!
  const visibleDynamic = latestInvoke.messages.filter(message =>
    message.content?.startsWith('以下是仅对当前用户请求有效的运行时上下文：'),
  )
  assert.equal(visibleDynamic.length, 1)
  assert.doesNotMatch(visibleDynamic[0]?.content ?? '', /contact|select|dialer/)
})

test('CASE1 OpenAI provider preserves vendor fields and maps function calls', async () => {
  const originalFetch = globalThis.fetch
  const bodies: Array<Record<string, unknown>> = []
  let responseNumber = 0
  globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    responseNumber += 1
    const message = responseNumber === 1
      ? {
        content: null,
        reasoning_content: '选择唯一候选。',
        tool_calls: [{
          id: 'real-shape-select',
          function: { name: 'bash', arguments: '{"command":"select 1"}' },
        }],
      }
      : { content: '已为您拨通李行素的电话。' }
    return new Response(JSON.stringify({
      choices: [{ message }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  try {
    const replies: string[] = []
    const agent = createCase1Agent({
      llm: openAiLlmPlugin({
        baseUrl: 'https://llm.invalid/chat/completions',
        model: 'qwen3-coder',
        contextWindow: 32768,
        extraBody: {
          model_provider: 'maas',
          _lingxi_maf_enabled: false,
          reasoning: { enabled: false },
        },
      }),
      output: { content: content => replies.push(content) },
    })

    await agent.submit('给李行素打电话')

    assert.deepEqual(replies, ['已为您拨通李行素的电话。'])
    assert.equal(bodies.length, 2)
    assert.equal(bodies[0]?.['model_provider'], 'maas')
    assert.equal(bodies[0]?.['_lingxi_maf_enabled'], false)
    assert.deepEqual(bodies[0]?.['reasoning'], { enabled: false })
    assert.equal((bodies[0]?.['tools'] as unknown[]).length, 1)
    const secondMessages = bodies[1]?.['messages'] as Array<{ role: string }>
    assert.deepEqual(secondMessages.slice(-2).map(message => message.role), ['assistant', 'tool'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('parallel tool calls in one generation resume the turn exactly once', async () => {
  const seen: Event[] = []
  let generations = 0
  const provider: LlmProvider = {
    async generate() {
      generations += 1
      if (generations === 1) {
        return {
          generated: {
            toolCalls: ['a', 'b', 'c'].map(id => ({
              id,
              name: 'echo',
              arguments: { text: id },
            })),
          },
          usage: fixedUsage(),
        }
      }
      return { generated: { content: '三件事都办好了。', toolCalls: [] }, usage: fixedUsage() }
    },
  }

  const replies: string[] = []
  const agent = createCase1Agent({
    llm: llmPlugin(provider),
    tools: [echoTool],
    output: { content: content => replies.push(content) },
    trace: event => {
      seen.push(event)
    },
  })
  await agent.submit('你好')

  assert.equal(seen.filter(event => event.type === TOOL_CALL).length, 3)
  assert.equal(seen.filter(event => event.type === TOOL_RESULT).length, 3)
  assert.equal(seen.filter(event => event.type === LLM_INVOKE).length, 2)
  assert.equal(generations, 2)
  assert.deepEqual(replies, ['三件事都办好了。'])
})

test('the join does not depend on how long each parallel tool takes', async () => {
  const seen: Event[] = []
  let generations = 0
  const slowEcho: ToolDefinition = {
    name: 'echo',
    schema: echoTool.schema,
    async execute(arguments_) {
      const text = String(arguments_['text'])
      await new Promise(resolve => setTimeout(resolve, text === 'a' ? 20 : 0))
      return { content: JSON.stringify({ echoed: text }) }
    },
  }
  const provider: LlmProvider = {
    async generate() {
      generations += 1
      if (generations === 1) {
        return {
          generated: {
            toolCalls: ['a', 'b'].map(id => ({ id, name: 'echo', arguments: { text: id } })),
          },
          usage: fixedUsage(),
        }
      }
      return { generated: { content: '两件事都办好了。', toolCalls: [] }, usage: fixedUsage() }
    },
  }

  const agent = createCase1Agent({
    llm: llmPlugin(provider),
    tools: [slowEcho],
    trace: event => {
      seen.push(event)
    },
  })
  await agent.submit('你好')

  assert.equal(generations, 2)
  assert.deepEqual(
    seen.filter(event => event.type === TOOL_RESULT).map(event => (event.data as { callId: string }).callId),
    ['a', 'b'],
  )
  assert.equal(seen.filter(event => event.type === ASSISTANT_MESSAGE).length, 1)
})
