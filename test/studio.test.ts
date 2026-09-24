import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { PluginMetadata, PluginNode } from '../src/assembly-definition.js'
import { ANDROID_TOOL_CATALOG } from '../src/cases/case1/android-tool-catalog.js'
import { createCliCatalog } from '../src/cases/case1/cli.js'
import { buildCase1PluginNodes, case1PluginMetadata } from '../src/cases/case1/plugin-definitions.js'
import { buildCase2PluginNodes, case2PluginMetadata } from '../src/cases/case2/plugin-definitions.js'
import { createWorkbenchServer } from '../src/workbench/http-server.js'
import { defineAssembly } from '../src/workbench/assembly.js'
import type { WorkbenchSession } from '../src/workbench/session.js'
import { createStudioController, type StudioRunInput } from '../src/workbench/studio.js'

test('CASE2 executable nodes and Studio metadata share one registration source', () => {
  const platformMetadata: PluginMetadata = { id: 'platform-test', name: 'PlatformTest', category: 'platform', responsibility: 'test', listens: ['*'], emits: [], source: 'test' }
  const platform: PluginNode = { metadata: platformMetadata, plugin: () => undefined }
  const nodes = buildCase2PluginNodes({
    boundary: () => undefined,
    cwd: '.',
    llm: { generate: async () => ({ generated: { content: 'done', toolCalls: [] }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, contextWindow: 10 } }) },
    tools: [],
  }, [platform])
  assert.deepEqual(
    nodes.map(node => node.metadata.id),
    case2PluginMetadata([platformMetadata]).map(metadata => metadata.id),
  )
})

test('CASE1 executable nodes and Studio metadata share one registration source', () => {
  const platformMetadata: PluginMetadata = { id: 'platform-test', name: 'PlatformTest', category: 'platform', responsibility: 'test', listens: ['*'], emits: [], source: 'test' }
  const platform: PluginNode = { metadata: platformMetadata, plugin: () => undefined }
  const nodes = buildCase1PluginNodes({
    boundary: () => undefined,
    catalog: createCliCatalog(ANDROID_TOOL_CATALOG),
    llm: () => undefined,
    now: () => new Date(0),
    tools: [],
  }, [platform])
  assert.deepEqual(
    nodes.map(node => node.metadata.id),
    case1PluginMetadata([platformMetadata]).map(metadata => metadata.id),
  )
})

test('Studio accepts an Assembly without prompt, tools, or chat protocols', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-studio-event-only-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const definition = defineAssembly({
    id: 'event-only',
    title: 'Event-only assembly',
    create: options => ({
      id: 'event-only',
      model: options.model,
      create: async () => ({
        submit: async () => undefined,
        steer: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
        status: () => 'idle',
      }),
    }),
  })
  const studio = await createStudioController({
    directory,
    defaultWorkspace: directory,
    assemblies: [definition.description],
    session: () => undefined,
    createRunSession: async () => { throw new Error('not used') },
  })

  const validation = await studio.check('event-only-coding')
  assert.equal(validation.passed, true)
})

function completedSession(input: StudioRunInput): WorkbenchSession {
  const events = [
    { position: 0, type: 'session.start', data: {}, observedAt: '2026-09-20T00:00:00.000Z' },
    {
      position: 1,
      type: 'llm.generated',
      data: { usage: { inputTokens: 100, outputTokens: 20 } },
      observedAt: '2026-09-20T00:00:00.500Z',
    },
    { position: 2, type: 'tool.call', data: { calls: [{ name: 'bash' }] }, observedAt: '2026-09-20T00:00:00.600Z' },
    { position: 3, type: 'tool.result', data: { results: [{ name: 'bash' }] }, observedAt: '2026-09-20T00:00:00.700Z' },
    { position: 4, type: 'assistant.message', data: { content: 'done' }, observedAt: '2026-09-20T00:00:01.000Z' },
  ]
  return {
    id: input.id,
    summary: async () => ({
      id: input.id,
      title: input.title,
      projectId: input.projectId,
      assembly: input.assemblyId,
      assemblyGenerationId: input.generationId,
      workspace: input.workspace,
      model: input.mode === 'mock' ? 'deterministic-mock' : 'real',
      runState: 'idle',
      eventCount: events.length,
      writable: true,
    }),
    snapshot: async () => ({ session: await completedSession(input).summary(), events }),
  }
}

