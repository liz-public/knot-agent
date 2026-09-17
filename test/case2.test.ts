import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Event } from '../src/journal.js'
import { createCase2Agent, createPersistentCase2Agent } from '../src/cases/case2/case2.js'
import type { LlmProvider } from '../src/cases/case1/llm.js'
import type { ToolDefinition } from '../src/cases/case1/tools.js'
import {
  ASSISTANT_MESSAGE,
  HISTORY_CHECKPOINT,
  LLM_INVOKE,
  SESSION_START,
  TOOL_CALL,
  TOOL_RESULT,
  USER_MESSAGE,
  type ToolResult,
} from '../src/cases/case1/protocol.js'
import {
  WORKFLOW_COMPLETED,
  WORKFLOW_PHASE_CHANGED,
  WORKFLOW_STARTED,
} from '../src/cases/case2/protocol.js'

const usage = { inputTokens: 20, outputTokens: 5, totalTokens: 25, contextWindow: 1000 }

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

function waitingTool(started: ReturnType<typeof deferred>, release: ReturnType<typeof deferred>): ToolDefinition {
  return {
    name: 'wait_for_test',
    schema: {
      type: 'function',
      function: { name: 'wait_for_test', parameters: { type: 'object' } },
    },
    async execute() {
      started.resolve()
      await release.promise
      return { content: JSON.stringify({ ok: true }) }
    },
  }
}

test('CASE2.0 edits and verifies a real workspace through the four coding tools', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'knot-case2-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  await writeFile(join(cwd, 'math.js'), 'export const add = (a, b) => a + b\n', 'utf8')
  await writeFile(join(cwd, 'math.test.js'), [
    "import assert from 'node:assert/strict'",
    "import test from 'node:test'",
    "import { add, multiply } from './math.js'",
    "test('math', () => { assert.equal(add(2, 3), 5); assert.equal(multiply(3, 4), 12) })",
    '',
  ].join('\n'), 'utf8')

  let generation = 0
  const provider: LlmProvider = {
    async generate(call) {
      generation += 1
      if (call.request.purpose === 'agent' && call.request.toolMode === 'none') {
        assert.equal(call.tools.length, 0)
        assert.ok(call.messages.some(message => message.content?.includes('Workflow phase: finalizing.')))
        return {
          generated: { content: 'Added multiply and verified the math tests pass.', toolCalls: [] },
          usage,
        }
      }
      if (generation === 1) {
        assert.match(call.messages.at(-1)?.content ?? '', /Current workspace:/)
        assert.deepEqual(
          call.tools.map(schema => (schema['function'] as { name: string }).name),
          ['read', 'write', 'edit', 'bash', 'todo.write'],
        )
        return {
          generated: { toolCalls: [{ id: 'read-1', name: 'read', arguments: { path: 'math.js' } }] },
          usage,
        }
      }
      if (generation === 2) {
        assert.match(call.messages.at(-1)?.content ?? '', /export const add/)
        return {
          generated: {
            toolCalls: [{
              id: 'edit-1',
              name: 'edit',
              arguments: {
                path: 'math.js',
                oldText: 'export const add = (a, b) => a + b\n',
                newText: [
                  'export const add = (a, b) => a + b',
                  'export const multiply = (a, b) => a * b',
                  '',
                ].join('\n'),
              },
            }],
          },
          usage,
        }
      }
      if (generation === 3) {
        return {
          generated: {
            toolCalls: [{ id: 'bash-1', name: 'bash', arguments: { command: 'node --test math.test.js' } }],
          },
          usage,
        }
      }
      assert.match(call.messages.at(-1)?.content ?? '', /"exitCode":0/)
      return {
        generated: { content: 'Added multiply and verified the math tests pass.', toolCalls: [] },
        usage,
      }
    },
  }

  const events: Event[] = []
  const replies: string[] = []
  const agent = createCase2Agent({
    cwd,
    llm: provider,
    trace: event => events.push(event),
    output: { content: content => replies.push(content) },
  })

  await agent.submit('Add a multiply function and run the tests.')

  assert.match(await readFile(join(cwd, 'math.js'), 'utf8'), /multiply/)
  assert.equal(events.filter(event => event.type === TOOL_CALL).length, 3)
  assert.equal(events.filter(event => event.type === TOOL_RESULT).length, 3)
  assert.equal(events.filter(event => event.type === LLM_INVOKE).length, 5)
  assert.equal(events.filter(event => event.type === ASSISTANT_MESSAGE).length, 1)
  assert.equal(events.filter(event => event.type === WORKFLOW_STARTED).length, 1)
  assert.equal(events.filter(event => event.type === WORKFLOW_PHASE_CHANGED).length, 1)
  assert.equal(events.filter(event => event.type === WORKFLOW_COMPLETED).length, 1)
  assert.deepEqual(replies, ['Added multiply and verified the math tests pass.'])
})

