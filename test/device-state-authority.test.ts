import assert from 'node:assert/strict'
import test from 'node:test'
import { createCase1Agent } from '../src/cases/case1/case1.js'
import { createDeviceCase1ToolRuntime } from '../src/cases/case1/device-runtime.js'
import { llmPlugin } from '../src/agent/plugins/llm.js'

test('Device does not reconstruct current pending from historical tool metadata, select is native-authoritative', async () => {
  const calls: string[] = []
  const runtime = createDeviceCase1ToolRuntime({ async request(capability) {
    calls.push(capability)
    return capability === 'selection.consume' ? { ok: false, error: 'no_active_list' } : { ok: true, apps: [] }
  } })
  const agent = createCase1Agent({ dispatcher: runtime.dispatcher, approvalOwner: 'executor', includeToolState: runtime.includeToolState,
    contentSources: runtime.contentSources, llm: llmPlugin({ async generate() {
      return { generated: { content: 'done', toolCalls: [] }, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, contextWindow: 100000 } }
    } }) })
  agent.journal.append('tool.result', { turnId: 'old', results: [{ callId: 'old', content: '{"ok":true}',
    state: { key: 'pending.selection', value: { kind: 'contact' } } }] })
  await agent.submit('选择第1项')
  assert.ok(calls.includes('selection.consume'))
  const dynamic = agent.journal.read().filter(e => e.type === 'context.dynamic').at(-1)!.data as { activeState: unknown; content: string }
  assert.deepEqual(dynamic.activeState, {})
  assert.equal(dynamic.content.includes('当前有效工具状态'), false)
  assert.equal(agent.journal.read().some(e => e.type === 'device.action'), false)
})
