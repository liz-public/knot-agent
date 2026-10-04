import assert from 'node:assert/strict'
import test from 'node:test'
import { projectSessionCover } from '../src/workbench/session-cover.js'
import { projectSessionFacts } from '../src/workbench/session-facts.js'
import type { SessionSnapshotDto } from '../src/workbench/session.js'

const session: SessionSnapshotDto['session'] = { id: 's', title: 'Cover', assembly: 'case2', runState: 'idle',
  eventCount: 0, writable: true, model: 'pending-model', approvalMode: 'auto' }

test('cover is a read-only directory: separates pending configuration, keeps steering and original text, never synthesizes dates', () => {
  const events = [
    { type: 'session.start', data: {}, observedAt: 'not-a-time' },
    { type: 'inference.configured', data: { model: 'recorded-model', provider: 'deepseek', providerProfileId: 'p' } },
    { type: 'approval.policy.configured', data: { mode: 'ask' } },
    { type: 'user.message', data: { turnId: 'a', content: 'Original\nquery' }, observedAt: '2026-10-04T00:00:00Z' },
    { type: 'user.message', data: { turnId: 'b', content: 'Steer' } },
    { type: 'assistant.message', data: { turnId: 'b', content: 'Reply, not a summary' } },
    { type: 'tool.call', data: { calls: [{ callId: 'c', name: 'read' }] }, observedAt: '2026-10-04T00:00:02Z' },
  ].map((event, position) => ({ ...event, position }))
  const input = { session, events }, before = JSON.stringify(input)
  const result = projectSessionCover(input)
  assert.equal(JSON.stringify(input), before)
  assert.equal(result.session.model, 'pending-model'); assert.equal(result.session.approvalMode, 'auto')
  assert.equal(result.recordedConfiguration.inference?.model, 'recorded-model'); assert.equal(result.recordedConfiguration.approvalMode, 'ask')
  assert.deepEqual(result.queries.map(row => row.content), ['Original\nquery', 'Steer'])
  assert.equal(result.queries[1]!.observedAt, undefined)
  assert.equal(result.firstObservedAt, '2026-10-04T00:00:00Z'); assert.equal(result.lastObservedAt, '2026-10-04T00:00:02Z')
  assert.equal(result.latestReply?.content, 'Reply, not a summary')
  assert.equal(result.eventCount, 7); assert.equal(result.toolCalls, 1); assert.equal(result.unfinishedToolCalls, 1)
  assert.equal(result.session.runState, 'idle') // An unfinished call is not a failed Session.
  const empty = projectSessionCover({ session, events: [] })
  assert.deepEqual(empty.queries, []); assert.equal(empty.firstObservedAt, undefined); assert.equal(empty.latestReply, undefined)
  assert.equal(empty.usage.knownCalls, 0); assert.deepEqual(empty.recordedConfiguration, {})
})

test('cover shares exact counters and Todo/Goal folding with the native dock; unknown usage is not zero', () => {
  const events = [
    { type: 'llm.invoke', data: { requestId: 'r' }, observedAt: '2026-10-04T00:00:00Z' },
    { type: 'llm.generated', data: { requestId: 'r', request: { purpose: 'agent' }, usage: { inputTokens: 200, outputTokens: 20, cachedInputTokens: 180 } }, observedAt: '2026-10-04T00:00:02Z' },
    { type: 'llm.generated', data: { request: { purpose: 'history.compress' }, usage: { inputTokens: 100, outputTokens: 10 } } },
    { type: 'llm.generated', data: { request: { purpose: 'agent' } } },
    { type: 'tool.result', data: { results: [{ state: { key: 'todo', value: [{ id: '1', content: 'Check', status: 'completed' }] } },
      { state: { key: 'goal', value: { objective: 'Verify', successCriteria: ['Pass'], status: 'active' } } }] } },
  ].map((event, position) => ({ ...event, position }))
  const cover = projectSessionCover({ session, events }), facts = projectSessionFacts(events)
  assert.deepEqual(cover.usage, facts.usage); assert.deepEqual(cover.todos, facts.todos); assert.deepEqual(cover.goal, facts.goal)
  assert.equal(cover.usage.totalTokens, 330); assert.equal(cover.usage.knownCalls, 2); assert.equal(cover.usage.calls, 3)
  assert.equal(cover.usage.knownCacheHitRate, .9); assert.equal(cover.usage.cacheKnownCalls, 1)
  assert.deepEqual(cover.usage.latest, {})
  for (const runState of ['paused', 'running', 'failed', 'completed'] as const) {
    assert.equal(projectSessionCover({ session: { ...session, runState, writable: false }, events }).session.runState, runState)
  }
})
