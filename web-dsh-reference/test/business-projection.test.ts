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
  assert.deepEqual(result.knotTodo, todos); assert.deepEqual(result.knotGoal, goal)
  assert.equal(projectBusinessState({ events: [] } as any).knotGoal, null)
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

test('B5 inspection uses Host metadata and lazy Context endpoints without executing the Session', async () => {
  const paths: string[] = []
  const session = { id: 's', assembly: 'case2' }
  const assembly = { id: 'case2', plugins: [{ id: 'real-plugin' }], protocols: ['user.message'] }
  const remote = createWorkbenchRemote((async (url: string, init: any) => {
    assert.equal(init.method, undefined); paths.push(url)
    if (url.endsWith('/studio')) return Response.json({ projects: [{ assembly }] })
    if (url.endsWith('/sessions')) return Response.json({ sessions: [session, { id: 'child', parentSessionId: 's' }] })
    if (url.includes('/context')) return Response.json({ requestId: 'r', messages: [{ role: 'system', content: 'Actual prompt' }] })
    return Response.json({ session, events: [{ type: 'llm.invoke', data: { requestId: 'r' } }] })
  }) as typeof fetch)
  const call = async (endpoint: string, input: any) => remote.call('$knot', endpoint, { args: [input] }, new AbortController().signal) as Promise<any>
  const inspection = (await call('knot/inspection', { sessionId: 's' })).value
  assert.deepEqual(inspection.assembly, assembly); assert.equal(inspection.children[0].id, 'child')
  assert.equal((await call('knot/context', { sessionId: 's', requestId: 'r' })).value.messages[0].content, 'Actual prompt')
  assert.equal(paths.at(-1), '/api/workbench/sessions/s/context?requestId=r')
})

test('B5 native contributions install even when the original Client activates later', () => {
  const output = buildSync({ entryPoints: [new URL('../src/business-client.tsx', import.meta.url).pathname], bundle: true,
    write: false, format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'] }).outputFiles[0].text
  const module = { exports: {} as any }
  new Function('require', 'module', 'exports', output)((name: string) =>
    name === 'react/jsx-runtime' ? { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) } : {}, module, module.exports)
  const entries: any[] = [], listeners: Array<(slot: string) => void> = []
  const ctx = { sessions: {}, uiWorkspace: {}, on: (_: string, handler: any) => listeners.push(handler),
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
  const original = wrapped.props.children[0]
  globalThis.document = { documentElement: { lang: 'en' } } as any
  try { assert.equal(original.type, Stats); assert.equal(original.props.t('stats.counts', {}), '2 turns 5 steps 34 events') }
  finally { delete (globalThis as any).document }
  const todo = entries.find(entry => entry.options.key === 'todo.write')
  assert.equal(todo.component({ toolName: 'todo.write' }).type, Todo)
  assert.equal(todo.component({ toolName: 'todo.write' }).props.toolName, 'todo_write')
  listeners.forEach(handler => handler('tool.call.toolview'))
  assert.equal(entries.filter(entry => entry.options.key === 'todo.write').length, 1)
})