test('Studio persists a CASE2 check, fingerprinted generation, and Journal-derived run', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-studio-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const sessions = new Map<string, WorkbenchSession>()
  const create = async (input: StudioRunInput) => {
    const session = completedSession(input)
    sessions.set(session.id, session)
    return session
  }
  const studio = await createStudioController({
    directory,
    defaultWorkspace: directory,
    session: id => sessions.get(id),
    createRunSession: create,
  })

  const initial = await studio.snapshot()
  assert.equal(initial.cases.length, 2)
  assert.deepEqual(initial.projects.map(item => item.id), ['case1', 'case2'])
  const case2 = initial.projects.find(item => item.id === 'case2')!
  assert.equal(case2.assembly.systemPrompt.length > 0, true)
  assert.deepEqual(case2.assembly.tools.map(tool => tool.name), [
    'read', 'write', 'edit', 'bash', 'todo.write', 'goal.write', 'spawn_agent', 'ask',
  ])
  assert.deepEqual(initial.projects.find(item => item.id === 'case1')?.assembly.tools.map(tool => tool.name), ['bash'])
  assert.equal(case2.activeGenerationId, 'case2-baseline')

  const validation = await studio.check('case2-coding')
  assert.equal(validation.passed, true)
  assert.equal(validation.checks.every(check => check.passed), true)
  const generation = await studio.publish('case2-coding')
  assert.equal(generation.active, true)
  assert.equal(generation.id, 'case2-baseline')
  const run = await studio.run({ caseId: 'case2-coding', mode: 'mock' })
  assert.equal(run.status, 'passed')
  assert.deepEqual(run.assertions, [
    { eventType: 'tool.result', passed: true },
    { eventType: 'assistant.message', passed: true },
  ])
  assert.deepEqual(run.metrics, {
    eventCount: 5,
    modelCalls: 1,
    toolCalls: 1,
    inputTokens: 100,
    outputTokens: 20,
    durationMs: 1000,
  })
  const flow = await studio.flow(run.id)
  assert.deepEqual(flow.steps.map(step => step.type), ['session.start', 'llm.generated', 'tool.call', 'tool.result', 'assistant.message'])
  assert.equal(flow.steps.find(step => step.type === 'tool.call')?.consumers.includes('tools'), true)
  const case1Validation = await studio.check('case1-mobile')
  assert.equal(case1Validation.passed, true)
  const case1Generation = await studio.publish('case1-mobile')
  const case1Run = await studio.run({ caseId: 'case1-mobile', mode: 'mock' })
  assert.equal(case1Run.generationId, case1Generation.id)
  assert.equal(case1Run.status, 'passed')
  const createdProject = await studio.createProject({ title: 'Second coding Project', projectRoot: directory, assemblyId: 'case2' })
  assert.equal(createdProject.assembly.id, 'case2')

  const restored = await createStudioController({
    directory,
    defaultWorkspace: 'ignored',
    session: id => sessions.get(id),
    createRunSession: create,
  })
  const snapshot = await restored.snapshot()
  assert.equal(snapshot.projects.find(item => item.id === 'case2')?.activeGenerationId, generation.id)
  assert.equal(snapshot.projects.find(item => item.id === 'case1')?.activeGenerationId, case1Generation.id)
  assert.equal(snapshot.runs[0]?.sessionId, run.sessionId)
  assert.equal(snapshot.cases.find(item => item.id === 'case2-coding')?.runCount, 1)
  assert.equal(snapshot.cases.some(item => item.projectId === createdProject.id), true)
})

test('Studio migrates legacy Assembly-keyed data without changing Case or Generation identities', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-studio-migration-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(join(directory, 'studio.json'), JSON.stringify({
    cases: [{ id: 'legacy-case', title: 'Legacy', summary: 'kept', assemblyId: 'case2', workspace: directory, prompt: 'hello', assertions: [], createdAt: '2026-01-01T00:00:00.000Z' }],
    validations: [],
    generations: [{ id: 'legacy-generation', assemblyId: 'case2', assemblyFingerprint: 'old-fingerprint', validationId: 'built-in', createdAt: '2026-01-01T00:00:00.000Z' }],
    runs: [],
    activeGenerationIds: { case2: 'legacy-generation' },
  }))
  const studio = await createStudioController({
    directory,
    defaultWorkspace: directory,
    session: () => undefined,
    createRunSession: async () => { throw new Error('not used') },
  })

  const snapshot = await studio.snapshot()
  assert.equal(snapshot.cases.find(item => item.id === 'legacy-case')?.projectId, 'case2')
  assert.equal(snapshot.generations.find(item => item.id === 'legacy-generation')?.projectId, 'case2')
  assert.equal(snapshot.projects.find(item => item.id === 'case2')?.activeGenerationId, 'legacy-generation')
  const persisted = JSON.parse(await readFile(join(directory, 'studio.json'), 'utf8')) as Record<string, unknown>
  assert.equal(persisted['schemaVersion'], 2)
  assert.equal('assemblyId' in (persisted['cases'] as Record<string, unknown>[])[0]!, false)
  assert.equal((await readFile(join(directory, 'studio.json.v1.backup'), 'utf8')).includes('legacy-generation'), true)
})

test('Studio HTTP API drives check, publish, and a Journal-backed Mock run', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'knot-studio-http-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const sessions = new Map<string, WorkbenchSession>()
  const studio = await createStudioController({
    directory,
    defaultWorkspace: directory,
    session: id => sessions.get(id),
    createRunSession: async input => {
      const session = completedSession(input)
      sessions.set(session.id, session)
      return session
    },
  })
  const server = createWorkbenchServer({ sessions: [], studio })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error === undefined ? resolve() : reject(error))
  }))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected TCP address')
  const base = `http://127.0.0.1:${address.port}/api/workbench/studio`
  const post = async (path: string, body: unknown) => fetch(`${base}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  const initial = await fetch(base)
  assert.equal(initial.status, 200)
  assert.equal((await initial.json() as { projects: Array<{ id: string; activeGenerationId: string }> }).projects.find(item => item.id === 'case2')?.activeGenerationId, 'case2-baseline')

  const checked = await post('check', { caseId: 'case2-coding' })
  assert.equal(checked.status, 200)
  assert.equal((await checked.json() as { validation: { passed: boolean } }).validation.passed, true)

  const published = await post('publish', { caseId: 'case2-coding' })
  assert.equal(published.status, 201)
  const generationId = (await published.json() as { generation: { id: string } }).generation.id

  const executed = await post('runs', { caseId: 'case2-coding', mode: 'mock' })
  assert.equal(executed.status, 201)
  const run = (await executed.json() as { run: { id: string; status: string; generationId: string; metrics: { eventCount: number } } }).run
  assert.equal(run.status, 'passed')
  assert.equal(run.generationId, generationId)
  assert.equal(run.metrics.eventCount, 5)

  const flow = await fetch(`${base}/runs/${run.id}/flow`)
  assert.equal(flow.status, 200)
  assert.equal((await flow.json() as { steps: unknown[] }).steps.length, 5)
})
