import test from 'node:test'
import assert from 'node:assert/strict'
import { androidRecordingStopRule } from '../src/cases/case1/shortcuts.js'
test('recording card intent generates normal case1 command without confirm or cancel tools', () => {
  assert.deepEqual(androidRecordingStopRule.match('停止录音'), { kind: 'tool', name: 'bash', arguments: { command: 'record audio stop' } })
  assert.deepEqual(androidRecordingStopRule.match('停止录屏'), { kind: 'tool', name: 'bash', arguments: { command: 'record screen stop' } })
  assert.equal(androidRecordingStopRule.match('如何停止录音'), undefined)
})
