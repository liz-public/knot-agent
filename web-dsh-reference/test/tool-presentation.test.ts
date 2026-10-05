import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nativeToolProps } from '../src/tool-presentation.ts'

function card(name: string, args: unknown, result?: unknown) {
  const call = { name, callId: 'c', argsRaw: JSON.stringify(args) }
  return { toolName: name, block: result === undefined ? call : { kind: 'tool-result', callId: 'c', call,
    isError: false, content: [{ type: 'text', text: JSON.stringify(result) }] } }
}

test('S2 maps native file-card fields without changing raw input or inventing an applied diff', () => {
  const read = card('read', { path: '/repo/a.ts', offset: 8, limit: 2 },
    { ok: true, path: '/repo/a.ts', startLine: 8, totalLines: 20, content: 'one\ntwo' })
  const before = JSON.stringify(read), mapped = nativeToolProps(read)
  assert.equal(JSON.parse(mapped.block.call.argsRaw).file_path, '/repo/a.ts')
  assert.deepEqual(mapped.block.meta.lines, [{ number: 8, text: 'one' }, { number: 9, text: 'two' }])
  assert.match(mapped.block.content[0].text, /<type>file<\/type>/)
  assert.equal(JSON.stringify(read), before)
  const edit = nativeToolProps(card('edit', { path: 'a', oldText: 'before', newText: 'after' }, { ok: true }))
  assert.deepEqual(JSON.parse(edit.block.call.argsRaw), { path: 'a', oldText: 'before', newText: 'after',
    file_path: 'a', old_string: 'before', new_string: 'after' })
  assert.equal(edit.block.meta, undefined)
  const write = nativeToolProps(card('write', { path: 'a', content: 'new' }))
  assert.equal(JSON.parse(write.block.argsRaw).file_path, 'a')
})

test('S2 Bash terminal uses actual output and exit code, preserving unknown/failure fallback', () => {
  const props = card('bash', { command: 'example' }, { exitCode: 2, stdout: 'out\n', stderr: 'err\n' })
  props.block.isError = true
  const mapped = nativeToolProps(props)
  assert.equal(mapped.block.content[0].text, 'out\nerr\n\n[exit code: 2]')
  assert.equal(mapped.block.isError, false) // Native terminal shows exit-code failure.
  assert.equal(JSON.parse(mapped.block.call.argsRaw).description, 'example')
  const unknown = card('bash', { command: 'example' }, { ok: false, error: 'Spawn failed' })
  unknown.block.isError = true
  assert.deepEqual(nativeToolProps(unknown).block.content, unknown.block.content)
  assert.equal(nativeToolProps(unknown).block.isError, true)
  const cli = card('bash', { command: 'app.list' }, { ok: true, apps: [] })
  assert.equal(JSON.parse(nativeToolProps(cli).block.call.argsRaw).description, undefined)
  assert.deepEqual(nativeToolProps(cli).block.content, cli.block.content)
})

test('running and stopped Bash results never fabricate a completed zero exit for the native terminal', () => {
  for (const result of [{ status: 'running', processId: 'p', stdout: 'started', stderr: '', nextCursor: 1 },
    { status: 'stopped', processId: 'p', exitCode: null, signal: 'SIGTERM', stdout: '', stderr: '' }]) {
    const input = card('bash', { command: 'example' }, result)
    const output = nativeToolProps(input)
    assert.equal(JSON.parse(output.block.call.argsRaw).description, undefined)
    assert.deepEqual(output.block.content, input.block.content)
    assert.ok(!JSON.stringify(output.block.content).includes('[exit code: 0]'))
  }
})

test('S2 aliases call names inside native blocks and presents Ask answers without guessing choice provenance', () => {
  const ask = nativeToolProps(card('ask', { question: 'Next?', choices: ['A'] }, { ok: true, answer: 'A' }))
  assert.equal(ask.toolName, 'ask_user_question')
  assert.equal(ask.block.call.name, 'ask_user_question')
  assert.deepEqual(JSON.parse(ask.block.call.argsRaw), { questions: [{ id: 'c', question: 'Next?', options: [{ label: 'A' }] }] })
  assert.deepEqual(JSON.parse(ask.block.content[0].text), { answers: [{ id: 'c', selected: [], custom: 'A' }] })
  const child = nativeToolProps(card('spawn_agent', { task: 'Investigate' }))
  assert.equal(child.block.name, 'subagent')
  assert.equal(JSON.parse(child.block.argsRaw).prompt, 'Investigate')
  assert.equal(nativeToolProps(card('todo.write', { items: [] })).block.name, 'todo_write')
})

test('S2 partial or malformed arguments remain generic; plain results still allow field mapping', () => {
  const partial = { toolName: 'read', phase: 'preparing', block: { argsRaw: '{"path":' } }
  assert.equal(nativeToolProps(partial).block, partial.block)
  const bad = { toolName: 'read', block: { argsRaw: '[]' } }
  assert.equal(nativeToolProps(bad).block, bad.block)
  const plain = card('read', { path: 'a' }, 'Plain result')
  plain.block.content[0].text = 'Plain result'
  assert.equal(JSON.parse(nativeToolProps(plain).block.call.argsRaw).file_path, 'a')
  assert.deepEqual(nativeToolProps(plain).block.content, plain.block.content)
})

test('S2 search sources enter the native web card without inventing answer or publication data', () => {
  const original = card('web_search', { query: 'current news' }, { ok: true, sources: [{ url: 'https://example.com', title: 'Source' }] })
  const before = JSON.stringify(original), mapped = nativeToolProps(original)
  assert.deepEqual(JSON.parse(mapped.block.call.argsRaw).queries, ['current news'])
  assert.deepEqual(mapped.block.meta, { sources: [{ url: 'https://example.com', title: 'Source' }], truncated: false })
  assert.equal(JSON.stringify(original), before)
  assert.equal(nativeToolProps(card('web_search', { query: 'news' }, { ok: false, error: 'failed' })).block.meta, undefined)
})
