import assert from 'node:assert/strict'
import test from 'node:test'
import { projectToolAnalytics } from '../src/workbench/tool-analytics.js'
import { projectModelContext } from '../src/workbench/context-projection.js'
import type { ReadEvent } from '../src/workbench/read-journal.js'

test('S4 tool counters distinguish failure, unknown and pending; parallel batch time is counted once per tool', () => {
  const events: ReadEvent[] = [
    { position: 0, type: 'tool.call', observedAt: '2026-10-04T00:00:00Z', data: { calls: [
      { callId: 'a', name: 'bash' }, { callId: 'b', name: 'bash' }, { callId: 'c', name: 'read' }, { callId: 'd', name: 'edit' },
    ] } },
    { position: 1, type: 'tool.result', observedAt: '2026-10-04T00:00:02Z', data: { results: [
      { callId: 'a', content: '{"exitCode":0}' }, { callId: 'b', content: '{"exitCode":1}' }, { callId: 'c', content: 'unstructured' },
    ] } },
    { position: 2, type: 'tool.result', data: { results: [{ callId: 'b', content: '{"ok":true}' }, { callId: 'orphan', content: '{"ok":true}' }] } },
    { position: 3, type: 'tool.call', data: { calls: [{ callId: 'e', name: 'read' }] } },
    { position: 4, type: 'tool.result', data: { results: [{ callId: 'e', content: '{"ok":false,"error":"permission_denied"}' }] } },
  ]
  const before = JSON.stringify(events), result = projectToolAnalytics(events)
  assert.equal(JSON.stringify(events), before)
  assert.deepEqual(result.tools[0], { name: 'bash', calls: 2, returned: 2, succeeded: 1, failed: 1, unknown: 0,
    unfinished: 0, timedBatches: 1, totalBatchWaitMs: 2000 })
  assert.equal(result.tools[1]?.unknown, 1); assert.equal(result.tools[1]?.failed, 1)
  assert.equal(result.tools[1]?.timedBatches, 1) // Missing timestamps are unknown, not zero.
  assert.equal(result.tools[2]?.unfinished, 1); assert.equal(result.tools[2]?.failed, 0)
  assert.deepEqual(projectToolAnalytics([]).tools, [])
})

test('S4 context character accounting uses actual projected input, with bounded source references', () => {
  const events = [
    { type: 'system.prompt', data: { content: 'System' } },
    { type: 'context.fixed', data: { content: 'workspace' } },
    { type: 'tool.registry', data: { schemas: [{ function: { name: 'read' } }] } },
    { type: 'user.message', data: { turnId: 't', content: 'Query' } },
    { type: 'context.dynamic', data: { turnId: 't', content: 'live context' } },
    { type: 'llm.invoke', data: { requestId: 'r1', request: { purpose: 'agent', turnId: 't' }, manifest: { kind: 'agent', dynamicTurnId: 't' } } },
    { type: 'llm.generated', data: { requestId: 'r1', generated: { content: 'Narrative', reasoning: 'Reasoning', toolCalls: [{ id: 'c', name: 'read', arguments: { path: 'a' } }] } } },
    { type: 'tool.call', data: { sourceRequestId: 'r1', assistantContent: 'Narrative', calls: [{ callId: 'c', name: 'read', arguments: { path: 'a' } }] } },
    { type: 'tool.result', data: { results: [{ callId: 'c', content: 'File content' }] } },
    { type: 'llm.invoke', data: { requestId: 'r2', request: { purpose: 'agent', turnId: 't' }, manifest: { kind: 'agent', dynamicTurnId: 't' } } },
  ]
  const result = projectModelContext(events, 'r2')!
  const row = (key: string) => result.inspection.breakdown.find(row => row.key === key)!
  assert.equal(row('assistant').chars, 'Narrative'.length) // Not both generated + tool.call copies.
  assert.equal(row('reasoning').chars, 'Reasoning'.length)
  assert.equal(row('tool_arguments').chars, JSON.stringify({ path: 'a' }).length)
  assert.equal(row('tool_results').chars, 'File content'.length)
  assert.equal(row('dynamic').chars, result.messages.find(message => message.content?.includes('live context'))!.content!.length)
  assert.equal(result.inspection.breakdown.reduce((sum, row) => sum + row.chars, 0), result.inspection.totalChars)
  assert.ok(Math.abs(result.inspection.breakdown.reduce((sum, row) => sum + row.share, 0) - 1) < 1e-12)
  assert.deepEqual(result.inspection.sources.find(source => source.type === 'tool.registry')!.positions, [2])
  assert.deepEqual(result.inspection.sources.find(source => source.type === 'context.dynamic')!.positions, [4])
  const extended = [...events, { type: 'system.prompt', data: { content: 'Future' } },
    { type: 'context.dynamic', data: { turnId: 'future', content: 'Other query' } },
    { type: 'tool.registry', data: { schemas: [{ function: { name: 'other' } }] } }]
  assert.deepEqual(projectModelContext(extended, 'r2'), result)
})

test('S4 compression is a serialized history bundle, not a guessed per-role token breakdown', () => {
  const events = [
    { type: 'user.message', data: { turnId: 't', content: 'Hello' } },
    { type: 'llm.generated', data: { requestId: 'r1', generated: { content: 'Done', toolCalls: [] } } },
    { type: 'llm.invoke', data: { requestId: 'compress', request: { purpose: 'history.compress', turnId: 't' },
      manifest: { kind: 'compress', instruction: 'Summarize', tailThroughRequestId: 'r1' } } },
  ]
  const projection = projectModelContext(events, 'compress')!
  assert.equal(projection.tools.length, 0)
  assert.equal(projection.inspection.breakdown.find(row => row.key === 'history_bundle')!.chars, projection.messages[1]!.content!.length)
  assert.equal(projection.inspection.sources.some(source => source.type === 'tool.registry'), false)
})
