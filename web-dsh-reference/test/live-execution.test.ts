import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GenerationProjection } from '../src/generation-projection.ts'
import { createWorkbenchRemote } from '../src/workbench-remote.ts'

test('B4 three channels keep dense chunk indices, fragmented names and one final settlement', () => {
  const stream = new GenerationProjection()
  const frames: any[] = [stream.start('r', { turn: 0, step: 0 }, 2)]
  for (const update of [
    { kind: 'reasoning', text: 'Think' }, { kind: 'content', text: 'I will inspect' },
    { kind: 'tool_call', index: 0, id: 'call-', name: 'ba', argumentsDelta: '{"command":' },
    { kind: 'tool_call', index: 0, id: '1', name: 'sh', argumentsDelta: '"pwd"}' },
  ]) frames.push(...stream.update('r', update, 123))
  frames.push(stream.end(3))
  assert.deepEqual(frames.map(value => value.frame.revision), frames.map((_, i) => i + 1))
  const chunks = frames.filter(value => value.frame.type === 'chunk').map(value => value.frame)
  assert.deepEqual(chunks.map(value => value.index), chunks.map((_, i) => i))
  assert.deepEqual(chunks.filter(value => value.chunk.type === 'block-start').map(value => value.chunk.blockType), ['reasoning', 'text', 'tool-call'])
  assert.equal(chunks.at(-1).chunk.name, 'bash')
  assert.equal(chunks.at(-1).chunk.id, 'call-1')
  assert.deepEqual(frames.at(-1).frame.outcome, { kind: 'committed', eventType: 'assistant/message', seq: 3 })
  assert.deepEqual(stream.update('r', { kind: 'content', text: 'late' }, 123), [])
  assert.equal(stream.end(), undefined)
})

test('B4 carrier sends, steers, settles, pauses/resumes and forwards errors without crossing Sessions', async () => {
  const listeners = new Map<string, (event: any) => void>()
  const sessions: any[] = ['one', 'two'].map(id => ({ id, title: id, assembly: 'case2', writable: true, runState: 'idle', eventCount: 0 }))
  const events: any[] = []
  const writes: any[] = []
  const remote = createWorkbenchRemote((async (url: string, options?: RequestInit) => {
    const id = new URL(url, 'http://test').pathname.split('/')[4]
    if (options?.method) { writes.push({ url, body: options.body ? JSON.parse(options.body as string) : undefined }); return Response.json({ accepted: true }) }
    return Response.json(url.endsWith('/sessions') ? { sessions } : { session: sessions.find(value => value.id === id), events: id === 'one' ? events : [] })
  }) as typeof fetch, (id, listener) => { listeners.set(id, listener); return () => { listeners.delete(id) } })
  const abort = new AbortController()
  const frames: any[] = [], second: any[] = [], statuses: any[] = [], tools: any[] = []
  const pump = async (endpoint: string, input: any, target: any[]) => {
    for await (const frame of remote.open('$test', endpoint, { args: [input] }, abort.signal)) target.push(frame)
  }
  const pumps = [pump('$events', {}, statuses), pump('session/follow', { address: { kind: 'session', sessionId: 'one' }, assistantStream: true }, frames),
    pump('session/follow', { address: { kind: 'session', sessionId: 'two' }, assistantStream: true }, second), pump('knot/live', { sessionId: 'one' }, tools)]
  const tick = () => new Promise(resolve => setImmediate(resolve))
  await tick()
  const call = (endpoint: string, input: any) => remote.call('$test', endpoint, { args: [input] }) as Promise<any>
  assert.equal((await call('session/prompt', { sessionId: 'one', requestId: 'rpc1', mode: 'queue', content: [{ type: 'text', text: 'Hello' }] })).ok, true)
  assert.deepEqual(writes.at(-1).body, { content: 'Hello' })
  events.push({ position: 0, type: 'user.message', data: { turnId: 't', content: 'Hello' } },
    { position: 1, type: 'llm.invoke', data: { requestId: 'r', request: { turnId: 't', purpose: 'agent' } } })
  listeners.get('one')!({ kind: 'generation.open', purpose: 'agent', turnId: 't', requestId: 'r' })
  await tick()
  assert.equal(frames.find(value => value.event?.type === 'user/message').event.data.source.rpcId, 'rpc1')
  for (const kind of ['reasoning', 'content']) listeners.get('one')!({ kind: 'generation.update', requestId: 'r', update: { kind, text: kind } })
  listeners.get('one')!({ kind: 'generation.update', requestId: 'r', update: { kind: 'tool_call', index: 0, id: 'c', name: 'bash', argumentsDelta: '{}' } })
  await tick()
  assert.equal(frames.filter(value => value.type === 'assistant-stream').length, 7)
  events.push({ position: 2, type: 'llm.generated', observedAt: '2026-10-03T10:00:00Z', data: { requestId: 'r', request: { turnId: 't', purpose: 'agent' }, generated: {
    content: 'content', reasoning: 'reasoning', toolCalls: [{ id: 'c', name: 'bash', arguments: {} }],
  }, usage: { inputTokens: 100, outputTokens: 10, cachedInputTokens: 90 } } })
  listeners.get('one')!({ kind: 'journal.changed' })
  await tick()
  const assistant = frames.findIndex(value => value.event?.type === 'assistant/message')
  assert.equal(statuses.find(value => value.event === 'api-session/activity').args[1], Date.parse('2026-10-03T10:00:00Z'))
  assert.equal(frames[assistant + 1].frame.type, 'end')
  assert.equal(frames[assistant + 1].frame.outcome.seq, frames[assistant].event.seq)
  listeners.get('one')!({ kind: 'journal.changed' }); await tick()
  assert.equal(frames.filter(value => value.event?.type === 'assistant/message').length, 1)
  assert.equal(second.length, 1) // No other Session's events are delivered.
  sessions[0].runState = 'running'
  assert.equal((await call('session/prompt', { sessionId: 'one', mode: 'queue', content: [{ type: 'text', text: 'Follow up' }] })).ok, false)
  assert.equal((await call('session/prompt', { sessionId: 'one', mode: 'steer', content: [{ type: 'text', text: 'Change' }] })).ok, true)
  assert.equal((await call('session/prompt', { sessionId: 'one', content: [{ type: 'image' }] })).ok, false)
  for (const endpoint of ['session/cancel', 'knot/session/resume']) assert.equal((await call(endpoint, { sessionId: 'one' })).ok, true)
  assert.deepEqual(writes.slice(-2).map(value => value.url), ['/api/workbench/sessions/one/pause', '/api/workbench/sessions/one/resume'])
  listeners.get('one')!({ kind: 'tool.open', callId: 'c', command: 'pwd', toolName: 'bash', turnId: 't' })
  listeners.get('one')!({ kind: 'tool.update', callId: 'c', update: { stream: 'stdout', text: '/tmp' } })
  listeners.get('one')!({ kind: 'state.changed', runState: 'paused' })
  listeners.get('one')!({ kind: 'run.error', message: 'Controlled failure' })
  await tick()
  assert.equal(tools.find(value => value.kind === 'tool.update').update.text, '/tmp')
  assert.equal(statuses.find(value => value.event === 'api-session/error').args[1], 'Controlled failure')
  abort.abort(); await Promise.all(pumps)
  assert.equal(listeners.size, 0)
})

