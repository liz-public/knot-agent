import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import test from 'node:test'

test('CASE1 CLI turns each input line into a completed mock-agent turn', async () => {
  const child = spawn(process.execPath, ['dist/src/cases/case1/run.js'], {
    cwd: process.cwd(),
    env: { ...process.env, KNOT_TRACE: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })

  child.stdin.end('打开手电筒\n关闭手电筒\n/exit\n')
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })

  assert.equal(exitCode, 0, stderr)
  assert.equal(stdout, 'assistant> 已打开手电筒。\nassistant> 已关闭手电筒。\n')
  assert.match(stderr, /\[idle\].*this turn/)
})
