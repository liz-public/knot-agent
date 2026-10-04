import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSync } from 'esbuild'

test('100% context chart uses stable step bands, retains unknown gaps and selects the original request', () => {
  const output = buildSync({ entryPoints: [new URL('../src/context-chart.tsx', import.meta.url).pathname], bundle: true,
    write: false, format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'] }).outputFiles[0].text
  const module = { exports: {} as any }
  new Function('require', 'module', 'exports', output)((name: string) => name === 'react/jsx-runtime'
    ? { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) }
    : name === 'react' ? { useState: () => [undefined, () => {}] } : {}, module, module.exports)
  const points = [
    { requestId: 'a', purpose: 'agent', position: 3, totalChars: 100, breakdown: [{ key: 'system', share: .4, chars: 40 }, { key: 'user', share: .6, chars: 60 }] },
    { requestId: 'b', purpose: 'agent', position: 8, totalChars: 200, breakdown: [{ key: 'system', share: .2, chars: 40 }, { key: 'user', share: .8, chars: 160 }] },
    { requestId: 'c', purpose: 'history.compress', position: 10, error: 'Missing checkpoint' },
  ]
  const before = JSON.stringify(points), bands = module.exports.contextBands(points)
  assert.equal(bands.at(-1).segments[0].top, 1); assert.equal(bands.at(-1).segments[1].top, 1)
  assert.ok(bands.every((band: any) => band.segments[2].known === false))
  assert.equal(JSON.stringify(points), before)
  let chosen: string | undefined
  const tree = module.exports.ContextChart({ points, selectedId: 'a', onSelect: (id: string) => { chosen = id } })
  const all = (node: any): any[] => !node ? [] : Array.isArray(node) ? node.flatMap(all)
    : typeof node === 'object' ? [node, ...all(node.props?.children)] : []
  const nodes = all(tree), buttons = nodes.filter(node => node.type === 'rect' && node.props.role === 'button')
  assert.equal(buttons.length, 3); assert.equal(buttons[0].props.tabIndex, 0)
  buttons[1].props.onClick(); assert.equal(chosen, 'b')
  assert.ok(nodes.some(node => node.type === 'title' && node.props.children === 'Missing checkpoint'))
  assert.ok(nodes.filter(node => node.type === 'path').every(node => !node.props.d.includes('NaN')))
  assert.equal(all(module.exports.ContextChart({ points: [], onSelect: () => {} })).some(node => node.type === 'svg'), false)
  assert.ok(module.exports.contextBands(points.slice(0, 1)).every((band: any) => band.segments.length === 1))
})
