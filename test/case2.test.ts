import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Event } from '../src/journal.js'
import { createCase2Agent } from '../src/cases/case2/case2.js'
import { llmPlugin, type LlmProvider } from '../src/cases/case1/llm.js'
import {
  ASSISTANT_MESSAGE,
  LLM_INVOKE,
  TOOL_CALL,
  TOOL_RESULT,
  type ToolResult,
} from '../src/cases/case1/protocol.js'

const usage = { inputTokens: 20, outputTokens: 5, totalTokens: 25, contextWindow: 1000 }

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
    llm: llmPlugin(provider),
    trace: event => events.push(event),
    output: { content: content => replies.push(content) },
  })

  await agent.submit('Add a multiply function and run the tests.')

  assert.match(await readFile(join(cwd, 'math.js'), 'utf8'), /multiply/)
  assert.equal(events.filter(event => event.type === TOOL_CALL).length, 3)
  assert.equal(events.filter(event => event.type === TOOL_RESULT).length, 3)
  assert.equal(events.filter(event => event.type === LLM_INVOKE).length, 4)
  assert.equal(events.filter(event => event.type === ASSISTANT_MESSAGE).length, 1)
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
    llm: llmPlugin(provider),
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
    llm: llmPlugin(provider),
    trace: event => events.push(event),
  })

  await agent.submit('Track the remaining work.')
  await agent.submit('What remains?')

  const todoResult = events
    .filter(event => event.type === TOOL_RESULT)
    .flatMap(event => (event.data as ToolResult).results)
    .find(result => result.name === 'todo.write')
  assert.equal(todoResult?.state?.key, 'todo')
  assert.equal(generation, 3)
})
