import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJournal } from '../src/journal.js'
import { agentFlowPlugin } from '../src/cases/case1/agent-flow.js'
import { createBashTool, createCliCatalog } from '../src/cases/case1/cli.js'
import { ANDROID_TOOL_CATALOG } from '../src/cases/case1/android-tool-catalog.js'
import { calculate } from '../src/cases/case1/calculate.js'
import { toolsPlugin } from '../src/agent/plugins/tools.js'
import { createToolDispatcher } from '../src/cases/case1/dispatcher.js'
import { createCase1Agent } from '../src/cases/case1/case1.js'
import { llmPlugin } from '../src/agent/plugins/llm.js'

test('decision budget counts agent generations per turn, not calls or compression', async () => {
  const { journal, runUntilIdle } = createJournal()
  agentFlowPlugin(2)(journal)
  for (const [turnId, purpose] of [['previous', 'agent'], ['current', 'history.compress'], ['current', 'agent'], ['current', 'agent']]) {
    journal.append('llm.generated', { request: { purpose, turnId } })
  }
  journal.append('tool.result', { turnId: 'current', results: [{}, {}] })
  journal.append('tool.result', { turnId: 'next', results: [] })
  await runUntilIdle()
  assert.equal(journal.read().filter(e => e.type === 'assistant.message').length, 1)
  assert.deepEqual(journal.read().filter(e => e.type === 'llm.request').map(e => e.data), [{ purpose: 'agent', turnId: 'next' }])
})

test('unknown function reports the registered tools without hardcoding bash', async () => {
  const { journal, runUntilIdle } = createJournal()
  toolsPlugin([{ name: 'custom', schema: {}, execute: () => ({ content: 'ok' }) }])(journal)
  journal.append('tool.call', { turnId: 't', calls: [{ callId: 'c', name: 'wrong', arguments: {} }] })
  await runUntilIdle()
  assert.match(JSON.stringify(journal.read().find(e => e.type === 'tool.result')?.data), /custom/)
})

test('help and invalid arguments use the same catalog details and never dispatch', async () => {
  const catalog = createCliCatalog(ANDROID_TOOL_CATALOG)
  const tool = createBashTool(catalog, { dispatch() { throw new Error('must not dispatch') } })
  const context = { turnId: 't', callId: 'c' }
  const help = JSON.parse((await tool.execute({ command: 'help calc' }, context)).content)
  assert.equal(help.help, catalog.detailsFor('calc').content)
  const error = JSON.parse((await tool.execute({ command: 'calc' }, context)).content)
  assert.equal(error.ok, false)
  assert.ok(error.hint.includes(help.help))
  const computing = createBashTool(catalog, createToolDispatcher({}))
  assert.equal(JSON.parse((await computing.execute({ command: 'calc "sqrt(144)+21"' }, context)).content).result, 33)
  assert.match((await tool.execute({ command: 'help' }, context)).content, /shopping.search/)
})

test('an endlessly tool-calling provider stops after 16 decisions and the next turn starts fresh', async () => {
  let decisions = 0
  const replies: string[] = []
  const agent = createCase1Agent({
    dispatcher: createToolDispatcher({}), contentSources: [],
    llm: llmPlugin({ async generate() {
      decisions++
      return { generated: { toolCalls: [{ id: `c${decisions}`, name: 'bash', arguments: { command: 'help calc' } }] }, usage: { contextWindow: 128000 } }
    } }),
    output: { content: text => { replies.push(text) } },
  })
  await agent.start()
  await agent.submit('测试循环预算')
  assert.equal(decisions, 16)
  assert.equal(replies.length, 1)
  assert.match(replies[0]!, /16 次决策上限/)
  await agent.submit('再测试一次')
  assert.equal(decisions, 32)
  assert.equal(replies.length, 2)
})

test('calc preserves arithmetic semantics and rejects code, nonfinite values and deep recursion', () => {
  const read = (expression: string) => JSON.parse(calculate(expression).content)
  for (const [expression, expected] of [['(3+5)*2', 16], ['2^3^2', 512], ['-2^2', -4], ['round(2.5)', 2], ['round(-1.5)', -2], ['log10(100)', 2], ['.5+1.', 1.5]] as const) {
    assert.equal(read(expression).result, expected)
  }
  for (const expression of ['1/0', 'sqrt(-1)', '2^1024', 'process.exit()', 'constructor(1)', '1;2', '1e3', '('.repeat(41) + '1' + ')'.repeat(41), '-'.repeat(41) + '1']) {
    assert.equal(read(expression).ok, false, expression)
  }
})

test('argument failures attach help, permission failures and plain text retain original results', async () => {
  const catalog = createCliCatalog(ANDROID_TOOL_CATALOG)
  const context = { turnId: 't', callId: 'c' }
  for (const [content, help] of [['{"ok":false,"error":"invalid_percent"}', true], ['{"ok":false,"error":"permission_denied"}', false], ['plain text', false]] as const) {
    const tool = createBashTool(catalog, { async dispatch() { return { content } } })
    const result = await tool.execute({ command: 'sys.volume 20' }, context)
    if (help) assert.match(JSON.parse(result.content).usage_help, /usage: sys.volume/)
    else assert.equal(result.content, content)
  }
})