test('S1 paused posture survives reconnect and transient changes do not fabricate Journal sequence numbers', async () => {
  let emit: (event: any) => void = () => {}
  let session = { id: 's', title: 's', writable: true, runState: 'paused', eventCount: 1 }
  const events = [{ position: 0, type: 'user.message', data: { turnId: 't', content: 'Start' }, observedAt: '2026-10-03T01:00:00Z' }]
  const remote = createWorkbenchRemote((async (url: string) => Response.json(url.endsWith('/sessions') ? { sessions: [session] } : { session, events })) as typeof fetch,
    (_id, listener) => { emit = listener; return () => {} })
  const abort = new AbortController(), frames: any[] = [], controls: any[] = [], activity: any[] = [], live: any[] = []
  const pump = async (endpoint: string, args: unknown, target: any[]) => {
    for await (const value of remote.open('$test', endpoint, { args: [args] }, abort.signal)) target.push(value)
  }
  const pumps = [pump('session/follow', { address: { kind: 'session', sessionId: 's' } }, frames),
    pump('session/control', {}, controls), pump('$events', {}, activity), pump('knot/live', { sessionId: 's' }, live)]
  const tick = () => new Promise(resolve => setImmediate(resolve))
  await tick()
  assert.equal(frames[0].projections.values.knotRunState, 'paused')
  session = { ...session, runState: 'running' }
  emit({ kind: 'state.changed', runState: 'running' }); await tick()
  assert.equal(live.at(-1).runState, 'running')
  assert.equal(controls.some(value => value.type === 'projection' && value.key === 'knotRunState'), false)
  emit({ kind: 'journal.changed' }); await tick()
  assert.equal(activity.find(value => value.event === 'api-session/activity').args[1], Date.parse(events[0].observedAt))
  abort.abort(); await Promise.all(pumps)
})

test('B4 reconnect repairs history but does not invent an unseen generation prefix', async () => {
  let emit: (event: any) => void = () => {}
  let reconnect = () => {}
  const events: any[] = [
    { position: 0, type: 'user.message', data: { turnId: 't', content: 'Already running' } },
    { position: 1, type: 'llm.invoke', data: { requestId: 'r', request: { turnId: 't', purpose: 'agent' } } },
  ]
  const session = { id: 's', title: 's', assembly: 'case2', writable: true, runState: 'running', eventCount: 2 }
  const remote = createWorkbenchRemote((async (url: string) => Response.json(url.endsWith('/sessions') ? { sessions: [session] } : { session, events })) as typeof fetch,
    (_id, listener, onReconnect) => { emit = listener; reconnect = onReconnect!; return () => {} })
  const abort = new AbortController(), frames: any[] = []
  const consume = (async () => {
    for await (const frame of remote.open('$session', 'session/follow', { args: [{ address: { kind: 'session', sessionId: 's' }, assistantStream: true }] }, abort.signal)) frames.push(frame)
  })()
  await new Promise(resolve => setImmediate(resolve))
  emit({ kind: 'generation.update', requestId: 'r', update: { kind: 'content', text: 'unseen suffix' } })
  events.push({ position: 2, type: 'llm.generated', data: { requestId: 'r', request: { turnId: 't', purpose: 'agent' }, generated: { content: 'Complete answer' } } },
    { position: 3, type: 'assistant.message', data: { turnId: 't', content: 'Complete answer' } })
  reconnect()
  await new Promise(resolve => setImmediate(resolve))
  reconnect()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(frames.filter(frame => frame.type === 'assistant-stream').length, 0)
  assert.equal(frames.filter(frame => frame.event?.type === 'assistant/message').length, 1)
  assert.equal(frames.find(frame => frame.event?.type === 'assistant/message').event.data.message.content[0].text, 'Complete answer')
  abort.abort(); await consume
})
