import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Event } from '../src/journal.js'
import { createPersistentCase1Agent } from '../src/cases/case1/case1.js'
import { createCliCatalog } from '../src/cases/case1/cli.js'
import { llmPlugin } from '../src/cases/case1/llm.js'
import { mockLlmProvider } from '../src/cases/case1/llm-mock.js'
import { mockAndroidCliCommands } from '../src/cases/case1/mock-android-tools.js'
import {
  LLM_INVOKE,
  TOOL_CALL,
  USER_MESSAGE,
  type ChatMessage,
  type LlmInvoke,
} from '../src/cases/case1/protocol.js'
import { createAndroidDeviceSession, type ToolDefinition } from '../src/cases/case1/tools.js'

test('CASE1 persists one process and continues the session in a fresh process', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-case1-'))
  const journalPath = join(directory, 'session.jsonl')
  t.after(() => rm(directory, { recursive: true, force: true }))

  let executions = 0
  const assembly = async (
    trace: Event[],
    replies: string[],
    modelInputs: ChatMessage[][],
  ) => {
    const device = createAndroidDeviceSession()
    const cli = createCliCatalog(mockAndroidCliCommands(device))
    const provider = mockLlmProvider()
    const countingBash: ToolDefinition = {
      ...cli.bash,
      async execute(arguments_) {
        executions += 1
        return cli.bash.execute(arguments_)
      },
    }
    return createPersistentCase1Agent({
      journalPath,
      cli,
      tools: [countingBash],
      llm: llmPlugin({
        generate(call) {
          modelInputs.push([...call.messages])
          return provider.generate(call)
        },
      }),
      trace: event => trace.push(event),
      output: { content: content => replies.push(content) },
      now: () => new Date('2026-07-07T06:56:27.000Z'),
    })
  }

  const firstTrace: Event[] = []
  const firstReplies: string[] = []
  const firstInputs: ChatMessage[][] = []
  const first = await assembly(firstTrace, firstReplies, firstInputs)
  await first.submit('打开手电筒')
  assert.equal(executions, 1)
  assert.deepEqual(firstReplies, ['已打开手电筒。'])

  const secondTrace: Event[] = []
  const secondReplies: string[] = []
  const secondInputs: ChatMessage[][] = []
  const second = await assembly(secondTrace, secondReplies, secondInputs)

  // Loading advanced the Journal head before trace and tool handlers existed.
  assert.equal(executions, 1)
  assert.equal(secondTrace.length, 0)

  await second.submit('关闭手电筒')
  assert.equal(executions, 2)
  assert.deepEqual(secondReplies, ['已关闭手电筒。'])
  assert.ok(secondInputs[0]?.some(message =>
    message.role === 'user' && message.content === '打开手电筒',
  ))
  assert.ok(secondInputs[0]?.some(message =>
    message.role === 'assistant' && message.content === '已打开手电筒。',
  ))
  assert.deepEqual(
    second.journal.read()
      .filter(event => event.type === USER_MESSAGE)
      .map(event => (event.data as { turnId: string }).turnId),
    ['turn-1', 'turn-2'],
  )
  assert.deepEqual(
    second.journal.read()
      .filter(event => event.type === LLM_INVOKE)
      .map(event => (event.data as LlmInvoke).requestId),
    ['agent-1', 'agent-2'],
  )
  assert.equal(secondTrace.filter(event => event.type === TOOL_CALL).length, 1)
})
