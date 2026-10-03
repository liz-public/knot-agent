import assert from 'node:assert/strict'
import { test } from 'node:test'
import { projectKnotSnapshot } from '../src/knot-journal-projection.ts'
import type { SessionSnapshotDto } from '../../src/workbench/session.js'

function snapshot(entries: [string, unknown][]): SessionSnapshotDto {
  return {
    session: { id: 'test', title: 'Test', assembly: 'case2', eventCount: entries.length,
      runState: 'idle', writable: true, workspace: '/test' },
    events: entries.map(([type, data], position) => ({ type, data, position,
      observedAt: new Date(1700000000000 + position * 100).toISOString() })),
  }
}
const request = (turnId = 't1') => ({ purpose: 'agent', turnId })

test('steering preserves both parallel results, content and reasoning', () => {
  const result = projectKnotSnapshot(snapshot([
    ['user.message', { turnId: 't1', content: 'Start' }],
    ['llm.invoke', { requestId: 'r1', request: request() }],
    ['llm.generated', { requestId: 'r1', request: request(), generated: {
      reasoning: 'Thinking', content: 'I will read both files.',
      toolCalls: [{ id: 'a', name: 'read', arguments: { path: 'a' } }, { id: 'b', name: 'read', arguments: { path: 'b' } }],
    } }],
    ['tool.call', { sourceRequestId: 'r1', turnId: 't1', calls: [
      { callId: 'a', name: 'read', arguments: { path: 'a' } }, { callId: 'b', name: 'read', arguments: { path: 'b' } },
    ] }],
    ['user.message', { turnId: 'steer', content: 'Also check tests.' }],
    ['tool.result', { results: [{ callId: 'a', content: 'A' }, { callId: 'b', content: 'B' }] }],
    ['llm.invoke', { requestId: 'r2', request: request('steer') }],
    ['llm.generated', { requestId: 'r2', request: request('steer'), generated: { content: 'Done' } }],
    ['assistant.message', { turnId: 'steer', content: 'Done' }],
  ]))
  const events = result.records.map(record => record.event)
  assert.equal(events.filter(event => event.type === 'tool/result').length, 2)
  const assistant = events.find(event => event.type === 'assistant/message')!.data as any
  assert.deepEqual(assistant.message.content.map((block: any) => block.type), ['reasoning', 'text', 'tool-call', 'tool-call'])
  assert.equal(events.filter(event => event.type === 'turn/start').length, 1)
  assert.equal(events.filter(event => event.type === 'turn/end').length, 1)
  assert.deepEqual(result.projections.values.sessionStats, {
    turns: 1, steps: 2, llmMs: 200, toolMs: 400, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0,
  })
  assert.equal(result.projections.values.knotEventCount, 9)
})

test('model source belongs to the invoke boundary; absent cache usage is not zero', () => {
  const result = projectKnotSnapshot(snapshot([
    ['inference.configured', { providerProfileId: 'first', model: 'model-a' }],
    ['user.message', { turnId: 't1', content: 'Hi' }],
    ['llm.invoke', { requestId: 'r1', request: request() }],
    ['inference.configured', { providerProfileId: 'next', model: 'model-b' }],
    ['llm.generated', { requestId: 'r1', request: request(), generated: { content: 'Hi' },
      usage: { inputTokens: 100, outputTokens: 20, contextWindow: 1000 } }],
    ['assistant.message', { turnId: 't1', content: 'Hi' }],
  ]))
  const answer = result.records.find(record => record.event.type === 'assistant/message')!.event.data as any
  assert.equal(answer.message.source.provider, 'first')
  assert.equal(answer.message.source.model, 'model-a')
  assert.equal(result.projections.values.tokenUsage, undefined)
  assert.deepEqual(result.projections.values.contextPressure, { pressureTokens: 100, contextWindow: 1000 })
})

test('known cache usage aggregates without inventing stream timings', () => {
  const result = projectKnotSnapshot(snapshot([
    ['user.message', { turnId: 't1', content: 'Hi' }],
    ['llm.invoke', { requestId: 'r1', request: request() }],
    ['llm.generated', { requestId: 'r1', request: request(), generated: { content: 'Hi' },
      usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 90 } }],
  ]))
  assert.deepEqual(result.projections.values.tokenUsage, {
    uncachedInputTokens: 10, outputTokens: 20, cacheReadTokens: 90, cacheWriteTokens: 0,
  })
  assert.equal(result.records.some(record => record.event.type === 'turn/end'), false)
})

test('shortcut-only turns and structured tool failures remain visible', () => {
  const result = projectKnotSnapshot(snapshot([
    ['user.message', { turnId: 't1', content: 'Flash on' }],
    ['tool.call', { turnId: 't1', calls: [{ callId: 'a', name: 'bash', arguments: { command: 'flash on' } }] }],
    ['tool.result', { results: [{ callId: 'a', content: '{"ok":false,"error":"unsupported"}' }] }],
    ['assistant.message', { turnId: 't1', content: 'Not supported.' }],
  ]))
  const tool = result.records.find(record => record.event.type === 'tool/result')!.event.data as any
  assert.equal(tool.message.isError, true)
  assert.equal(result.records.filter(record => record.event.type === 'assistant/message').length, 1)
  assert.equal(result.records.at(-1)!.event.type, 'turn/end')
})

test('S1 text shortcuts count completed rounds without inventing LLM steps or usage', () => {
  const result = projectKnotSnapshot(snapshot([
    ['user.message', { turnId: 't1', content: 'Hi' }],
    ['assistant.message', { turnId: 't1', content: 'Hello' }],
    ['user.message', { turnId: 't2', content: 'Hi again' }],
    ['assistant.message', { turnId: 't2', content: 'Hello again' }],
    ['user.message', { turnId: 't3', content: 'Still pending' }],
  ]))
  assert.equal((result.projections.values.sessionStats as any).turns, 2)
  assert.equal((result.projections.values.sessionStats as any).steps, 0)
  assert.equal(result.projections.values.tokenUsage, undefined)
  assert.equal(result.records.filter(record => record.event.type === 'turn/end').length, 2)
  assert.equal(result.projections.values.knotRunState, 'idle')
})
