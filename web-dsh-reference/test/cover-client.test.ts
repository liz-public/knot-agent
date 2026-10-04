import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSync } from 'esbuild'
import { queryAnchor } from '../src/cover-navigation.ts'

test('query navigation uses native visible node identity, not a guessed seq, key or DOM selector', () => {
  const nodes = [{ id: 'knot-user-a', key: 'native/a', kind: 'user' }, { id: 'knot-user-b', key: 'native/b', kind: 'steering' },
    { id: 'knot-user-c', key: 'hidden', kind: 'user', visibility: 'hidden' }]
  assert.deepEqual(queryAnchor(nodes, 'a'), { anchorKey: 'native/a', anchorTop: 0, scrollTop: 0 })
  assert.equal(queryAnchor(nodes, 'b')?.anchorKey, 'native/b')
  assert.equal(queryAnchor(nodes, 'c'), undefined); assert.equal(queryAnchor(nodes, 'missing'), undefined)
})

test('cover wraps only native preference/reader ports and preserves original components, stores and injections', () => {
  const source = buildSync({ entryPoints: [new URL('../src/cover-client.tsx', import.meta.url).pathname], bundle: true,
    write: false, format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'] }).outputFiles[0].text
  const effects: (() => void)[] = []
  const module = { exports: {} as any }
  new Function('require', 'module', 'exports', source)((name: string) => name === 'react/jsx-runtime'
    ? { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) }
    : name === 'react' ? { useEffect: (fn: any) => effects.push(fn), useMemo: (fn: any) => fn(), useRef: (value: any) => ({ current: value }) } : {}, module, module.exports)
  const entries: any[] = [], listeners: any[] = [], cleanups: any[] = []
  const ctx = { on: (_: string, handler: any) => listeners.push(handler), effect: (setup: any) => cleanups.push(setup()), slots: {
    entries: (slot: string) => entries.filter(entry => entry.options.name === slot), inject: (_: string, setup: any) => setup(),
    register: (options: any, component: any) => { const entry = { options, component, inject: options.inject, store: options.store }; entries.push(entry); listeners.forEach(fn => fn(options.name)); return entry },
  } }
  module.exports.apply(ctx)
  assert.equal(entries[0].options.id, 'knot-cover'); assert.equal(entries[0].options.order, -10)
  const Original = () => null, store = {}, inject = () => ({ native: true })
  const session = ctx.slots.register({ name: 'conversation.session', store, inject }, Original)
  const actions = { setView: (value: string) => chosen.push(value) }, chosen: string[] = [], opened: string[] = []
  function renderSession(view: string | null, submitting = false) {
    effects.length = 0
    const result = session.component({ useStore: (fn: any) => fn({ view }), useSession: (fn: any) => fn({ pendingSubmissions: submitting ? [{}] : [] }),
      actions, openView: (view: string) => opened.push(view) })
    effects.forEach(fn => fn()); return result
  }
  assert.equal(renderSession(null).props.view, 'knot-cover'); assert.deepEqual(chosen, ['knot-cover'])
  renderSession('knot-context'); assert.deepEqual(chosen, ['knot-cover']) // Existing preference untouched.
  renderSession('knot-cover', true); assert.deepEqual(opened, ['chat'])
  assert.equal(session.inject, inject); assert.equal(session.store, store)
  const chat = ctx.slots.register({ name: 'conversation.view', id: 'chat', store, inject }, Original)
  const saved: any[] = []
  const result = chat.component({ useChat: (fn: any) => fn({ nodes: { values: () => [{ id: 'knot-user-a', key: 'native/a', kind: 'user' }] } }),
    useSession: (fn: any) => fn({ openState: 'open' }), viewRequest: { view: 'chat', focus: 'user:a' }, completeViewRequest: () => {},
    chatScroll: { read: () => null, save: (value: any) => saved.push(value) } })
  const original = result.props.children[1]
  assert.equal(original.type, Original); assert.equal(original.props.chatScroll.read().anchorKey, 'native/a')
  original.props.chatScroll.save(null); assert.deepEqual(saved, [null]); assert.equal(original.props.chatScroll.read(), null)
  cleanups.forEach(fn => fn()); assert.equal(session.component, Original); assert.equal(chat.component, Original)
})

test('cover shows model composition and compact query navigation, not next-turn configuration', () => {
  const source = buildSync({ entryPoints: [new URL('../src/cover-client.tsx', import.meta.url).pathname], bundle: true,
    write: false, format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime',
      '@deepseek-ai/dsh-client-ui-primitives', './inspection-view.tsx'] }).outputFiles[0].text
  const value = { session: { title: 'Cover', assembly: 'case2', runState: 'idle', writable: true, model: 'pending' },
    recordedConfiguration: { inference: { model: 'recorded' } }, queries: [{ position: 3, turnId: 'a', content: 'Full\noriginal query' }],
    latestReply: { content: 'Latest reply' }, todos: [{ id: '1', content: 'Verify', status: 'completed' }], eventCount: 12,
    usage: { calls: 1, knownCalls: 1, totalTokens: 120, cacheKnownCalls: 1 }, toolCalls: 1,
    compactionCount: 2, runDurationMs: 3000, runDurationPartial: false, modelUsage: [{ model: 'recorded', reasoningEffort: 'high', provider: 'deepseek',
      calls: 1, outputKnownCalls: 1, outputTokens: 20, outputShare: 1, outputRate: 10, timedCalls: 1 }] }
  const module = { exports: {} as any }
  new Function('require', 'module', 'exports', source)((name: string) => name === 'react/jsx-runtime'
    ? { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) }
    : name === 'react' ? { useEffect: () => {}, useState: (initial: any) => [initial, () => {}] }
    : name.endsWith('inspection-view.tsx') ? { Metric: 'Metric', percent: (v: number) => `${v * 100}%`, useRead: () => ({ value, error: '' }) }
    : { Button: 'Button', Input: 'Input', Pill: 'Pill' }, module, module.exports)
  let Cover: any
  module.exports.apply({ on: () => {}, effect: () => {}, slots: { entries: () => [], inject: (_: any, setup: any) => setup(),
    register: (options: any, component: any) => { if (options.id === 'knot-cover') Cover = component } } })
  const opened: unknown[] = []
  const tree = Cover({ sessionId: 's', useProjection: (key: string) => key === 'sessionStats' ? { turns: 3 }
    : key === 'subagentCatalog' ? [{ id: 'child' }] : 12, openView: (...args: unknown[]) => opened.push(args) })
  const all = (node: any): any[] => Array.isArray(node) ? node.flatMap(all) : node && typeof node === 'object'
    ? [node, ...all(node.props?.children)] : [node]
  const nodes = all(tree), text = nodes.filter(node => typeof node === 'string').join(' ')
  assert.ok(!text.includes('下一轮配置')); assert.ok(!text.includes('pending'))
  assert.ok(text.includes('10.0 tok/s')); assert.ok(text.includes('100%'))
  assert.ok(nodes.some(node => node?.props?.className === 'knot-cover-columns'))
  const metrics = nodes.filter(node => node?.type === 'Metric')
  assert.equal(metrics.find(node => node.props.label === '完成轮数').props.children, 3)
  assert.equal(metrics.find(node => node.props.label === '子智能体').props.children, 1)
  assert.equal(metrics.find(node => node.props.label === '历史压缩').props.children, 2)
  assert.ok(!text.includes('用户输入包含轮内追加请求'))
  assert.ok(!text.includes('生成量含厂商计入的推理'))
  assert.ok(!nodes.some(node => node?.type === 'footer'))
  const query = nodes.find(node => node?.props?.className === 'knot-cover-query')
  assert.equal(query.props.title, 'Full\noriginal query'); query.props.onClick()
  assert.deepEqual(opened, [['chat', 'user:a']])
  assert.ok(!nodes.some(node => node?.type === 'summary' && node.props.children === '展开完整请求'))
})
