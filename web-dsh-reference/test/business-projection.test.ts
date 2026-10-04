import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSync } from 'esbuild'
import { projectBusinessState } from '../src/business-projection.ts'
import { createWorkbenchRemote } from '../src/workbench-remote.ts'

test('B5 projects successful Todo/Goal state and does not infer state from a denied call', () => {
  const todos = [{ id: '1', content: 'Check', status: 'completed' }]
  const goal = { objective: 'Ship', successCriteria: ['Tests pass'], status: 'completed' }
  const events: any[] = [
    { type: 'tool.call', data: { calls: [{ name: 'todo.write', arguments: { todos: [] } }] } },
    { type: 'tool.result', data: { results: [{ state: { key: 'todo', value: todos } }, { state: { key: 'goal', value: goal } }] } },
    { type: 'tool.result', data: { results: [{ content: '{"ok":false,"error":"permission_denied"}' }] } },
  ]
  const result = projectBusinessState({ events } as any)
  assert.deepEqual(result.todos, todos)
  assert.deepEqual(result.goal, { goal: { objective: 'Ship', successCriteria: ['Tests pass'], phase: 'complete' } })
  assert.equal(projectBusinessState({ events: [] } as any).goal, null)
  assert.equal('knotTodo' in result, false); assert.equal('knotGoal' in result, false)
  events.push({ type: 'tool.result', data: { results: [{ state: { key: 'goal', value: { ...goal, status: 'active' } } }] } })
  assert.equal(projectBusinessState({ events } as any).goal?.goal.phase, 'active')
})

test('B5 keeps total usage with partial cache, counts compression, and labels end-to-end rate separately', () => {
  const events: any[] = [
    { type: 'llm.generated', data: { request: { purpose: 'compact' }, usage: { inputTokens: 100, outputTokens: 10 } } },
    { type: 'llm.invoke', data: { requestId: 'r' }, observedAt: '2026-10-03T00:00:00Z' },
    { type: 'llm.generated', data: { requestId: 'r', request: { purpose: 'agent' }, usage: { inputTokens: 200, outputTokens: 20, cachedInputTokens: 180 } }, observedAt: '2026-10-03T00:00:02Z' },
  ]
  const usage = projectBusinessState({ events } as any).knotUsage
  assert.equal(usage.totalTokens, 330); assert.equal(usage.knownCalls, 2); assert.equal(usage.cacheKnownCalls, 1)
  assert.equal(usage.knownCacheHitRate, .9); assert.equal(usage.latest.cacheHitRate, .9); assert.equal(usage.latest.outputRate, 10)
  events.push({ type: 'llm.generated', data: { request: { purpose: 'agent' } } })
  const unknown = projectBusinessState({ events } as any).knotUsage
  assert.equal(unknown.calls, 3); assert.equal(unknown.knownCalls, 2); assert.deepEqual(unknown.latest, {})
})

test('inspection Clients use independent read endpoints without fetching redundant child lists', async () => {
  const paths: string[] = []
  const session = { id: 's', assembly: 'case2' }
  const assembly = { id: 'case2', plugins: [{ id: 'real-plugin' }], protocols: ['user.message'] }
  const remote = createWorkbenchRemote((async (url: string, init: any) => {
    assert.equal(init.method, undefined); paths.push(url)
    if (url.includes('/analytics/plugins')) return Response.json({ assembly, plugins: [] })
    if (url.includes('/analytics/context')) return Response.json([{ requestId: 'r', breakdown: [] }])
    if (url.includes('/context')) return Response.json({ requestId: 'r', messages: [{ role: 'system', content: 'Actual prompt' }] })
    if (url.includes('/analytics/tools')) return Response.json({ tools: [{ name: 'read', calls: 1 }] })
    return Response.json({ session, events: [{ type: 'llm.invoke', data: { requestId: 'r' } }] })
  }) as typeof fetch)
  const call = async (endpoint: string, input: any) => remote.call('$knot', endpoint, { args: [input] }, new AbortController().signal) as Promise<any>
  const inspection = (await call('knot/journal', { sessionId: 's' })).value
  assert.equal(inspection.session.id, 's'); assert.equal('children' in inspection, false)
  assert.deepEqual((await call('knot/plugins', { sessionId: 's' })).value.assembly, assembly)
  assert.equal((await call('knot/context', { sessionId: 's', requestId: 'r' })).value.messages[0].content, 'Actual prompt')
  assert.equal(paths.at(-1), '/api/workbench/sessions/s/context?requestId=r')
  assert.equal((await call('knot/context-timeline', { sessionId: 's' })).value[0].requestId, 'r')
  assert.equal(paths.at(-1), '/api/workbench/sessions/s/analytics/context')
  assert.equal((await call('knot/tools', { sessionId: 's' })).value.tools[0].calls, 1)
  assert.equal(paths.at(-1), '/api/workbench/sessions/s/analytics/tools')
  await call('knot/cover', { sessionId: 's' })
  assert.equal(paths.at(-1), '/api/workbench/sessions/s/cover')
  assert.equal(paths.some(path => path === '/api/workbench/sessions' || path === '/api/workbench/studio'), false)
})

