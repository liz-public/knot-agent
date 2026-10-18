import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { pluginTools, type PluginNode } from '../src/assembly-definition.js'
import { createCase1Agent } from '../src/cases/case1/case1.js'
import { createCase2Agent } from '../src/cases/case2/case2.js'
import { llmPlugin, type LlmProvider } from '../src/agent/plugins/llm.js'
import { createCase1Assembly } from '../src/workbench/case1-assembly.js'
import { createCliCatalog, createBashTool } from '../src/cases/case1/cli.js'
import { ANDROID_TOOL_CATALOG } from '../src/cases/case1/android-tool-catalog.js'
import { createAdbCase1ToolRuntime, createMockCase1ToolRuntime } from '../src/cases/case1/tool-runtimes.js'
import { createDeviceCase1ToolRuntime } from '../src/cases/case1/device-runtime.js'
import { SESSION_START, TOOL_REGISTRY, USER_MESSAGE } from '../src/agent/protocol.js'
import { SESSION_TITLE_CONFIGURED } from '../src/agent/session-title.js'

const provider: LlmProvider = { async generate() {
  return { generated: { content: 'Done.', toolCalls: [] }, usage: { contextWindow: 32_768 } }
} }

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

test('CASE1 mock, ADB and native backends share the catalog and inspected schema', async () => {
  const runtimes = [createMockCase1ToolRuntime(), createAdbCase1ToolRuntime(),
    createDeviceCase1ToolRuntime({ async request() { throw new Error('Inspection must not execute a device operation') } })]
  const schemas: unknown[] = []
  for (const runtime of runtimes) {
    const agent = createCase1Agent({ dispatcher: runtime.dispatcher, llm: llmPlugin(provider) })
    await agent.start()
    const registered = agent.journal.read().find(event => event.type === TOOL_REGISTRY)!.data as { schemas: Record<string, unknown>[] }
    schemas.push(registered.schemas)
    assert.deepEqual(pluginTools(registered.schemas.map(schema => ({ schema }))), createCase1Assembly().description.tools)
    assert.match(JSON.stringify(registered.schemas), /record:/)
  }
  assert.deepEqual(schemas[0], schemas[1])
  assert.deepEqual(schemas[1], schemas[2])
  const bash = createBashTool(createCliCatalog(ANDROID_TOOL_CATALOG), runtimes[1]!.dispatcher)
  const result = await bash.execute({ command: 'record audio start' }, { turnId: 'turn', callId: 'call' })
  assert.equal(JSON.parse(result.content).error, 'unsupported_tool')
})

for (const id of ['case1', 'case2'] as const) {
  function create(platformPlugins: readonly PluginNode[]) {
    return id === 'case1'
      ? createCase1Agent({ dispatcher: createMockCase1ToolRuntime().dispatcher, llm: llmPlugin(provider), platformPlugins })
      : createCase2Agent({ cwd: process.cwd(), llm: provider, platformPlugins })
  }
  test(`${id}: rename and submit share delivery without Host coordination`, async () => {
    const entered = gate(), release = gate()
    const agent = create([{ metadata: { id: 'test', name: 'test', category: 'platform', responsibility: 'Gate title delivery',
      listens: [SESSION_TITLE_CONFIGURED], emits: [], source: 'test' }, plugin: journal => {
        journal.subscribe(SESSION_TITLE_CONFIGURED, async () => { entered.resolve(); await release.promise })
      } }])
    const rename = agent.rename('User title')
    await entered.promise
    const submission = agent.submit('你好')
    assert.equal(agent.status(), 'running')
    await assert.rejects(agent.submit('Concurrent input'), /already running/)
    assert.equal(agent.journal.read().some(event => event.type === USER_MESSAGE), false)
    release.resolve()
    await Promise.all([rename, submission])
    assert.equal(agent.journal.read().filter(event => event.type === SESSION_START).length, 1)
    assert.equal(agent.journal.read().filter(event => event.type === USER_MESSAGE).length, 1)
    assert.equal(agent.status(), 'idle')
    if ('close' in agent && typeof agent.close === 'function') await agent.close()
  })
  test(`${id}: the first submit claims the running boundary before awaiting start`, async () => {
    const entered = gate(), release = gate()
    const agent = create([{ metadata: { id: 'test', name: 'test', category: 'platform', responsibility: 'Gate startup',
      listens: [SESSION_START], emits: [], source: 'test' }, plugin: journal => {
        journal.subscribe(SESSION_START, async () => { entered.resolve(); await release.promise })
      } }])
    const submission = agent.submit('你好')
    await entered.promise
    await assert.rejects(agent.submit('Concurrent input'), /already running/)
    const rename = agent.rename('During start')
    release.resolve()
    await Promise.all([submission, rename])
    assert.equal(agent.journal.read().filter(event => event.type === USER_MESSAGE).length, 1)
    if ('close' in agent && typeof agent.close === 'function') await agent.close()
  })
}

test('shared Agent and device contracts never import a Case or Workbench implementation', async () => {
  async function check(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await check(path)
      else if (entry.name.endsWith('.ts')) {
        const source = await readFile(path, 'utf8')
        assert.doesNotMatch(source, /(?:from\s*|import\s*\()\s*['"][^'"]*\/(?:cases|workbench)\//, path)
      }
    }
  }
  await check('src/agent')
  await check('src/device')
})
