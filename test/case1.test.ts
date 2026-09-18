import assert from 'node:assert/strict'
import test from 'node:test'
import type { Event } from '../src/journal.js'
import { createCase1Agent } from '../src/cases/case1/case1.js'
import { createCliCatalog } from '../src/cases/case1/cli.js'
import type { ContentSource } from '../src/cases/case1/content.js'
import {
  mockAndroidCliCommands,
  mockAndroidSystemTools,
} from '../src/cases/case1/mock-android-tools.js'
import {
  llmPlugin,
  type GenerationUpdate,
  type LiveOutput,
  type LlmProvider,
} from '../src/cases/case1/llm.js'
import { mockLlmPlugin, mockLlmProvider } from '../src/cases/case1/llm-mock.js'
import { deepSeekLlmProvider } from '../src/cases/case1/llm-deepseek.js'
import { openAiLlmPlugin } from '../src/cases/case1/llm-openai.js'
import {
  isDynamicContextMessage,
  projectMessages,
  projectTools,
} from '../src/cases/case1/projection.js'
import {
  ASSISTANT_MESSAGE,
  CONTENT_REQUEST,
  CONTEXT_DYNAMIC,
  HISTORY_CHECKPOINT,
  HISTORY_COMPACTION_REQUIRED,
  LLM_GENERATED,
  LLM_INVOKE,
  LLM_REQUEST,
  TOOL_CALL,
  TOOL_RESULT,
  type ChatMessage,
  type ContentRequest,
  type DynamicContext,
  type LlmGenerated,
  type LlmInvoke,
  type ToolCall,
  type ToolResult,
} from '../src/cases/case1/protocol.js'
import {
  createAndroidDeviceSession,
  type ToolDefinition,
} from '../src/cases/case1/tools.js'

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
    .flatMap(event => (event.data as ToolCall).calls.map(call => call.arguments['command']))
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
    projectMessages(agent.journal.read(), invoke).filter(isDynamicContextMessage),
  )
  assert.equal(runtimeContextMessages[0]?.length, 1)
  assert.equal(runtimeContextMessages[1]?.length, 1)
  assert.equal(runtimeContextMessages[0]?.[0]?.content, runtimeContextMessages[1]?.[0]?.content)
  assert.equal(projectTools(agent.journal.read()).length, 1)
  assert.equal(invocations[1]?.manifest.kind, 'compress')

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
  const visibleDynamic = projectMessages(agent.journal.read(), latestInvoke)
    .filter(isDynamicContextMessage)
  assert.equal(visibleDynamic.length, 1)
  assert.doesNotMatch(visibleDynamic[0]?.content ?? '', /contact|select|dialer/)
})

test('live output is visible before completion but does not change the journal', async () => {
  const now = () => new Date('2026-07-07T06:56:27.000Z')
  const withoutLive = createCase1Agent({
    llm: mockLlmPlugin({ streamDelayMs: 0 }),
    now,
  })
  await withoutLive.submit('你好')

  const updates: GenerationUpdate[] = []
  let withLive: ReturnType<typeof createCase1Agent>
  const live: LiveOutput = {
    open() {
      return {
        write(update) {
          assert.equal(
            withLive.journal.read().some(event => event.type === ASSISTANT_MESSAGE),
            false,
          )
          updates.push(update)
        },
        close() {},
      }
    },
  }
  withLive = createCase1Agent({
    llm: mockLlmPlugin({ streamDelayMs: 0 }, live),
    now,
  })
  await withLive.submit('你好')

  assert.equal(
    updates.filter(update => update.kind === 'content').map(update => update.text).join(''),
    '我暂时无法处理这个请求。',
  )
  assert.deepEqual(withLive.journal.read(), withoutLive.journal.read())
  assert.equal(withLive.journal.read().some(event => event.type.includes('delta')), false)
})

