import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createPersistentCase2Agent } from '../dist/src/cases/case2/case2.js'
import { deepSeekLlmProvider } from '../dist/src/cases/case1/llm-deepseek.js'

const apiKey = process.env.DEEPSEEK_API_KEY
if (apiKey === undefined || apiKey.length === 0) {
  throw new Error('DEEPSEEK_API_KEY is required for eval:case2:goal')
}

const effort = process.env.KNOT_EVAL_REASONING_EFFORT ?? 'low'
if (!['none', 'low', 'high', 'max'].includes(effort)) {
  throw new Error('KNOT_EVAL_REASONING_EFFORT must be none, low, high, or max')
}

const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')
const outputDirectory = process.env.KNOT_EVAL_OUTPUT_DIR
  ?? join(process.cwd(), '.local', 'evals', 'case2-goal', stamp)
const workspace = join(outputDirectory, 'workspace')
const journalPath = join(outputDirectory, 'session.jsonl')
await mkdir(workspace, { recursive: true })
const originalReadme = await readFile(join(process.cwd(), 'README.md'), 'utf8')
await writeFile(join(workspace, 'README.md'), originalReadme, 'utf8')

const agent = await createPersistentCase2Agent({
  cwd: workspace,
  journalPath,
  llm: deepSeekLlmProvider({
    apiKey,
    model: process.env.KNOT_DEEPSEEK_MODEL ?? 'deepseek-flash',
    contextWindow: Number(process.env.KNOT_DEEPSEEK_CONTEXT_WINDOW ?? '1000000'),
    ...(process.env.KNOT_DEEPSEEK_BASE_URL === undefined
      ? {}
      : { baseUrl: process.env.KNOT_DEEPSEEK_BASE_URL }),
    thinking: effort === 'none' ? 'disabled' : 'enabled',
    ...(effort === 'none' ? {} : { reasoningEffort: effort }),
  }),
  output: { content: () => undefined },
})

await agent.submit('这是一次只读验证。请先使用 goal.write 建立目标：检查 README 并确认项目的核心架构；成功条件是指出核心数据结构和三条内核保证。然后读取 README，完成后用 goal.write 将目标标记 completed，最后简洁回复。不要修改任何文件。')

const events = agent.journal.read()
const goalStates = events
  .filter(event => event.type === 'tool.result')
  .flatMap(event => event.data.results)
  .filter(result => result.name === 'goal.write')
  .map(result => result.state?.value)
const toolNames = events
  .filter(event => event.type === 'tool.call')
  .flatMap(event => event.data.calls.map(call => call.name))
const final = events.findLast(event => event.type === 'assistant.message')?.data.content

assert.equal(goalStates.at(0)?.status, 'active', 'the model must establish an active goal')
assert.ok(toolNames.includes('read'), 'the model must inspect README with read')
assert.equal(goalStates.at(-1)?.status, 'completed', 'the model must complete the goal')
assert.equal(typeof final, 'string', 'the model must produce a final answer')
assert.equal(await readFile(join(workspace, 'README.md'), 'utf8'), originalReadme, 'README must remain unchanged')

const result = {
  passed: true,
  provider: 'deepseek',
  model: process.env.KNOT_DEEPSEEK_MODEL ?? 'deepseek-flash',
  reasoningEffort: effort,
  eventCount: events.length,
  modelCalls: events.filter(event => event.type === 'llm.generated').length,
  toolNames,
  goalStatuses: goalStates.map(goal => goal?.status),
  final,
  journalPath,
}
await writeFile(join(outputDirectory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
