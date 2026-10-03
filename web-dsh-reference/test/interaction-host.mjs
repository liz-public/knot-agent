/** Isolated browser smoke fixture using Knot's real HTTP routes and interaction broker.
 * No model, tools, credentials or persisted Sessions. Build the root repository first.
 * Start this script, then run Vite with KNOT_WORKBENCH_URL=http://127.0.0.1:4320.
 * stdin: approvals | ask | free | goal | todo | complete | running | pause | status | exit
 */
import { createInterface } from 'node:readline'
import { createWorkbenchServer } from '../../dist/src/workbench/http-server.js'
import { createInteractionBroker } from '../../dist/src/workbench/interactions.js'

const brokers = new Map()
const sessions = ['b3-approvals', 'b3-questions', 's1-native'].map(id => {
  const listeners = new Set()
  const broker = createInteractionBroker(event => { for (const listener of listeners) listener(event) })
  brokers.set(id, broker)
  const summary = { id, title: id, assembly: 'case2', workspace: '/tmp/knot-b3-smoke',
    writable: true, runState: 'idle', eventCount: 2 }
  const events = [
    { position: 0, type: 'user.message', data: { turnId: id, content: 'Controlled B3 interaction test — no tools will execute.' } },
    { position: 1, type: 'assistant.message', data: { turnId: id, content: 'Use the pending interaction below.' } },
  ]
  const changeState = runState => {
    summary.runState = runState
    for (const listener of listeners) listener({ kind: 'state.changed', runState })
  }
  return { id, summary: async () => summary, snapshot: async () => ({ session: summary, events }),
    pause: () => changeState('paused'), resume: () => changeState('idle'), changeState,
    addState: (key, value) => {
      summary.updatedAt = new Date().toISOString()
      events.push({ position: events.length, type: 'tool.result',
        data: { results: [{ state: { key, value } }] }, observedAt: summary.updatedAt })
      summary.eventCount = events.length
      for (const listener of listeners) listener({ kind: 'journal.changed' })
    }, subscribe(listener) {
    listeners.add(listener)
    for (const interaction of broker.pending()) listener({ kind: 'interaction.request', interaction })
    return () => listeners.delete(listener)
  }, respond: broker.respond }
})
const server = createWorkbenchServer({ sessions })
server.listen(4320, '127.0.0.1', () => console.log('B3/S1 controlled Host on 4320; stdin: approvals | ask | free | goal | todo | complete | running | pause | status | exit'))
const stdin = createInterface({ input: process.stdin })
stdin.on('line', command => {
  const native = sessions.find(session => session.id === 's1-native')
  if (command === 'goal' || command === 'complete') native.addState('goal', {
    objective: 'Verify the native read-only Goal', successCriteria: ['No Goal mutation RPC'],
    status: command === 'goal' ? 'active' : 'completed',
  })
  if (command === 'todo') native.addState('todo', [
    { id: '1', content: 'Verify native Todo expansion', status: 'completed' },
    { id: '2', content: 'Preserve the input draft through Pause and Resume', status: 'in_progress' },
  ])
  if (command === 'running') native.changeState('running')
  if (command === 'pause') native.pause()
  if (command === 'approvals') for (const toolName of ['bash', 'write']) {
    void brokers.get('b3-approvals').approval.request({ toolName, arguments: toolName === 'bash'
      ? { command: 'printf "controlled smoke only"' } : { path: '/tmp/not-written.txt', content: 'NOT executed' },
    }).then(value => console.log(JSON.stringify({ toolName, value })))
  }
  if (command === 'ask' || command === 'free') void brokers.get('b3-questions').ask.ask({
    question: command === 'ask' ? 'Choose a smoke result or enter your own answer.' : 'Enter a free-text smoke answer.',
    ...(command === 'ask' ? { choices: ['Continue', 'Stop'] } : {}),
  }).then(value => console.log(JSON.stringify(value)))
  if (command === 'status') console.log(JSON.stringify([...brokers].map(([id, broker]) => ({ id, pending: broker.pending() }))))
  if (command === 'exit') { stdin.close(); server.closeAllConnections(); server.close() }
})