test('CASE2.1 keeps approval and ask inside the tool call lifecycle', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'knot-case2-interaction-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const approvals: string[] = []
  const decisions: Array<'allow' | 'deny'> = ['deny', 'allow']
  const questions: string[] = []
  let generation = 0
  const provider: LlmProvider = {
    async generate(call) {
      generation += 1
      if (generation === 1 || generation === 2) {
        return {
          generated: {
            toolCalls: [{
              id: `write-${generation}`,
              name: 'write',
              arguments: { path: 'answer.txt', content: `attempt-${generation}` },
            }],
          },
          usage,
        }
      }
      if (generation === 3) {
        return {
          generated: {
            toolCalls: [{
              id: 'ask-1',
              name: 'ask',
              arguments: { question: 'Keep the file?', choices: ['yes', 'no'] },
            }],
          },
          usage,
        }
      }
      assert.match(call.messages.at(-1)?.content ?? '', /"answer":"yes"/)
      return {
        generated: { content: 'The approved file was written and the user chose yes.', toolCalls: [] },
        usage,
      }
    },
  }
  const results: Event[] = []
  const agent = createCase2Agent({
    cwd,
    llm: provider,
    permissionPolicy: {
      evaluate: ({ toolName }) => toolName === 'write' ? 'ask' : 'allow',
    },
    approvalPort: {
      async request({ toolName }) {
        approvals.push(toolName)
        return decisions.shift()!
      },
    },
    askPort: {
      async ask({ question }) {
        questions.push(question)
        return { answer: 'yes' }
      },
    },
    trace: event => results.push(event),
  })

  await agent.submit('Write the file after approval, then ask whether to keep it.')

  assert.deepEqual(approvals, ['write', 'write'])
  assert.deepEqual(questions, ['Keep the file?'])
  assert.equal(await readFile(join(cwd, 'answer.txt'), 'utf8'), 'attempt-2')
  const toolResults = results
    .filter(event => event.type === TOOL_RESULT)
    .flatMap(event => (event.data as ToolResult).results.map(result => result.content))
  assert.match(toolResults[0]!, /permission_denied/)
  assert.match(toolResults[1]!, /"ok":true/)
  assert.match(toolResults[2]!, /"answer":"yes"/)
})

test('CASE2.2 keeps todo state as a tool fact visible to later generations', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'knot-case2-todo-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  let generation = 0
  const provider: LlmProvider = {
    async generate(call) {
      generation += 1
      if (generation === 1) {
        return {
          generated: {
            toolCalls: [{
              id: 'todo-1',
              name: 'todo.write',
              arguments: {
                todos: [
                  { id: 'inspect', content: 'Inspect the code', status: 'completed' },
                  { id: 'verify', content: 'Run tests', status: 'in_progress' },
                ],
              },
            }],
          },
          usage,
        }
      }
      const todoMessage = call.messages.find(message =>
        message.role === 'tool' && message.content?.includes('Run tests'),
      )
      assert.ok(todoMessage, 'the authoritative todo tool result remains in model context')
      return {
        generated: { content: generation === 2 ? 'Todo state recorded.' : 'I still have the todo state.', toolCalls: [] },
        usage,
      }
    },
  }
  const events: Event[] = []
  const agent = createCase2Agent({
    cwd,
    llm: provider,
    trace: event => events.push(event),
  })

  await agent.submit('Track the remaining work.')
  await agent.submit('What remains?')

  const todoResult = events
    .filter(event => event.type === TOOL_RESULT)
    .flatMap(event => (event.data as ToolResult).results)
    .find(result => result.name === 'todo.write')
  assert.equal(todoResult?.state?.key, 'todo')
  assert.equal(generation, 5)
})