test('four inspection Clients register independent native sibling tabs, with no nested or child tab', () => {
  const entries: any[] = []
  for (const name of ['journal', 'tools', 'context', 'plugins']) {
    const source = buildSync({ entryPoints: [new URL(`../src/${name}-client.tsx`, import.meta.url).pathname],
      bundle: true, write: false, format: 'cjs', jsx: 'automatic',
      external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'] }).outputFiles[0].text
    const module = { exports: {} as any }
    new Function('require', 'module', 'exports', source)(() => ({}), module, module.exports)
    module.exports.apply({ slots: { inject: (_: string, setup: any) => setup(), register: (options: any, component: any) => entries.push({ options, component }) } })
  }
  assert.deepEqual(entries.map(entry => entry.options.id), ['knot-inspection', 'knot-tools', 'knot-context', 'knot-plugins'])
  assert.deepEqual(entries.map(entry => entry.options.order), [20, 30, 40, 50])
  assert.ok(entries.every(entry => entry.options.name === 'conversation.view'))
  assert.ok(entries.every(entry => Object.keys(entry.options.inject('s')).join() === 'sessionId'))
})

test('B5 native contributions install even when the original Client activates later', async () => {
  const output = buildSync({ entryPoints: [new URL('../src/business-client.tsx', import.meta.url).pathname], bundle: true,
    write: false, format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-goal/client'] }).outputFiles[0].text
  const module = { exports: {} as any }
  new Function('require', 'module', 'exports', output)((name: string) =>
    name === 'react/jsx-runtime' ? { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) }
      : name === '@deepseek-ai/dsh-client-ui-goal/client' ? { GoalBar: 'NativeGoalBar' }
        : name === 'react' ? { useMemo: (fn: any) => fn() } : {}, module, module.exports)
  const entries: any[] = [], listeners: Array<(slot: string) => void> = [], cleanups: any[] = []
  const ctx = { sessions: {}, uiWorkspace: {}, uiConversation: { events: { entries: () => [], subscribe: () => () => {} } }, on: (_: string, handler: any) => listeners.push(handler),
    effect: (setup: any) => cleanups.push(setup()),
    slots: { entries: (slot: string) => entries.filter(entry => entry.options.name === slot), inject: (_: string, setup: any) => setup(),
      register: (options: any, component: any) => { entries.push({ options, component, inject: options.inject, locale: options.locale }); listeners.forEach(handler => handler(options.name)) } } }
  module.exports.apply(ctx)
  const Stats = () => null, Todo = () => null
  const locale = { zh: {} }, inject = () => ({ originalService: true })
  ctx.slots.register({ name: 'conversation.composer.dock', id: 'stats', locale, inject }, Stats)
  ctx.slots.register({ name: 'tool.call.toolview', key: 'todo_write', locale, inject }, Todo)
  const stats = entries.filter(entry => entry.options.id === 'stats')
  assert.equal(stats.length, 2); assert.equal(stats[1].options.inject, inject); assert.equal(stats[1].options.locale, locale)
  const wrapped = stats[1].component({ useProjection: (key: string) => key === 'knotEventCount' ? 34 : undefined, t: () => '2 turns 5 steps' })
  // The original component still owns the layout; only its counts label is extended.
  const original = wrapped
  globalThis.document = { documentElement: { lang: 'en' } } as any
  try { assert.equal(original.type, Stats); assert.equal(original.props.t('stats.counts', {}), '2 turns 5 steps 34 events') }
  finally { delete (globalThis as any).document }
  const todo = entries.find(entry => entry.options.key === 'todo.write')
  assert.equal(todo.component({ toolName: 'todo.write' }).type, Todo)
  assert.equal(todo.component({ toolName: 'todo.write' }).props.toolName, 'todo_write')
  assert.equal(entries.some(entry => entry.options.id === 'knot-tasks'), false)
  const goalDock = entries.find(entry => entry.options.name === 'conversation.input.dock' && entry.options.id === 'goal')
  const readonly = goalDock.component({ useProjection: () => ({ goal: { objective: 'Ship', phase: 'active' } }) })
  assert.equal(readonly.props.inert, '')
  assert.equal(readonly.props.children.type, 'NativeGoalBar')
  assert.equal((await readonly.props.children.props.onEdit('Not permitted')).ok, false)
  assert.equal(goalDock.component({ useProjection: () => ({ goal: { phase: 'complete' } }) }), null)
  listeners.forEach(handler => handler('tool.call.toolview'))
  assert.equal(entries.filter(entry => entry.options.key === 'todo.write').length, 1)

  const Read = () => null, Question = () => null
  ctx.slots.register({ name: 'tool.call.toolview', key: 'read', locale, inject }, Read)
  const nativeRead = entries.find(entry => entry.options.key === 'read')
  const readWrapper = nativeRead.component
  assert.equal(readWrapper({ toolName: 'read', block: { name: 'read', argsRaw: '{"path":"a"}' } }).type, Read)
  assert.equal(JSON.parse(readWrapper({ toolName: 'read', block: { name: 'read', argsRaw: '{"path":"a"}' } }).props.block.argsRaw).file_path, 'a')
  assert.equal(nativeRead.inject, inject)
  ctx.slots.register({ name: 'conversation.composer', locale: 'question', inject }, Question)
  const nativeQuestion = entries.find(entry => entry.locale === 'question')
  const originalMatched = { questions: [{ id: 'q', question: 'Next?' }], answer: async () => 'answered' }
  ;(globalThis as any).document = { documentElement: { lang: 'en' } }
  try {
    const wrappedQuestion = nativeQuestion.component({ matched: originalMatched })
    assert.equal(wrappedQuestion.type, Question)
    await assert.rejects(wrappedQuestion.props.matched.cancel(), /cannot be cancelled/)
    assert.equal(nativeQuestion.inject, inject)
  } finally { delete (globalThis as any).document }
  listeners.forEach(handler => handler('tool.call.toolview'))
  assert.equal(nativeRead.component, readWrapper) // No nested wrapping on a later slot notification.
  cleanups.forEach(cleanup => cleanup())
  assert.equal(nativeRead.component, Read)
  assert.equal(nativeQuestion.component, Question)
})
