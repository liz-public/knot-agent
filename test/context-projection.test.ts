import assert from 'node:assert/strict'
import test from 'node:test'
import { projectModelContext } from '../src/workbench/context-projection.js'
import { createWorkbenchServer } from '../src/workbench/http-server.js'
import type { WorkbenchSession } from '../src/workbench/session.js'

test('model context projection rebuilds one invocation without storing a materialized copy', () => {
  const events = [
    { type: 'system.prompt', data: { content: 'Be concise.' } },
    { type: 'tool.registry', data: { schemas: [{ type: 'function', function: { name: 'read' } }] } },
    { type: 'user.message', data: { turnId: 'turn-1', content: 'Inspect this.' } },
    { type: 'context.dynamic', data: { turnId: 'turn-1', content: 'cwd: /tmp', matchedPackages: [], matchedCommands: [], activeState: {} } },
    { type: 'llm.invoke', data: { requestId: 'request-1', request: { purpose: 'agent', turnId: 'turn-1' }, manifest: { kind: 'agent', dynamicTurnId: 'turn-1' } } },
    { type: 'llm.generated', data: { requestId: 'request-1', request: { purpose: 'agent', turnId: 'turn-1' }, generated: { content: 'Done', toolCalls: [] }, usage: { inputTokens: 42, outputTokens: 2, totalTokens: 44, contextWindow: 1_000 } } },
  ]

  const projection = projectModelContext(events, 'request-1')

  assert.equal(projection?.requestId, 'request-1')
  assert.deepEqual(projection?.messages.map(message => [message.role, message.content]), [
    ['system', 'Be concise.'],
    ['user', 'Inspect this.'],
    ['user', '以下是仅对当前用户请求有效的运行时上下文：\ncwd: /tmp'],
  ])
  assert.equal(projection?.tools.length, 1)
  assert.equal(projection?.usage?.inputTokens, 42)
  assert.ok((projection?.estimatedMessageTokens ?? 0) > 0)
})

test('workbench exposes a selected model-input projection without adding Journal facts', async t => {
  const events = [
    { position: 0, type: 'system.prompt', data: { content: 'Be concise.' } },
    { position: 1, type: 'user.message', data: { turnId: 'turn-1', content: 'Hello.' } },
    { position: 2, type: 'llm.invoke', data: { requestId: 'request-1', request: { purpose: 'agent', turnId: 'turn-1' }, manifest: { kind: 'agent', dynamicTurnId: 'turn-1' } } },
  ]
  const session: WorkbenchSession = {
    id: 'session-1',
    summary: async () => ({ id: 'session-1', title: 'Context run', assembly: 'case2', runState: 'completed', eventCount: events.length, writable: false }),
    snapshot: async () => ({ session: await session.summary(), events }),
  }
  const server = createWorkbenchServer({ sessions: [session] })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(() => new Promise<void>((resolve, reject) => { server.close(error => error === undefined ? resolve() : reject(error)) }))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected TCP address')

  const response = await fetch(`http://127.0.0.1:${address.port}/api/workbench/sessions/session-1/context?requestId=request-1`)
  assert.equal(response.status, 200)
  const projection = await response.json() as { requestId: string; messages: unknown[] }
  assert.equal(projection.requestId, 'request-1')
  assert.equal(projection.messages.length, 2)
  assert.equal((await session.snapshot()).events.length, 3)
})
