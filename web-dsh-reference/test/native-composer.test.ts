import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSync } from 'esbuild'

test('S1 wraps the native composer seat without duplicating its child slots; Pause/Resume preserve its draft', async () => {
  const output = buildSync({ entryPoints: [new URL('../src/configuration-client.tsx', import.meta.url).pathname],
    bundle: true, write: false, format: 'cjs', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'] }).outputFiles[0].text
  const module = { exports: {} as any }
  new Function('require', 'module', 'exports', output)((name: string) => name === 'react/jsx-runtime'
    ? { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) }
    : name === 'react' ? { useState: (value: any) => [value, () => {}], useEffect: () => {}, useCallback: (fn: any) => fn, useMemo: (fn: any) => fn() } : {}, module, module.exports)
  const entries: any[] = [], listeners: any[] = [], cleanups: any[] = [], requests: any[] = []
  const Native = () => null
  // StoredEntry.options intentionally has no name/inject/children: these are
  // separate public seats in DSH. Copying options cannot reproduce this entry.
  const children = { 'conversation.input.model': {} }, inject = () => ({ hook: true })
  const native = { options: { id: 'input' }, component: Native, children, inject }
  const ctx = { sessions: {}, uiWorkspace: {}, on: (_: string, fn: any) => listeners.push(fn),
    effect: (fn: any) => cleanups.push(fn()), slots: {
      entries: (slot: string) => slot === 'conversation.composer.bar' ? entries : [],
      inject: (_: string, fn: any) => fn(), register: (options: any) => {
        assert.notEqual(options.name, 'conversation.composer.bar')
      },
    } }
  ;(globalThis as any).window = { __DSH_TRANSPORT__: { rpc: { call: async (...args: any[]) => {
    requests.push(args); return { ok: true }
  } } } }
  ;(globalThis as any).document = { documentElement: { lang: 'en' } }
  try {
    module.exports.apply(ctx)
    entries.push(native); listeners.forEach(fn => fn('conversation.composer.bar'))
    const wrapped = native.component
    assert.notEqual(wrapped, Native)
    listeners.forEach(fn => fn('conversation.composer.bar'))
    assert.equal(native.component, wrapped); assert.equal(native.children, children); assert.equal(native.inject, inject)
    const state = { running: false, subagent: 'child', draft: 'Unsent text' }
    const stop = () => 'pause', props = { sessionId: 's', stop, useSession: (fn: any) => fn(state),
      useProjection: () => 'paused', useNotices: (fn: any) => fn(null), useStopShortcut: (fn: any) => fn(['Escape']), t: (key: string) => key }
    const paused = wrapped(props)
    assert.equal(paused.type, Native); assert.ok(paused.props.blocked)
    assert.deepEqual(paused.props.useSession((next: any) => next), { ...state, running: true, subagent: null })
    assert.deepEqual(paused.props.useStopShortcut((next: any) => next), [])
    assert.equal(paused.props.useNotices((next: any) => next).level, 'info')
    assert.equal(paused.props.t('input.stop'), 'Resume'); assert.equal(paused.props.t('input.placeholder'), 'input.placeholder')
    paused.props.stop(); await Promise.resolve()
    assert.equal(requests[0][1], 'knot/session/resume'); assert.deepEqual(requests[0][2], { args: [{ sessionId: 's' }] })
    const running = wrapped({ ...props, useProjection: () => 'running' })
    assert.equal(running.props.stop, stop); assert.equal(running.props.blocked, undefined)
    assert.equal(running.props.useSession((next: any) => next), state)
    assert.equal(running.props.t('input.stop'), 'Pause gracefully')
    assert.equal(running.props.useNotices((next: any) => next), null)
    const readonly = wrapped({ ...props, blocked: { reason: 'Read only' } })
    assert.deepEqual(readonly.props.blocked, { reason: 'Read only' })
    cleanups.forEach(fn => fn()); assert.equal(native.component, Native)
    assert.equal(requests.length, 1)
  } finally { delete (globalThis as any).window; delete (globalThis as any).document }
})
