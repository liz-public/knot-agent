import assert from 'node:assert/strict'
import test from 'node:test'
import { projectContextTimeline, projectModelContext } from '../src/workbench/context-projection.js'
import { createWorkbenchServer } from '../src/workbench/http-server.js'
import type { ReadEvent } from '../src/workbench/read-journal.js'

const invoke = (requestId: string, turnId = 't') => ({ requestId, request: { turnId, purpose: 'agent' }, manifest: { kind: 'agent', dynamicTurnId: turnId } })
const history: ReadEvent[] = [
  { type: 'system.prompt', data: { content: 'System' } },
  { type: 'tool.registry', data: { schemas: [{ function: { name: 'read', parameters: {} } }] } },
  { type: 'user.message', data: { turnId: 't', content: 'Read a file' } },
  { type: 'llm.invoke', data: invoke('r1') },
  { type: 'llm.generated', data: { requestId: 'r1', request: { turnId: 't', purpose: 'agent' }, generated: {
    reasoning: 'Plan', content: 'Reading', toolCalls: [{ id: 'c', name: 'read', arguments: { path: 'a' } }] } } },
  { type: 'tool.call', data: { turnId: 't', sourceRequestId: 'r1', calls: [{ callId: 'c', name: 'read', arguments: { path: 'a' } }] } },
  { type: 'tool.result', data: { results: [{ callId: 'c', content: 'File contents' }] } },
  { type: 'llm.invoke', data: invoke('r2') },
  { type: 'llm.invoke', data: { requestId: 'compact', request: { purpose: 'history.compress', turnId: 't' },
    manifest: { kind: 'compress', instruction: 'Summarize', tailThroughRequestId: 'r1' } } },
].map((event, position) => ({ ...event, position }))

test('context timeline uses exact inspection accounting at each bounded invoke without messages or new facts', () => {
  const before = JSON.stringify(history), points = projectContextTimeline(history)
  assert.deepEqual(points.map(point => point.requestId), ['r1', 'r2', 'compact'])
  for (const point of points) {
    const detail = projectModelContext(history, point.requestId)!
    assert.equal(point.totalChars, detail.inspection.totalChars)
    assert.deepEqual(point.breakdown, detail.inspection.breakdown)
    assert.ok(Math.abs(point.breakdown!.reduce((total, row) => total + row.share, 0) - 1) < 1e-12)
    assert.equal('messages' in point, false); assert.equal('tools' in point, false)
  }
  assert.equal(points[0]!.breakdown!.some(row => row.key === 'tool_results'), false)
  assert.ok(points[1]!.breakdown!.some(row => row.key === 'tool_results'))
  assert.ok(points[2]!.breakdown!.some(row => row.key === 'history_bundle'))
  assert.equal(JSON.stringify(history), before)
  assert.deepEqual(projectContextTimeline([...history, { position: 9, type: 'user.message', data: { turnId: 'later', content: 'Future' } }]), points)
  assert.deepEqual(projectContextTimeline([]), [])
  const broken = projectContextTimeline([...history, { position: 9, type: 'llm.invoke', data: {
    ...invoke('broken'), manifest: { kind: 'agent', dynamicTurnId: 't', tailAfterRequestId: 'missing' } } }]).at(-1)!
  assert.ok(broken.error); assert.equal(broken.breakdown, undefined); assert.equal(broken.totalChars, undefined)
})

test('read-only context timeline HTTP endpoint exposes compact historical analytics', async () => {
  const session = { id: 'test', title: 'Test', assembly: 'case2', eventCount: history.length, runState: 'idle' as const, writable: false }
  const server = createWorkbenchServer({ sessions: [{ id: 'test', summary: async () => session, snapshot: async () => ({ session, events: history }) }] })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address() as { port: number }
    const base = `http://127.0.0.1:${address.port}/api/workbench/sessions`
    const response = await fetch(base + '/test/analytics/context')
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), projectContextTimeline(history))
    assert.equal((await fetch(base + '/missing/analytics/context')).status, 404)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
