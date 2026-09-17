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
