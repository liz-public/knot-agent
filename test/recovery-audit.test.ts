/** Characterization only: no recovery repair, invented results or effect replay. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPersistentCase2Agent } from '../src/cases/case2/case2.js'
import type { ChatMessage } from '../src/agent/protocol.js'

function validateToolPairs(messages: readonly ChatMessage[]) {
  const pending = new Set<string>()
  for (const message of messages) {
    if (message.role === 'tool') {
      if (!pending.delete(message.tool_call_id!)) throw new Error('unexpected tool result')
    } else {
      if (pending.size) throw new Error('missing tool results: ' + [...pending].join(','))
      for (const call of message.tool_calls ?? []) pending.add(call.id)
    }
  }
  if (pending.size) throw new Error('missing tool results: ' + [...pending].join(','))
}

for (const outcome of ['missing', 'partial', 'complete'] as const) test(`restore audit: ${outcome} tool-call batch`, async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'knot-recovery-audit-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const path = join(cwd, 's.jsonl')
  const calls = ['a', 'b'].map(id => ({ id, name: 'effect', arguments: {} }))
  const events = [
    { type: 'session.start', data: {} },
    { type: 'user.message', data: { turnId: 'old-turn', content: 'perform action' } },
    { type: 'llm.generated', data: { requestId: 'old-request', request: { purpose: 'agent', turnId: 'old-turn' }, generated: { toolCalls: calls }, usage: { contextWindow: 100000 } } },
    { type: 'tool.call', data: { turnId: 'old-turn', sourceRequestId: 'old-request', calls: calls.map(({ id, ...call }) => ({ ...call, callId: id })) } },
    ...(outcome === 'missing' ? [] : [{ type: 'tool.result', data: { turnId: 'old-turn', results: calls.slice(0, outcome === 'partial' ? 1 : 2).map(call => ({ callId: call.id, name: call.name, content: '{"ok":true}' })) } }]),
  ]
  const original = events.map(event => JSON.stringify(event)).join('\n') + '\n'
  await writeFile(path, original)
  let effects = 0, requests = 0
  const agent = await createPersistentCase2Agent({ cwd, journalPath: path,
    extraTools: [{ name: 'effect', schema: { type: 'function', function: { name: 'effect', parameters: { type: 'object', properties: {} } } },
      execute: () => { effects++; return { content: '{"ok":true}' } } }],
    llm: { async generate(call) {
      requests++; validateToolPairs(call.messages)
      return { generated: { content: 'continued', toolCalls: [] }, usage: { contextWindow: 100000 } }
    } },
  })
  t.after(() => agent.close())
  assert.equal(requests, 0); assert.equal(effects, 0)
  assert.equal(await readFile(path, 'utf8'), original)
  if (outcome === 'complete') await agent.submit('continue')
  else await assert.rejects(agent.submit('continue'), /missing tool results:.*b/)
  assert.equal(requests, 1); assert.equal(effects, 0)
})
