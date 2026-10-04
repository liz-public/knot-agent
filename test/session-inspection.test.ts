import assert from 'node:assert/strict'
import test from 'node:test'
import { projectToolAnalytics } from '../src/workbench/tool-analytics.js'
import { projectModelContext } from '../src/workbench/context-projection.js'
import type { ReadEvent } from '../src/workbench/read-journal.js'
import { projectPluginAnalytics } from '../src/workbench/plugin-analytics.js'
import type { StudioAssemblyDto } from '../src/workbench/studio.js'

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
  assert.deepEqual(result.tools[0], { name: 'bash', registered: false, available: false, callShare: 2 / 5, successRate: .5,
    calls: 2, returned: 2, succeeded: 1, failed: 1, unknown: 0,
    unfinished: 0, timedBatches: 1, totalBatchWaitMs: 2000 })
  assert.equal(result.tools[1]?.unknown, 1); assert.equal(result.tools[1]?.failed, 1)
  assert.equal(result.tools[1]?.timedBatches, 1) // Missing timestamps are unknown, not zero.
  assert.equal(result.tools[2]?.unfinished, 1); assert.equal(result.tools[2]?.failed, 0)
  assert.deepEqual(projectToolAnalytics([]).tools, [])
})

test('tool roster keeps zero-call and removed registrations, descriptions and unregistered calls without Assembly guesses', () => {
  const registry = (names: string[]) => ({ type: 'tool.registry', data: { schemas: names.map(name => ({ function: { name, description: `${name} capability` } })) } })
  const events = [registry(['read', 'ask']),
    { type: 'tool.call', data: { calls: [{ callId: 'c', name: 'read' }, { callId: 'd', name: 'external' }] } },
    { type: 'tool.result', data: { results: [{ callId: 'c', content: '{"ok":true}' }, { callId: 'd', content: 'Unknown' }] } },
    registry(['read', 'edit']),
  ].map((event, position) => ({ ...event, position }))
  const result = projectToolAnalytics(events)
  assert.equal(result.totalCalls, 2); assert.equal(result.registeredTools, 3); assert.equal(result.usedRegisteredTools, 1)
  const ask = result.tools.find(row => row.name === 'ask')!
  assert.equal(ask.calls, 0); assert.equal(ask.description, 'ask capability'); assert.equal(ask.registered, true)
  assert.equal(ask.available, false); assert.equal(ask.callShare, 0); assert.equal(ask.successRate, undefined)
  assert.equal(result.tools.find(row => row.name === 'read')!.successRate, 1)
  assert.equal(result.tools.find(row => row.name === 'external')!.registered, false)
  assert.equal(result.tools.find(row => row.name === 'external')!.successRate, undefined)
  assert.equal(result.tools.reduce((n, row) => n + (row.callShare ?? 0), 0), 1)
  const empty = projectToolAnalytics([registry(['ask'])].map((event, position) => ({ ...event, position })))
  assert.equal(empty.tools[0]!.callShare, undefined); assert.equal(empty.tools[0]!.successRate, undefined)
})

test('plugin subscription analytics matches only inputs, deduplicates overlapping wildcard and never attributes outputs', () => {
  const plugin = (id: string, listens: string[], emits: string[]) => ({ id, name: id, category: 'flow' as const,
    responsibility: 'test', source: 'test.ts', listens, emits })
  const assembly: StudioAssemblyDto = { id: 'test', title: 'Test', systemPrompt: '', tools: [], protocols: ['user.message', 'unused'], plugins: [
    plugin('flow', ['user.message', 'user.message'], ['assistant.message']), plugin('all', ['*', 'user.message'], []), plugin('none', [], ['user.message'])] }
  const events = [{ type: 'user.message', data: {} }, { type: 'assistant.message', data: {} }, { type: 'user.message', data: {} }]
  const result = projectPluginAnalytics(events, assembly)
  assert.deepEqual(result.plugins.map(plugin => plugin.matchedEvents), [2, 3, 0])
  assert.deepEqual(result.plugins[0]!.subscriptions, [{ type: 'user.message', count: 2 }])
  assert.deepEqual(result.protocols.find(row => row.type === 'assistant.message')!.subscribers, ['all'])
  assert.equal(result.protocols.find(row => row.type === 'unused')!.events, 0)
  assert.deepEqual(projectPluginAnalytics(events).plugins, [])
  assert.equal(projectPluginAnalytics(events).assembly, undefined)
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
