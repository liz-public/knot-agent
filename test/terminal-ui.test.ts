import assert from 'node:assert/strict'
import test from 'node:test'
import { createTerminalUi } from '../src/cases/case1/terminal-ui.js'

test('terminal UI only deduplicates the current generation preview', async () => {
  let stdout = ''
  let stderr = ''
  const ui = createTerminalUi(false, {
    stdout: { write(text) { stdout += text } },
    stderr: { write(text) { stderr += text } },
  })

  const toolPreamble = ui.live.open({ requestId: 'one', turnId: 'turn-1', purpose: 'agent' })!
  await toolPreamble.write({ kind: 'content', text: 'working' })
  await toolPreamble.close()

  const finalPreview = ui.live.open({ requestId: 'two', turnId: 'turn-1', purpose: 'agent' })!
  await finalPreview.write({ kind: 'content', text: 'done' })
  await finalPreview.close()

  ui.output.content('working')
  ui.output.content('done')

  assert.equal(stdout, 'working\ndone\nworking\n')
  assert.equal(stderr, '')
})

test('terminal UI exposes tool-call stream updates separately from content and reasoning', async () => {
  let stdout = ''
  let stderr = ''
  const ui = createTerminalUi(false, {
    stdout: { write(text) { stdout += text } },
    stderr: { write(text) { stderr += text } },
  })
  const channel = ui.live.open({ requestId: 'one', turnId: 'turn-1', purpose: 'agent' })!

  await channel.write({ kind: 'reasoning', text: 'think' })
  await channel.write({ kind: 'content', text: 'explain' })
  await channel.write({ kind: 'tool_call', index: 0, name: 'read', argumentsDelta: '{"path":"a"}' })
  await channel.close()

  assert.equal(stdout, 'explain\n')
  assert.equal(stderr, '[reasoning] think\n[tool_call 0] read{"path":"a"}\n')
})
