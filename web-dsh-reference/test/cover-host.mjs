/** Model-free S5 browser smoke: real Host routes, disposable in-memory Sessions.
 * Build root, start this script, then Vite with KNOT_WORKBENCH_URL=http://127.0.0.1:4321.
 * stdin: running | pause | idle | failed | exit. No credentials or persisted data.
 */
import { createInterface } from 'node:readline'
import { createWorkbenchServer } from '../../dist/src/workbench/http-server.js'

const sessions = ['s5-directory', 's5-blank', 's5-readonly'].map(id => {
  const events = [], listeners = new Set()
  const summary = { id, title: id, assembly: 'case2', workspace: '/tmp/knot-cover-smoke', runState: 'idle',
    writable: id !== 's5-readonly', eventCount: 0, providerProfileId: 'test-one', model: 'test-model', approvalMode: 'ask' }
  const append = (type, data) => {
    events.push({ position: events.length, type, data, observedAt: new Date(Date.UTC(2026, 9, 4, 0, 0, events.length)).toISOString() })
    summary.eventCount = events.length; summary.updatedAt = events.at(-1).observedAt
  }
  const turn = content => {
    const turnId = `query-${events.length}`, requestId = turnId + '-r'
    append('user.message', { turnId, content })
    append('llm.invoke', { requestId, request: { turnId, purpose: 'agent' }, manifest: { kind: 'agent' } })
    append('llm.generated', { requestId, request: { turnId, purpose: 'agent' }, generated: { content: 'Fixture response: ' + content, toolCalls: [] },
      usage: { inputTokens: 100, outputTokens: 10, cachedInputTokens: 90 } })
    append('assistant.message', { turnId, content: 'Fixture response: ' + content + '\n\n' + 'A recorded response, not an actual model call.\n\n'.repeat(3) })
  }
  if (id !== 's5-blank') {
    append('session.start', {})
    append('inference.configured', { providerProfileId: 'test-one', provider: 'deepseek', model: 'test-model' })
    append('approval.policy.configured', { mode: 'ask' })
    for (let n = 1; n <= 60; n++) turn(`Query ${n}: verify Session directory and native navigation.`)
    append('tool.result', { results: [{ state: { key: 'todo', value: [
      { id: 'a', content: 'Inspect the cover', status: 'completed' }, { id: 'b', content: 'Continue from the cover', status: 'in_progress' },
    ] } }, { state: { key: 'goal', value: { objective: 'Verify S5 without model calls', successCriteria: ['Locate a historical query'], status: 'active' } } }] })
  }
  const changed = event => { for (const listener of listeners) listener(event) }
  const changeState = runState => { summary.runState = runState; changed({ kind: 'state.changed', runState }) }
  return { id, summary: async () => summary, snapshot: async () => ({ session: summary, events }),
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    ...(summary.writable ? { submit: content => {
      changeState('running'); setTimeout(() => { turn(content); changed({ kind: 'journal.changed' }); changeState('idle') }, 100)
    }, pause: () => changeState('paused'), resume: () => changeState('idle') } : {}), changeState }
})
const server = createWorkbenchServer({ sessions, providerProfiles: [{ id: 'test-one', label: 'Controlled', model: 'test-model',
  adapter: 'deepseek', configured: true, reasoningEfforts: ['low', 'high'] }] })
server.listen(4321, '127.0.0.1', () => console.log('S5 controlled Host on 4321; no model or persistence'))
const stdin = createInterface({ input: process.stdin })
stdin.on('line', command => {
  if (['running', 'idle', 'failed'].includes(command)) sessions[0].changeState(command)
  if (command === 'pause') sessions[0].changeState('paused')
  if (command === 'exit') { stdin.close(); server.closeAllConnections(); server.close() }
})
