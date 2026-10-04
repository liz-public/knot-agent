import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extendNativeInput } from '../native-input-extension.ts'
import { recordedTiming, wireNativeTiming } from '../src/native-timing.ts'
import { descending } from '../src/inspection-order.ts'

test('the version-pinned InputBar extension compiles, keeps native defaults and fails on upstream drift', () => {
  const require = createRequire(import.meta.url)
  const source = readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-conversation/client'), 'utf8')
  const extended = extendNativeInput(source)
  assert.notEqual(extended, source)
  new Function('window', extended) // Published loader factory remains syntactically valid.
  assert.ok(extended.includes('primaryAction?.icon ??'))
  assert.ok(extended.includes('primaryAction.disabled === true'))
  assert.throws(() => extendNativeInput(extended), /no longer matches/)
})

test('recorded timing adapts both native Definitions without fabricating chunks or replacing content', () => {
  const event = { type: 'assistant/message', time: 10000, data: { knotTiming: { durationMs: 4000, ttftMs: 1000 }, stream: [] } }
  const context = { matches: [{ event }] }
  assert.deepEqual(recordedTiming(context), { stepStartTime: 6000, firstTokenTime: 7000, completedTime: 10000 })
  assert.equal(recordedTiming({ matches: [] }), undefined)
  assert.equal(recordedTiming({ matches: [{ event: { ...event, data: {} } }] }), undefined)
  assert.equal(recordedTiming({ matches: [{ event: { ...event, data: { knotTiming: { durationMs: 4000 } } } }] })?.firstTokenTime, null)
  const node = { blocks: ['preserved'], timing: { firstTokenTime: null } }
  const chat = { kind: 'assistant-step', buildLocationData: () => ({ value: { finalNode: node } }) }
  const trajectory = { kind: 'trajectory-assistant-step', buildViewNode: () => ({ data: { node, request: { startedAt: 1 } } }) }
  const entries: any[] = [], cleanup: any[] = []
  let changed = () => {}
  wireNativeTiming({ effect: (fn: any) => cleanup.push(fn()), uiConversation: { events: {
    entries: () => entries, subscribe: (fn: any) => { changed = fn; return () => {} },
  } } })
  entries.push(chat, trajectory); changed()
  const first = chat.buildLocationData
  changed(); assert.equal(first, chat.buildLocationData)
  const result = (chat.buildLocationData as any)(context).value.finalNode
  assert.deepEqual(result.timing, recordedTiming(context)); assert.equal(result.blocks, node.blocks)
  const view = (trajectory.buildViewNode as any)(context)
  assert.deepEqual(view.data.node.timing, result.timing); assert.equal(view.data.request.startedAt, 6000)
  assert.deepEqual(event.data.stream, [])
  cleanup.forEach(fn => fn()); assert.notEqual(chat.buildLocationData, first)
})

test('display sorting is descending, stable and does not reorder the Assembly or source rows', () => {
  const rows = [{ id: 'zero', count: 0 }, { id: 'first', count: 3 }, { id: 'second', count: 3 }, { id: 'most', count: 8 }]
  assert.deepEqual(descending(rows, row => row.count).map(row => row.id), ['most', 'first', 'second', 'zero'])
  assert.deepEqual(rows.map(row => row.id), ['zero', 'first', 'second', 'most'])
})