test('CASE2.3 folds steering after an in-flight tool result into one legal model request', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'knot-case2-steer-tool-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const started = deferred()
  const release = deferred()
  let generation = 0
  const provider: LlmProvider = {
    async generate(call) {
      generation += 1
      if (generation === 1) {
        return {
          generated: { toolCalls: [{ id: 'wait-1', name: 'wait_for_test', arguments: {} }] },
          usage,
        }
      }
      assert.deepEqual(call.messages.slice(-3).map(message => message.role), [
        'assistant', 'tool', 'user',
      ])
      assert.equal(call.messages.at(-1)?.content, 'Also explain the result.')
      return {
        generated: { content: 'Finished and explained.', toolCalls: [] },
        usage,
      }
    },
  }
  const replies: string[] = []
  const agent = createCase2Agent({
    cwd,
    llm: provider,
    extraTools: [waitingTool(started, release)],
    output: { content: content => replies.push(content) },
  })

  const running = agent.submit('Wait for the tool.')
  await started.promise
  agent.steer('Also explain the result.')
  release.resolve()
  await running

  assert.equal(generation, 3)
  assert.deepEqual(replies, ['Finished and explained.'])
})

test('CASE2.3 discards a stale completion when steering arrives during generation', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'knot-case2-steer-llm-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const started = deferred()
  const release = deferred()
  let generation = 0
  const provider: LlmProvider = {
    async generate(call) {
      generation += 1
      if (generation === 1) {
        started.resolve()
        await release.promise
        return { generated: { content: 'Stale answer.', toolCalls: [] }, usage }
      }
      assert.ok(call.messages.some(message => message.content === 'Use the new requirement.'))
      return { generated: { content: 'Current answer.', toolCalls: [] }, usage }
    },
  }
  const replies: string[] = []
  const agent = createCase2Agent({
    cwd,
    llm: provider,
    output: { content: content => replies.push(content) },
  })

  const running = agent.submit('Start the task.')
  await started.promise
  agent.steer('Use the new requirement.')
  release.resolve()
  await running

  assert.equal(generation, 3)
  assert.deepEqual(replies, ['Current answer.'])
})

test('CASE2.3 pauses only at the next complete event boundary', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'knot-case2-pause-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const started = deferred()
  const release = deferred()
  let generation = 0
  const provider: LlmProvider = {
    async generate() {
      generation += 1
      if (generation === 1) {
        return {
          generated: { toolCalls: [{ id: 'wait-1', name: 'wait_for_test', arguments: {} }] },
          usage,
        }
      }
      return { generated: { content: 'Resumed.', toolCalls: [] }, usage }
    },
  }
  const agent = createCase2Agent({
    cwd,
    llm: provider,
    extraTools: [waitingTool(started, release)],
  })

  const running = agent.submit('Pause after this tool event.')
  await started.promise
  agent.pause()
  release.resolve()
  for (let attempt = 0; attempt < 20 && agent.status() !== 'paused'; attempt += 1) {
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  assert.equal(agent.status(), 'paused')
  assert.equal(generation, 1)

  agent.resume()
  await running
  assert.equal(agent.status(), 'idle')
  assert.equal(generation, 3)
})

test('CASE2.4 runs a synchronous child journal and returns only its summary to the parent', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'knot-case2-child-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  await writeFile(join(cwd, 'notes.txt'), 'child-visible fact\n', 'utf8')
  const parentEvents: Event[] = []
  const childEvents: Event[] = []
  let parentGeneration = 0
  const parentProvider: LlmProvider = {
    async generate(call) {
      parentGeneration += 1
      if (parentGeneration === 1) {
        return {
          generated: {
            toolCalls: [{
              id: 'spawn-1',
              name: 'spawn_agent',
              arguments: { task: 'Inspect notes.txt and report its fact.' },
            }],
          },
          usage,
        }
      }
      assert.match(call.messages.at(-1)?.content ?? '', /child found: child-visible fact/)
      return {
        generated: { content: 'The child confirmed the fact.', toolCalls: [] },
        usage,
      }
    },
  }
  const parent = createCase2Agent({
    cwd,
    llm: parentProvider,
    trace: event => parentEvents.push(event),
    subagentFactory: {
      async run({ task, cwd: childCwd }) {
        let childGeneration = 0
        let summary = ''
        const child = createCase2Agent({
          cwd: childCwd,
          llm: {
            async generate(call) {
              childGeneration += 1
              if (childGeneration === 1) {
                assert.match(call.messages.at(-2)?.content ?? call.messages.at(-1)?.content ?? '', /Inspect notes/)
                return {
                  generated: {
                    toolCalls: [{ id: 'read-child', name: 'read', arguments: { path: 'notes.txt' } }],
                  },
                  usage,
                }
              }
              assert.match(call.messages.at(-1)?.content ?? '', /child-visible fact/)
              return {
                generated: { content: 'child found: child-visible fact', toolCalls: [] },
                usage,
              }
            },
          },
          trace: event => childEvents.push(event),
          output: { content: content => { summary = content } },
        })
        await child.submit(task)
        return { summary }
      },
    },
  })

  await parent.submit('Delegate inspection of notes.txt.')

  assert.equal(parentEvents.filter(event => event.type === TOOL_CALL).length, 1)
  assert.equal(
    (parentEvents.find(event => event.type === TOOL_CALL)!.data as { calls: Array<{ name: string }> }).calls[0]?.name,
    'spawn_agent',
  )
  assert.ok(childEvents.some(event =>
    event.type === TOOL_CALL
    && (event.data as { calls: Array<{ name: string }> }).calls[0]?.name === 'read',
  ))
  assert.equal(parentEvents.some(event =>
    event.type === TOOL_CALL
    && (event.data as { calls: Array<{ name: string }> }).calls[0]?.name === 'read',
  ), false)
})