test('a broken live surface cannot change agent completion', async () => {
  const replies: string[] = []
  const brokenLive: LiveOutput = {
    open() {
      return {
        write() { throw new Error('display disconnected') },
        close() { throw new Error('display disconnected') },
      }
    },
  }
  const agent = createCase1Agent({
    llm: mockLlmPlugin({ streamDelayMs: 0 }, brokenLive),
    output: { content: content => replies.push(content) },
  })

  await agent.submit('你好')

  assert.deepEqual(replies, ['我暂时无法处理这个请求。'])
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
    const secondMessages = bodies[1]?.['messages'] as Array<{
      role: string
      reasoning_content?: string
    }>
    assert.deepEqual(secondMessages.slice(-2).map(message => message.role), ['assistant', 'tool'])
    assert.equal(secondMessages.at(-2)?.reasoning_content, '选择唯一候选。')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('DeepSeek provider supplies required reasoning history without changing canonical messages', async () => {
  const originalFetch = globalThis.fetch
  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(JSON.stringify({
      choices: [{ message: { content: '完成。' } }],
      usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  try {
    const messages: ChatMessage[] = [
      { role: 'user', content: '运行工具。' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'shortcut-call',
          type: 'function',
          function: { name: 'bash', arguments: '{"command":"date"}' },
        }],
      },
      { role: 'tool', tool_call_id: 'shortcut-call', content: '2026-09-18' },
      { role: 'assistant', content: '上一步已完成。', reasoning: '检查工具结果。' },
      { role: 'user', content: '继续。' },
    ]
    const provider = deepSeekLlmProvider({
      apiKey: 'test-key',
      model: 'deepseek-flash',
      thinking: 'enabled',
      reasoningEffort: 'high',
      contextWindow: 1_000_000,
    })

    await provider.generate({
      request: { purpose: 'agent', turnId: 'turn-1' },
      messages,
      tools: [{ type: 'function', function: { name: 'bash' } }],
    })

    const sent = requestBody?.['messages'] as Array<{ role: string; reasoning_content?: string }>
    assert.equal(sent[1]?.reasoning_content, '')
    assert.equal(sent[3]?.reasoning_content, '检查工具结果。')
    assert.deepEqual(requestBody?.['thinking'], { type: 'enabled' })
    assert.equal(requestBody?.['reasoning_effort'], 'high')
    assert.equal(messages[1]?.reasoning, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('CASE1 OpenAI provider streams through the live port and commits one final fact', async () => {
  const originalFetch = globalThis.fetch
  let requestBody: Record<string, unknown> | undefined
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    const sse = [
      'data: {"choices":[{"delta":{"reasoning_content":"正在"}}]}',
      'data: {"choices":[{"delta":{"reasoning_content":"判断"}}]}',
      'data: {"choices":[{"delta":{"content":"已经"}}]}',
      'data: {"choices":[{"delta":{"content":"完成。"}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":4,"total_tokens":16}}',
      'data: [DONE]',
      '',
    ].join('\n\n')
    return new Response(sse, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }

  try {
    const updates: GenerationUpdate[] = []
    const replies: string[] = []
    const events: Event[] = []
    const live: LiveOutput = {
      open: () => ({
        write: update => { updates.push(update) },
        close: () => undefined,
      }),
    }
    const agent = createCase1Agent({
      llm: openAiLlmPlugin({
        baseUrl: 'https://llm.invalid/chat/completions',
        model: 'streaming-model',
        contextWindow: 32768,
      }, live),
      output: { content: content => replies.push(content) },
      trace: event => events.push(event),
    })

    await agent.submit('你好')

    assert.equal(requestBody?.['stream'], true)
    assert.deepEqual(updates, [
      { kind: 'reasoning', text: '正在' },
      { kind: 'reasoning', text: '判断' },
      { kind: 'content', text: '已经' },
      { kind: 'content', text: '完成。' },
    ])
    assert.deepEqual(replies, ['已经完成。'])
    assert.equal(events.filter(event => event.type === ASSISTANT_MESSAGE).length, 1)
    assert.equal(events.some(event => event.type.includes('delta')), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('streamed content, reasoning, and tool-call deltas survive as separate live channels and complete facts', async () => {
  const originalFetch = globalThis.fetch
  let requestNumber = 0
  globalThis.fetch = async () => {
    requestNumber += 1
    const lines = requestNumber === 1
      ? [
        'data: {"choices":[{"delta":{"reasoning_content":"checking"}}]}',
        'data: {"choices":[{"delta":{"content":"I will inspect."}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"echo","arguments":"{\\"text\\":\\""}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"hello\\"}"}}]}}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":4,"total_tokens":16}}',
        'data: [DONE]',
        '',
      ]
      : [
        'data: {"choices":[{"delta":{"content":"Done."}}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":18,"completion_tokens":2,"total_tokens":20}}',
        'data: [DONE]',
        '',
      ]
    return new Response(lines.join('\n\n'), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }

  try {
    const updates: GenerationUpdate[] = []
    const events: Event[] = []
    const agent = createCase1Agent({
      llm: openAiLlmPlugin({
        baseUrl: 'https://llm.invalid/chat/completions',
        model: 'streaming-tools-model',
        contextWindow: 32768,
      }, {
        open: () => ({
          write: update => { updates.push(update) },
          close: () => undefined,
        }),
      }),
      tools: [echoTool],
      trace: event => events.push(event),
    })

    await agent.submit('Inspect with a tool.')

    assert.deepEqual(updates.slice(0, 4), [
      { kind: 'reasoning', text: 'checking' },
      { kind: 'content', text: 'I will inspect.' },
      { kind: 'tool_call', index: 0, id: 'call-1', name: 'echo', argumentsDelta: '{"text":"' },
      { kind: 'tool_call', index: 0, argumentsDelta: 'hello"}' },
    ])
    const generated = events.find(event => event.type === LLM_GENERATED)!.data as LlmGenerated
    assert.equal(generated.generated.content, 'I will inspect.')
    assert.equal(generated.generated.reasoning, 'checking')
    const call = events.find(event => event.type === TOOL_CALL)!.data as ToolCall
    assert.equal(call.assistantContent, 'I will inspect.')
    assert.deepEqual(call.calls[0]?.arguments, { text: 'hello' })
    assert.equal(events.some(event => event.type.includes('delta')), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('CASE1 OpenAI provider preserves missing usage as unknown', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: '完成。' } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })

  try {
    const seen: Event[] = []
    const agent = createCase1Agent({
      llm: openAiLlmPlugin({
        baseUrl: 'https://llm.invalid/chat/completions',
        model: 'missing-usage-model',
        contextWindow: 100,
      }),
      compression: { threshold: 0 },
      trace: event => seen.push(event),
    })

    await agent.submit('你好')

    const generated = seen.find(event => event.type === LLM_GENERATED)!.data as LlmGenerated
    assert.deepEqual(generated.usage, { contextWindow: 100 })
    assert.equal(seen.some(event => event.type === HISTORY_COMPACTION_REQUIRED), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

function parallelEchoProvider(ids: readonly string[], reply: string) {
  let generations = 0
  const provider: LlmProvider = {
    async generate() {
      generations += 1
      if (generations === 1) {
        return {
          generated: {
            toolCalls: ids.map(id => ({ id, name: 'echo', arguments: { text: id } })),
          },
          usage: fixedUsage(),
        }
      }
      return { generated: { content: reply, toolCalls: [] }, usage: fixedUsage() }
    },
  }
  return { provider, generations: () => generations }
}

test('one generation of tool calls is one fact, and one result batch resumes the turn', async () => {
  const seen: Event[] = []
  const replies: string[] = []
  const { provider, generations } = parallelEchoProvider(['a', 'b', 'c'], '三件事都办好了。')
  const agent = createCase1Agent({
    llm: llmPlugin(provider),
    tools: [echoTool],
    output: { content: content => replies.push(content) },
    trace: event => {
      seen.push(event)
    },
  })
  await agent.submit('你好')

  const calls = seen.filter(event => event.type === TOOL_CALL)
  const results = seen.filter(event => event.type === TOOL_RESULT)
  assert.equal(calls.length, 1)
  assert.equal(results.length, 1)
  assert.deepEqual((calls[0]!.data as ToolCall).calls.map(call => call.callId), ['a', 'b', 'c'])
  assert.deepEqual(
    (results[0]!.data as ToolResult).results.map(result => result.callId),
    ['a', 'b', 'c'],
  )
  assert.equal(seen.filter(event => event.type === LLM_INVOKE).length, 2)
  assert.equal(generations(), 2)
  assert.deepEqual(replies, ['三件事都办好了。'])
})

test('tool failures become ordered results and return control to the model', async () => {
  let generations = 0
  const replies: string[] = []
  const seen: Event[] = []
  const explodingTool: ToolDefinition = {
    name: 'explode',
    schema: {
      type: 'function',
      function: { name: 'explode', parameters: { type: 'object' } },
    },
    execute() {
      throw new Error('device unavailable')
    },
  }
  const agent = createCase1Agent({
    llm: llmPlugin({
      async generate(call) {
        generations += 1
        if (generations === 1) {
          return {
            generated: {
              toolCalls: [
                { id: 'ok', name: 'echo', arguments: { text: 'done' } },
                { id: 'throws', name: 'explode', arguments: {} },
                { id: 'missing', name: 'not-installed', arguments: {} },
              ],
            },
            usage: fixedUsage(),
          }
        }
        const results = call.messages.filter(message => message.role === 'tool')
        assert.equal(results.length, 3)
        assert.match(results[1]?.content ?? '', /tool_error/)
        assert.match(results[2]?.content ?? '', /unknown_tool/)
        return {
          generated: { content: '一项完成，两项失败，已说明原因。', toolCalls: [] },
          usage: fixedUsage(),
        }
      },
    }),
    tools: [echoTool, explodingTool],
    output: { content: content => replies.push(content) },
    trace: event => seen.push(event),
  })

  await agent.submit('执行三项操作')

  const batches = seen.filter(event => event.type === TOOL_RESULT)
  assert.equal(batches.length, 1)
  assert.deepEqual(
    (batches[0]!.data as ToolResult).results.map(result => result.callId),
    ['ok', 'throws', 'missing'],
  )
  assert.equal(generations, 2)
  assert.deepEqual(replies, ['一项完成，两项失败，已说明原因。'])
})

test('a later compression includes the previous checkpoint summary', async () => {
  const compressionInputs: string[] = []
  let compressionNumber = 0
  let agentNumber = 0
  const provider: LlmProvider = {
    async generate(call) {
      if (call.request.purpose === 'history.compress') {
        compressionInputs.push(call.messages[1]?.content ?? '')
        compressionNumber += 1
        return {
          generated: { content: `summary-${compressionNumber}`, toolCalls: [] },
          usage: fixedUsage(),
        }
      }
      agentNumber += 1
      return {
        generated: { content: `reply-${agentNumber}`, toolCalls: [] },
        usage: { inputTokens: 85, outputTokens: 5, totalTokens: 90, contextWindow: 100 },
      }
    },
  }
  const agent = createCase1Agent({
    llm: llmPlugin(provider),
    compression: { threshold: 0.8 },
  })

  await agent.submit('first')
  await agent.submit('second')
  await agent.submit('third')

  assert.equal(compressionInputs.length, 2)
  assert.doesNotMatch(compressionInputs[0]!, /summary-1/)
  assert.match(compressionInputs[1]!, /summary-1/)
})

test('unknown usage is not recorded as zero and does not trigger compression', async () => {
  const seen: Event[] = []
  const agent = createCase1Agent({
    llm: llmPlugin({
      async generate() {
        return {
          generated: { content: '完成。', toolCalls: [] },
          usage: { contextWindow: 100 },
        }
      },
    }),
    compression: { threshold: 0 },
    trace: event => seen.push(event),
  })

  await agent.submit('你好')

  const generated = seen.find(event => event.type === LLM_GENERATED)!.data as LlmGenerated
  assert.equal(generated.usage.totalTokens, undefined)
  assert.equal(seen.some(event => event.type === HISTORY_COMPACTION_REQUIRED), false)
})

// Per-call events would be executed strictly one after another, because the
// kernel awaits every handler of an event before delivering the next one.
test('the tools of one batch run concurrently', async () => {
  const delay = 40
  const slowEcho: ToolDefinition = {
    name: 'echo',
    schema: echoTool.schema,
    async execute(arguments_) {
      await new Promise(resolve => setTimeout(resolve, delay))
      return { content: JSON.stringify({ echoed: arguments_['text'] }) }
    },
  }
  const { provider } = parallelEchoProvider(['a', 'b', 'c'], '三件事都办好了。')
  const agent = createCase1Agent({ llm: llmPlugin(provider), tools: [slowEcho] })

  const startedAt = Date.now()
  await agent.submit('你好')

  assert.ok(Date.now() - startedAt < delay * 2, 'three concurrent tools must not cost 3x the delay')
})

test('a batch projects one assistant message carrying every call', async () => {
  const sent: ChatMessage[][] = []
  const { provider } = parallelEchoProvider(['a', 'b', 'c'], '三件事都办好了。')
  const agent = createCase1Agent({
    llm: llmPlugin({
      generate(call) {
        sent.push([...call.messages])
        return provider.generate(call)
      },
    }),
    tools: [echoTool],
  })
  await agent.submit('你好')

  // The API rejects a tool message that does not answer the assistant message
  // right before it, so the tail must be one assistant message with all three
  // ids followed by their three results.
  const tail = sent[1]!.slice(-4)
  assert.deepEqual(tail.map(message => message.role), ['assistant', 'tool', 'tool', 'tool'])
  assert.deepEqual(tail[0]?.tool_calls?.map(call => call.id), ['a', 'b', 'c'])
  assert.deepEqual(tail.slice(1).map(message => message.tool_call_id), ['a', 'b', 'c'])
})

test('every model input can be rebuilt from the journal and its manifest', async () => {
  const seen: Event[] = []
  const sent: ChatMessage[][] = []
  const provider = mockLlmProvider({ contextWindow: 1000, firstAgentInputTokens: 800 })
  const recording: LlmProvider = {
    generate(call) {
      sent.push([...call.messages])
      return provider.generate(call)
    },
  }

  const agent = createCase1Agent({
    llm: llmPlugin(recording),
    compression: { threshold: 0.8 },
    now: () => new Date('2026-07-07T06:56:27.000Z'),
    trace: event => {
      seen.push(event)
    },
  })
  await agent.submit('给李行素打电话')

  // Replayed against the finished journal, which is longer than it was at the
  // time of each call: both ends of every window are addressed by content.
  const rebuilt = seen
    .filter(event => event.type === LLM_INVOKE)
    .map(event => projectMessages(agent.journal.read(), event.data as LlmInvoke))

  assert.equal(sent.length, 3)
  assert.deepEqual(rebuilt, sent)
})

// Stands in for a second content source: a small classifier that costs a network
// round trip, so being called at all is observable. The content plugin owns the
// ordered first-match loop; a source only answers or declines.
function smallModelSource(calls: { count: number }): ContentSource {
  return async request => {
    calls.count += 1
    await new Promise(resolve => setTimeout(resolve, 5))
    if (!request.query.includes('静音')) return undefined
    return {
      kind: 'tools',
      calls: [{
        callId: `small-model-${request.turnId}`,
        name: 'bash',
        arguments: { command: 'volume mute' },
      }],
    }
  }
}

test('a matching source stops later sources from spending anything', async () => {
  const smallModel = { count: 0 }
  let generations = 0
  const agent = createCase1Agent({
    llm: llmPlugin({
      async generate() {
        generations += 1
        return { generated: { content: '好了。', toolCalls: [] }, usage: fixedUsage() }
      },
    }),
    contentSources: [smallModelSource(smallModel)],
  })

  await agent.submit('给李行素打电话')

  // The rule answered, so the classifier never ran; the single generation is
  // the one that turns the tool result into a reply.
  assert.equal(smallModel.count, 0)
  assert.equal(generations, 1)
})

test('an async source can answer a turn the rules missed, without the LLM', async () => {
  const seen: Event[] = []
  const smallModel = { count: 0 }
  let generations = 0
  const agent = createCase1Agent({
    llm: llmPlugin({
      async generate() {
        generations += 1
        return { generated: { content: '已静音。', toolCalls: [] }, usage: fixedUsage() }
      },
    }),
    tools: [{
      name: 'bash',
      schema: echoTool.schema,
      execute: () => ({ content: JSON.stringify({ action: 'muted' }) }),
    }],
    contentSources: [smallModelSource(smallModel)],
    trace: event => {
      seen.push(event)
    },
  })

  await agent.submit('帮我把手机静音')

  assert.equal(smallModel.count, 1)
  assert.deepEqual(
    seen
      .filter(event => event.type === TOOL_CALL)
      .flatMap(event => (event.data as ToolCall).calls.map(call => call.callId)),
    ['small-model-turn-1'],
  )
  // The LLM source stood down because the small model answered, so the only
  // generation is the one resuming the turn after the tool result.
  assert.equal(generations, 1)
})

test('the LLM source asks exactly once when every earlier source declines', async () => {
  const seen: Event[] = []
  const smallModel = { count: 0 }
  const agent = createCase1Agent({
    llm: mockLlmPlugin(),
    contentSources: [
      smallModelSource(smallModel),
      smallModelSource(smallModel),
    ],
    trace: event => {
      seen.push(event)
    },
  })

  await agent.submit('今天天气怎么样')

  assert.equal(smallModel.count, 2)
  assert.equal(seen.filter(event => event.type === LLM_REQUEST).length, 1)
  assert.equal(seen.filter(event => event.type === LLM_INVOKE).length, 1)
})

test('the mock device rejects a selection it never offered', async () => {
  const session = createAndroidDeviceSession()
  const tool = createCliCatalog(mockAndroidCliCommands(session)).bash
  const context = { turnId: 'direct', callId: 'direct-call' }

  const orphan = await tool.execute({ command: 'select 1' }, context)
  assert.match(orphan.content, /no_active_list/)

  await tool.execute({ command: 'contact call 李行素' }, context)
  const outOfRange = await tool.execute({ command: 'select 2' }, context)
  assert.match(outOfRange.content, /invalid_selection/)
  assert.equal(session.pendingContact, '李行素')
})

test('the turn recovers when the device forgot what the journal remembers', async () => {
  const session = createAndroidDeviceSession()
  const cli = createCliCatalog(mockAndroidCliCommands(session))
  const seen: Event[] = []
  const replies: string[] = []
  let callNumber = 0

  const toolCall = (command: string) => {
    callNumber += 1
    return {
      generated: {
        toolCalls: [{ id: `call-${callNumber}`, name: 'bash', arguments: { command } }],
      },
      usage: fixedUsage(),
    }
  }
  const provider: LlmProvider = {
    async generate(call) {
      const turnId = call.request.purpose === 'agent' ? call.request.turnId : 'compress'
      const latest = [...call.messages].reverse().find(message => message.role === 'tool')
      const observed = latest?.content ?? ''
      // Turn 1 stops while the device still holds a candidate list.
      if (turnId === 'turn-1') {
        return { generated: { content: '找到一个候选，需要我拨打吗？', toolCalls: [] }, usage: fixedUsage() }
      }
      if (observed.includes('no_active_list')) return toolCall('contact call 李行素')
      if (observed.includes('"action":"direct_dial"')) {
        return { generated: { content: '已为您拨通李行素的电话。', toolCalls: [] }, usage: fixedUsage() }
      }
      return toolCall('select 1')
    },
  }

  const agent = createCase1Agent({
    llm: llmPlugin(provider),
    cli,
    tools: [cli.bash],
    output: { content: content => replies.push(content) },
    trace: event => {
      seen.push(event)
    },
  })

  await agent.submit('给李行素打电话')
  assert.equal(session.pendingContact, '李行素')

  // The device drops the list: an app restart, a timeout, anything we cannot see.
  session.pendingContact = undefined

  await agent.submit('就选第一个')

  const secondTurnContext = seen
    .filter(event => event.type === CONTEXT_DYNAMIC)
    .map(event => event.data as DynamicContext)
    .find(context => context.turnId === 'turn-2')
  // The journal still believes a selection is pending, which is why the model
  // tries select 1 first.
  assert.match(secondTurnContext?.content ?? '', /pending\.selection/)

  const observations = seen
    .filter(event => event.type === TOOL_RESULT)
    .flatMap(event => (event.data as ToolResult).results.map(result => result.content))
  assert.ok(observations.some(content => content.includes('no_active_list')))
  assert.deepEqual(replies.at(-1), '已为您拨通李行素的电话。')
  assert.equal(session.pendingContact, undefined)
})

test('eight Android-shaped mock tools keep their input and result contracts', async () => {
  const device = createAndroidDeviceSession()
  const byName = new Map(mockAndroidSystemTools(device).map(tool => [tool.name, tool]))
  const execute = async (name: string, arguments_: Record<string, unknown>) => {
    const result = await byName.get(name)!.execute(arguments_, { turnId: 'direct', callId: name })
    return JSON.parse(result.content) as Record<string, unknown>
  }

  assert.deepEqual([...byName.keys()], [
    'set_flashlight',
    'set_ringer_mode',
    'set_do_not_disturb',
    'set_stream_volume',
    'set_wifi_enabled',
    'set_screen_brightness',
    'read_clipboard',
    'write_clipboard',
  ])
  assert.deepEqual(await execute('set_flashlight', { on: true }), {
    ok: true,
    on: true,
    camera_id: '0',
    hint: '闪光灯已切换。一句话告知用户。若是周期闪烁任务，请在同一轮继续下发 flash + wait 组合。',
  })
  assert.equal((await execute('set_ringer_mode', { mode: 'silent' }))['actual_mode'], 'silent')
  assert.equal((await execute('set_do_not_disturb', { enabled: true }))['dnd_active'], true)
  assert.equal((await execute('set_stream_volume', { percent: '+20', stream: 'music' }))['percent'], 70)
  assert.equal((await execute('set_wifi_enabled', { enabled: true }))['action'], 'opened_wifi_panel')
  assert.equal((await execute('set_screen_brightness', { percent: '60' }))['brightness_raw_0_255'], 153)
  assert.equal((await execute('write_clipboard', { text: '明天下午三点开会' }))['char_count'], 8)
  assert.equal((await execute('read_clipboard', {}))['text'], '明天下午三点开会')
})

test('CASE1 runs five user turns against the Android-shaped tool catalog', async () => {
  const device = createAndroidDeviceSession()
  const cli = createCliCatalog(mockAndroidCliCommands(device))
  const replies: string[] = []
  const seen: Event[] = []
  const agent = createCase1Agent({
    llm: mockLlmPlugin(),
    cli,
    tools: [cli.bash],
    output: { content: content => replies.push(content) },
    trace: event => seen.push(event),
  })

  for (const query of [
    '打开手电筒',
    '把媒体音量调到30%',
    '把屏幕亮度调到60%',
    '把“明天下午三点开会”复制到剪贴板',
    '关闭手电筒',
  ]) await agent.submit(query)

  assert.deepEqual(
    seen
      .filter(event => event.type === TOOL_CALL)
      .flatMap(event => (event.data as ToolCall).calls.map(call => call.name)),
    ['bash', 'bash', 'bash', 'bash', 'bash'],
  )
  assert.deepEqual(
    seen
      .filter(event => event.type === TOOL_CALL)
      .flatMap(event => (event.data as ToolCall).calls.map(call => call.arguments['command'])),
    [
      'flash on',
      'sys.volume 30 --stream music',
      'sys.brightness 60',
      'clip.write "明天下午三点开会"',
      'flash off',
    ],
  )
  assert.deepEqual(replies, [
    '已打开手电筒。',
    '已将媒体音量调到 30%。',
    '已将屏幕亮度调到 60%。',
    '已写入剪贴板。',
    '已关闭手电筒。',
  ])
  assert.equal(seen.filter(event => event.type === LLM_INVOKE).length, 8)
  assert.equal(device.flashlightOn, false)
  assert.equal(device.volumes.music, 30)
  assert.equal(device.brightnessPercent, 60)
  assert.equal(device.clipboardText, '明天下午三点开会')

  const contexts = seen
    .filter(event => event.type === CONTEXT_DYNAMIC)
    .map(event => event.data as DynamicContext)
  assert.deepEqual(contexts.map(context => context.matchedCommands), [
    ['flash'],
    ['sys.volume'],
    ['sys.brightness'],
    ['clip.read', 'clip.write'],
    ['flash'],
  ])
  assert.match(contexts[1]?.content ?? '', /usage: sys\.volume/)
  assert.doesNotMatch(contexts[1]?.content ?? '', /usage: sys\.brightness/)

  const schemas = projectTools(agent.journal.read())
  assert.equal(schemas.length, 1)
  assert.equal((schemas[0]?.['function'] as { name?: string })?.name, 'bash')
})
