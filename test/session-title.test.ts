import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createJournal } from '../src/journal.js'
import { sessionTitlePlugin, SESSION_TITLE_METADATA } from '../src/agent/plugins/session-title.js'
import { projectSessionTitle, SESSION_TITLE_CONFIGURED, TITLE_REQUEST } from '../src/agent/session-title.js'
import type { LlmCall, LlmProvider } from '../src/agent/plugins/llm.js'
import { projectSessionConfiguration } from '../src/agent/session-configuration.js'
import { createPersistentCase2Agent } from '../src/cases/case2/case2.js'
import { createPersistentCase1Agent } from '../src/cases/case1/case1.js'
import { llmPlugin } from '../src/agent/plugins/llm.js'
import { createToolDispatcher } from '../src/cases/case1/dispatcher.js'
import { createLiveSession } from '../src/workbench/live-session.js'
import { case2Assembly } from '../src/workbench/case2-assembly.js'

const result = (content: string) => ({ generated: { content, toolCalls: [] }, usage: { contextWindow: 32768 } })
const configuration = { inference: { providerProfileId: 'test', provider: 'deepseek' as const, model: 'test-model' }, approvalMode: 'auto' as const }

for (const which of ['case1', 'case2'] as const) test(`${which}: assembly requests a title once; restore and later queries do not regenerate it`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-title-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const calls: LlmCall[] = []
  const provider: LlmProvider = { async generate(call) { calls.push(call); return result(call.request ? 'Task reply' : ' 首轮标题 ') } }
  const options = { journalPath: join(directory, 'session.jsonl'), titleProvider: provider }
  const create = () => which === 'case2'
    ? createPersistentCase2Agent({ ...options, cwd: directory, llm: provider })
    : createPersistentCase1Agent({ ...options, dispatcher: createToolDispatcher({}), llm: llmPlugin(provider) })
  const agent = await create()
  await agent.start()
  assert.equal(calls.length, 0)
  await agent.submit('Explain Journal briefly', configuration)
  await agent.submit('Explain subscription briefly', configuration)
  assert.equal(calls.filter(call => !call.request).length, 1)
  const titleCall = calls.find(call => !call.request)!
  assert.deepEqual(titleCall.tools, [])
  assert.deepEqual(titleCall.messages.filter(message => message.role === 'user').map(message => message.content), ['Explain Journal briefly'])
  assert.ok(calls.filter(call => call.request).every(call => !JSON.stringify(call.messages).includes('首轮标题')))
  assert.equal(agent.journal.read().filter(event => event.type === TITLE_REQUEST).length, 1)
  assert.deepEqual(projectSessionTitle(agent.journal.read()), { title: '首轮标题', source: 'generated' })
  const before = await readFile(options.journalPath, 'utf8')
  const restored = await create()
  assert.equal(await readFile(options.journalPath, 'utf8'), before)
  await restored.submit('One more brief reply', configuration)
  assert.equal(calls.filter(call => !call.request).length, 1)
  await restored.rename('用户标题')
  assert.deepEqual(projectSessionTitle(restored.journal.read()), { title: '用户标题', source: 'user' })
})

test('title plugin subscribes only title.request and resolves committed inference at its request boundary', async () => {
  const runtime = createJournal()
  const types: string[] = []
  let configured: unknown
  const plugin = sessionTitlePlugin({ resolve(events) {
    configured = projectSessionConfiguration(events).inference
    return { async generate(call) { assert.equal(call.request, undefined); return result('Title') } }
  } })
  plugin({ ...runtime.journal, subscribe(type, handler) { types.push(type); runtime.journal.subscribe(type, handler) } })
  assert.deepEqual(types, SESSION_TITLE_METADATA.listens)
  runtime.journal.append('inference.configured', configuration.inference)
  runtime.journal.append('user.message', { turnId: 'first', content: 'Query' })
  runtime.journal.append(TITLE_REQUEST, { turnId: 'first' })
  runtime.journal.append('inference.configured', { ...configuration.inference, model: 'later-model' })
  await runtime.runUntilIdle()
  assert.deepEqual(configured, configuration.inference)
})

test('manual rename while title generation is awaiting wins; no second subscription or main reply is produced', async () => {
  const runtime = createJournal()
  let finish!: (value: ReturnType<typeof result>) => void
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  sessionTitlePlugin({ generate: () => { entered(); return new Promise(resolve => { finish = resolve }) } })(runtime.journal)
  runtime.journal.append('user.message', { turnId: 'first', content: 'Query' })
  runtime.journal.append(TITLE_REQUEST, { turnId: 'first' })
  const drain = runtime.runUntilIdle()
  await started
  runtime.journal.append(SESSION_TITLE_CONFIGURED, { title: 'Manual', source: 'user' })
  finish(result('Automatic'))
  await drain
  assert.deepEqual(projectSessionTitle(runtime.journal.read()), { title: 'Manual', source: 'user' })
  assert.equal(runtime.journal.read().filter(event => event.type === SESSION_TITLE_CONFIGURED).length, 1)
  assert.equal(runtime.journal.read().some(event => event.type === 'llm.generated' || event.type === 'assistant.message'), false)
})

test('title failure is a fact, not an exception that aborts the main task or causes an automatic retry', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-title-failure-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let attempts = 0
  const session = await createLiveSession({ id: 'failure', cwd: directory, journalPath: join(directory, 'session.jsonl'),
    assembly: case2Assembly, defaultConfiguration: configuration,
    llm: { async generate(call) {
      if (!call.request) { attempts++; throw new Error('Naming service unavailable') }
      return result('Task completed')
    } },
  })
  assert.equal((await session.snapshot()).events.length, 0)
  for (const query of ['First request', 'Second request']) {
    const idle = new Promise<void>(resolve => {
      const off = session.subscribe!(event => { if (event.kind === 'state.changed' && event.runState === 'idle') { off(); resolve() } })
    })
    session.submit!(query)
    await idle
  }
  const snapshot = await session.snapshot()
  assert.equal(snapshot.session.title, 'New session')
  assert.equal(attempts, 1)
  assert.equal(snapshot.events.filter(event => event.type === 'title.failed').length, 1)
  assert.equal(snapshot.events.filter(event => event.type === 'assistant.message').length, 2)
})
