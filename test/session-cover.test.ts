import assert from 'node:assert/strict'
import test from 'node:test'
import { projectSessionCover } from '../src/workbench/session-cover.js'
import { projectSessionFacts } from '../src/workbench/session-facts.js'
import type { SessionSnapshotDto } from '../src/workbench/session.js'

const session: SessionSnapshotDto['session'] = { id: 's', title: 'Cover', assembly: 'case2', runState: 'idle',
  eventCount: 0, writable: true, model: 'pending-model', approvalMode: 'auto' }

test('cover counts completed compactions, not compression requests or model responses', () => {
  const events = [
    { type: 'history.compress.request', data: {} },
    { type: 'llm.generated', data: { request: { purpose: 'history.compress' } } },
    { type: 'history.checkpoint', data: {} },
    { type: 'history.compress.request', data: {} },
    { type: 'history.checkpoint', data: {} },
    { type: 'history.compress.request', data: {} },
  ].map((event, position) => ({ ...event, position }))
  assert.equal(projectSessionCover({ session, events }).compactionCount, 2)
  assert.equal(projectSessionCover({ session, events: [] }).compactionCount, 0)
})

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

test('cover groups generation Tokens by the configuration at invocation, with weighted rates and unknown history', () => {
  const config = (model: string, reasoningEffort: string) => ({ type: 'inference.configured',
    data: { model, reasoningEffort, provider: 'deepseek', providerProfileId: 'p' } })
  const invoke = (requestId: string) => ({ type: 'llm.invoke', data: { requestId } })
  const generated = (requestId: string, outputTokens?: number, durationMs?: number) => ({ type: 'llm.generated',
    data: { requestId, request: { purpose: 'agent' }, usage: { outputTokens }, timing: { durationMs } } })
  const events = [invoke('old'), generated('old', 10, 500), config('m', 'low'), invoke('a'),
    config('m', 'high'), generated('a', 20, 1000), invoke('b'), generated('b', 60, 3000),
    invoke('unknown-usage'), generated('unknown-usage'), config('m', 'low'), invoke('c'), generated('c', 10, 1000),
  ].map((event, position) => ({ ...event, position }))
  const input = { session, events }, before = JSON.stringify(input)
  const result = projectSessionCover(input)
  assert.equal(JSON.stringify(input), before)
  assert.deepEqual(result.modelUsage.map(row => [row.model, row.reasoningEffort, row.outputTokens, row.outputShare, row.outputRate]),
    [['m', 'high', 60, .6, 20], ['m', 'low', 30, .3, 15], [undefined, undefined, 10, .1, 20]])
  assert.equal(result.modelUsage[0]!.calls, 2); assert.equal(result.modelUsage[0]!.outputKnownCalls, 1)
  assert.equal(result.runDurationMs, undefined)
  const zero = projectSessionCover({ session, events: [invoke('zero'), generated('zero', 0, 1000)]
    .map((event, position) => ({ ...event, position })) }).modelUsage[0]!
  assert.equal(zero.outputKnownCalls, 1); assert.equal(zero.outputTokens, 0); assert.equal(zero.outputRate, 0)
  assert.equal(zero.outputShare, undefined) // A zero denominator is not 0% known composition.
  const sameModel = projectSessionCover({ session, events: [config('m', 'low'), invoke('a'), generated('a', 20, 1000),
    { type: 'inference.configured', data: { ...config('m', 'low').data, providerProfileId: 'other-profile' } }, invoke('b'), generated('b', 10, 1000)]
    .map((event, position) => ({ ...event, position })) }).modelUsage
  assert.equal(sameModel.length, 1); assert.equal(sameModel[0]!.outputTokens, 30)
})

test('cover running time excludes gaps between queries, merges steering, and uses recorded endpoints only', () => {
  const events = [
    { type: 'user.message', data: { content: 'Start' }, observedAt: '2026-10-04T00:00:00Z' },
    { type: 'user.message', data: { content: 'Steer' }, observedAt: '2026-10-04T00:00:02Z' },
    { type: 'assistant.message', data: { content: 'Done' }, observedAt: '2026-10-04T00:00:04Z' },
    { type: 'user.message', data: { content: 'Next' }, observedAt: '2026-10-04T00:00:20Z' },
    { type: 'llm.invoke', data: { requestId: 'r' }, observedAt: '2026-10-04T00:00:20Z' },
    { type: 'llm.generated', data: { requestId: 'r', usage: { outputTokens: 20 } }, observedAt: '2026-10-04T00:00:22Z' },
    { type: 'assistant.message', data: { content: 'Done again' }, observedAt: '2026-10-04T00:00:22Z' },
  ].map((event, position) => ({ ...event, position }))
  const result = projectSessionCover({ session, events })
  assert.equal(result.runDurationMs, 6000); assert.equal(result.runDurationPartial, false)
  assert.equal(result.modelUsage[0]!.outputRate, 10) // Old logs can use invoke/generated timestamps.
  const inFlight = projectSessionCover({ session, events: events.slice(0, -1) })
  assert.equal(inFlight.runDurationMs, 6000); assert.equal(inFlight.runDurationPartial, true)
  const noTime = projectSessionCover({ session, events: events.map(({ observedAt, ...event }) => event) })
  assert.equal(noTime.runDurationMs, undefined); assert.equal(noTime.runDurationPartial, true)
  assert.equal(noTime.modelUsage[0]!.outputRate, undefined)
})
