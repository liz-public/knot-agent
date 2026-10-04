import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSync } from 'esbuild'
import { coverPreset } from '../src/cover-preset.ts'

test('cover image is a per-session browser preference; reset and quota failures preserve semantics', () => {
  const source = buildSync({ entryPoints: [new URL('../src/cover-hero.tsx', import.meta.url).pathname], bundle: true,
    write: false, format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'] }).outputFiles[0].text
  const storage = new Map<string, string>(), states: any[] = []
  let cursor = 0, full = false
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const previousReader = Object.getOwnPropertyDescriptor(globalThis, 'FileReader')
  Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: class {
    result = 'data:image/png;base64,test'
    onload?: () => void
    readAsDataURL() { this.onload?.() }
  } })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { if (full) throw new Error('quota'); storage.set(key, value) },
    removeItem: (key: string) => storage.delete(key),
  } })
  try {
    const module = { exports: {} as any }
    new Function('require', 'module', 'exports', source)((name: string) => name === 'react/jsx-runtime'
      ? { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) }
      : name === 'react' ? {
        useRef: () => ({ current: null }),
        useState: (initial: any) => { const index = cursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
          return [states[index], (value: any) => { states[index] = value }] },
      } : { Menu: 'Menu' }, module, module.exports)
    const render = (sessionId = 'a') => { cursor = 0; return module.exports.CoverHero({ sessionId, children: 'Title' }) }
    const menu = (tree: any) => tree.props.children[2].props.children[0]
    let tree = render()
    assert.equal(tree.props['data-image'], undefined)
    menu(tree).props.onSelect('preset'); tree = render()
    assert.equal(tree.props.children[0].props.src, coverPreset)
    assert.equal(storage.get('knot:session-cover:a'), coverPreset)
    assert.equal(storage.has('knot:session-cover:b'), false)
    full = true; menu(tree).props.onSelect('preset'); tree = render()
    assert.equal(tree.props.children[0].props.src, coverPreset)
    assert.equal(tree.props.children[3].props.role, 'alert')
    full = false; states.length = 0 // A reload reads the stored choice.
    tree = render(); assert.equal(tree.props['data-image'], 'true')
    menu(tree).props.onSelect('reset'); tree = render()
    assert.equal(tree.props['data-image'], undefined); assert.equal(storage.size, 0)
    const input = tree.props.children[2].props.children[1]
    const choose = (type: string, size: number) => input.props.onChange({ target: { files: [{ type, size }], value: 'file' } })
    choose('text/plain', 100); tree = render()
    assert.equal(storage.size, 0); assert.equal(tree.props.children[3].props.role, 'alert')
    choose('image/png', 3 * 1024 * 1024); assert.equal(storage.size, 0)
    choose('image/png', 100); tree = render()
    assert.equal(tree.props.children[0].props.src, 'data:image/png;base64,test')
    assert.equal(storage.get('knot:session-cover:a'), 'data:image/png;base64,test')
    states.length = 0; assert.equal(render('b').props['data-image'], undefined)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as any).localStorage
    if (previousReader) Object.defineProperty(globalThis, 'FileReader', previousReader)
    else delete (globalThis as any).FileReader
  }
})