test('CASE2 compacts before the finalizing request and then resumes it without tools', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'knot-case2-compress-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const purposes: string[] = []
  const toolCounts: number[] = []
  const streamAvailability: string[] = []
  const events: Event[] = []
  const replies: string[] = []
  const agent = createCase2Agent({
    cwd,
    compression: { threshold: 0.8 },
    liveOutput: {
      open: () => ({ write: () => undefined, close: () => undefined }),
    },
    trace: event => events.push(event),
    output: { content: content => replies.push(content) },
    llm: {
      async generate(call, onUpdate) {
        purposes.push(call.request.purpose)
        toolCounts.push(call.tools.length)
        streamAvailability.push(`${call.request.purpose}:${onUpdate === undefined ? 'silent' : 'visible'}`)
        if (call.request.purpose === 'history.compress') {
          return {
            generated: { content: 'The user requested a verified coding change.', toolCalls: [] },
            usage,
          }
        }
        if (call.request.toolMode === 'none') {
          assert.ok(call.messages.some(message => message.content?.includes('此前会话摘要')))
          return {
            generated: { content: 'Final response after compaction.', toolCalls: [] },
            usage,
          }
        }
        return {
          generated: { content: 'Work candidate.', toolCalls: [] },
          usage: { inputTokens: 85, outputTokens: 5, totalTokens: 90, contextWindow: 100 },
        }
      },
    },
  })

  await agent.submit('Make and verify the requested change.')

  assert.deepEqual(purposes, ['agent', 'history.compress', 'agent'])
  assert.deepEqual(streamAvailability, ['agent:silent', 'history.compress:visible', 'agent:visible'])
  assert.equal(toolCounts.at(-1), 0)
  assert.equal(events.filter(event => event.type === HISTORY_CHECKPOINT).length, 1)
  assert.deepEqual(replies, ['Final response after compaction.'])
})

test('CASE2 restores one completed JSONL session and starts a distinct next workflow', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-case2-persistent-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const journalPath = join(directory, 'session.jsonl')
  const replies: string[] = []

  const first = await createPersistentCase2Agent({
    cwd: directory,
    journalPath,
    output: { content: content => replies.push(content) },
    llm: {
      async generate(call) {
        return {
          generated: {
            content: call.request.purpose === 'agent' && call.request.toolMode === 'none'
              ? 'First final response.'
              : 'First work candidate.',
            toolCalls: [],
          },
          usage,
        }
      },
    },
  })
  await first.submit('First task.')

  const second = await createPersistentCase2Agent({
    cwd: directory,
    journalPath,
    output: { content: content => replies.push(content) },
    llm: {
      async generate(call) {
        assert.ok(call.messages.some(message => message.content === 'First final response.'))
        return {
          generated: {
            content: call.request.purpose === 'agent' && call.request.toolMode === 'none'
              ? 'Second final response.'
              : 'Second work candidate.',
            toolCalls: [],
          },
          usage,
        }
      },
    },
  })
  await second.submit('Second task.')

  const events = second.journal.read()
  const turnIds = events
    .filter(event => event.type === USER_MESSAGE)
    .map(event => (event.data as { turnId: string }).turnId)
  const workflowIds = events
    .filter(event => event.type === WORKFLOW_STARTED)
    .map(event => (event.data as { workflowId: string }).workflowId)
  assert.equal(events.filter(event => event.type === SESSION_START).length, 1)
  assert.equal(new Set(turnIds).size, 2)
  assert.deepEqual(workflowIds, ['workflow-1', 'workflow-2'])
  assert.deepEqual(replies, ['First final response.', 'Second final response.'])
})
