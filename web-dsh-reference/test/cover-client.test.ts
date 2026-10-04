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
