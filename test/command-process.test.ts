import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCommandProcesses, COMMAND_OUTPUT_BYTES } from '../src/cases/case2/command-process.js'
import { commandTools } from '../src/cases/case2/command-tools.js'
import { createCase2Agent, createPersistentCase2Agent } from '../src/cases/case2/case2.js'
import { projectMessages } from '../src/agent/projection.js'
import type { LlmInvoke } from '../src/agent/protocol.js'

const node = (code: string) => `${JSON.stringify(process.execPath)} -e ${JSON.stringify(code)}`
const context = { turnId: 't', callId: 'c' }
const tick = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test('short commands preserve stdout, stderr and real nonzero exits; observation failures do not alter execution', async t => {
  const commands = createCommandProcesses(tmpdir(), { open() { throw new Error('observer unavailable') } })
  t.after(() => commands.close())
  const result = await commands.start(node('console.log("hello");console.error("oops");process.exitCode=7'), context)
  assert.equal(result.status, 'completed'); assert.equal(result.exitCode, 7); assert.equal(result.ok, false)
  assert.equal(result.stdout, 'hello\n'); assert.equal(result.stderr, 'oops\n')
  assert.equal(result.processId, undefined)
  const eof = await commands.start(node('process.stdin.on("end",()=>console.log("eof"));process.stdin.resume()'), context)
  assert.equal(eof.status, 'completed'); assert.equal(eof.stdout, 'eof\n')
  await assert.rejects(commands.start('echo invalid', context, -1), /yieldMs/)
  await assert.rejects(commands.start('echo invalid', context, 10001), /yieldMs/)
})

test('long commands yield a handle, explicit cursors never repeat output, waiting never re-executes', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'knot-command-'))
  const commands = createCommandProcesses(cwd)
  t.after(async () => { await commands.close(); await rm(cwd, { recursive: true, force: true }) })
  const started = await commands.start(node('require("fs").appendFileSync("runs","x");console.log("started");setTimeout(()=>console.log("done"),300)'), context, 0)
  assert.equal(started.status, 'running'); assert.equal(started.exitCode, undefined)
  let cursor = started.nextCursor, stdout = started.stdout, latest = started
  for (let count = 0; count < 10 && latest.status === 'running'; count++) {
    latest = await commands.wait(started.processId!, cursor, 1000)
    stdout += latest.stdout; cursor = latest.nextCursor
  }
  assert.equal(latest.status, 'completed'); assert.equal(latest.exitCode, 0)
  assert.equal(stdout, 'started\ndone\n'); assert.equal(await readFile(join(cwd, 'runs'), 'utf8'), 'x')
  assert.equal((await commands.wait(started.processId!, cursor, 0)).stdout, '')
  await assert.rejects(commands.wait(started.processId!, cursor + 1, 0), /cursor/)
  await assert.rejects(commands.wait(started.processId!, 0, -1), /wait/)
})

test('output retention is bounded and reports stale cursors, preserving Unicode and future incremental reads', async t => {
  const commands = createCommandProcesses(tmpdir())
  t.after(() => commands.close())
  const result = await commands.start(node('process.stdout.write("你".repeat(100000)+"tail")'), context)
  assert.equal(result.status, 'completed'); assert.equal(result.truncated, true)
  assert.ok(Buffer.byteLength(result.stdout + result.stderr) <= COMMAND_OUTPUT_BYTES)
  assert.ok(!result.stdout.includes('\ufffd')); assert.ok(result.stdout.endsWith('tail'))
  assert.equal(result.processId, undefined)
})

test('stop terminates the owned shell process group; other instances and old handles cannot control it', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'knot-stop-'))
  const commands = createCommandProcesses(cwd), other = createCommandProcesses(cwd)
  t.after(async () => { await commands.close(); await other.close(); await rm(cwd, { recursive: true, force: true }) })
  const started = await commands.start(node('require("fs").writeFileSync("pid",String(process.pid));console.log("ready");setInterval(()=>{},1000)'), context, 0)
  const ready = await commands.wait(started.processId!, started.nextCursor, 1000)
  assert.equal(ready.stdout, 'ready\n')
  const pid = Number(await readFile(join(cwd, 'pid'), 'utf8'))
  await assert.rejects(other.wait(started.processId!, 0, 0), /Unknown process/)
  await assert.rejects(other.stop(started.processId!), /Unknown process/)
  const stopped = await commands.stop(started.processId!)
  assert.equal(stopped.status, 'stopped'); assert.equal(stopped.signal, 'SIGTERM')
  // The shell has closed; its ordinary child may briefly be an OS zombie.
  for (let i = 0; i < 30; i++) {
    try { process.kill(pid, 0) } catch (error) { assert.equal((error as NodeJS.ErrnoException).code, 'ESRCH'); return }
    await tick(10)
  }
  assert.fail('command child remained alive after process-group termination')
})

test('a command ignoring SIGTERM remains running after the bounded stop, never a false stopped result', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'knot-stop-pending-'))
  const commands = createCommandProcesses(cwd)
  let group: number | undefined
  let handle: string | undefined
  t.after(async () => {
    // Explicit test cleanup of the exact group created below; not a product fallback.
    if (group !== undefined) { try { process.kill(-group, 'SIGKILL') } catch {} }
    // Observe close before asking the resource to signal again (macOS can
    // report EPERM for the short-lived, already-killed process-group zombie).
    if (handle !== undefined) {
      const current = await commands.wait(handle, 0, 0)
      await commands.wait(handle, current.nextCursor, 1000)
    }
    await commands.close(); await rm(cwd, { recursive: true, force: true })
  })
  const started = await commands.start('exec ' + node('process.on("SIGTERM",()=>{});require("fs").writeFileSync("pid",String(process.pid));console.log("ready");setInterval(()=>{},1000)'), context, 0)
  handle = started.processId
  await commands.wait(started.processId!, 0, 1000)
  group = Number(await readFile(join(cwd, 'pid'), 'utf8'))
  const stopped = await commands.stop(started.processId!)
  assert.equal(stopped.status, 'running'); assert.equal(stopped.exitCode, undefined)
  process.kill(group, 0)
})

test('finite waiting does not kill a silent command; explicit resource close stops it and prohibits new work', async t => {
  const commands = createCommandProcesses(tmpdir())
  t.after(() => commands.close())
  const started = await commands.start(node('setInterval(()=>{},1000)'), context, 0)
  const observed = await commands.wait(started.processId!, 0, 30)
  assert.equal(observed.status, 'running'); assert.equal(observed.stdout, '')
  await commands.close()
  await assert.rejects(commands.start('echo should-not-run', context, 0), /closed/)
  await assert.rejects(commands.wait(started.processId!, 0, 0), /Unknown process/)
})

test('Agent runs background work, another tool, wait and stop through existing batched facts with exact Context reconstruction', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'knot-agent-command-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  await writeFile(join(cwd, 'note'), 'foreground remains available')
  let handle = '', cursor = 0, step = 0
  const captured: { requestId: string; messages: unknown }[] = []
  const agent = createCase2Agent({ cwd, llm: { async generate(call) {
    const last = [...call.messages].reverse().find(message => message.role === 'tool')
    if (last) {
      const result = JSON.parse(last.content!)
      if (result.processId) { handle = result.processId; cursor = result.nextCursor }
    }
    captured.push({ requestId: `agent-${++step}`, messages: call.messages })
    const tool = step === 1 ? { name: 'bash', arguments: { command: node('console.log("ready");setInterval(()=>{},1000)'), yieldMs: 0 } }
      : step === 2 ? { name: 'read', arguments: { path: 'note' } }
        : step === 3 ? { name: 'process.wait', arguments: { processId: handle, cursor, waitMs: 1000 } }
          : step === 4 ? { name: 'process.stop', arguments: { processId: handle } } : undefined
    return { generated: { content: tool ? undefined : 'Read the note and stopped the background command.', toolCalls: tool ? [{ id: 'call-' + step, ...tool }] : [] }, usage: { contextWindow: 100000 } }
  } } })
  t.after(() => agent.close())
  await agent.submit('Start a background command, read the note, inspect progress and stop it.')
  assert.equal(agent.status(), 'idle'); assert.equal(step, 5)
  const events = agent.journal.read()
  for (const capturedCall of captured) {
    const invoke = events.find(event => event.type === 'llm.invoke' && (event.data as LlmInvoke).requestId === capturedCall.requestId)!.data as LlmInvoke
    assert.deepEqual(projectMessages(events, invoke), capturedCall.messages)
  }
  const results = events.filter(event => event.type === 'tool.result').flatMap(event => (event.data as any).results).map(result => JSON.parse(result.content))
  assert.equal(results[0].status, 'running'); assert.equal(results[1].content, 'foreground remains available')
  assert.equal(results[3].status, 'stopped')
  assert.equal(events.some(event => /process\.|stdout|delta/.test(event.type)), false)
})

test('a restored persistent Session returns an explicit unknown-handle result, not a rerun', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'knot-restored-command-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const journalPath = join(cwd, 's.jsonl')
  const first = await createPersistentCase2Agent({ cwd, journalPath, llm: { async generate() { return { generated: { content: 'done', toolCalls: [] }, usage: { contextWindow: 10000 } } } } })
  await first.submit('init'); await first.close()
  let called = false
  const restored = await createPersistentCase2Agent({ cwd, journalPath, llm: { async generate() {
    if (!called) { called = true; return { generated: { toolCalls: [{ id: 'old', name: 'process.wait', arguments: { processId: 'old-runtime', cursor: 0, waitMs: 0 } }] }, usage: { contextWindow: 10000 } } }
    return { generated: { content: 'The previous process cannot be queried after restart.', toolCalls: [] }, usage: { contextWindow: 10000 } }
  } } })
  t.after(() => restored.close())
  await restored.submit('check old handle')
  const result = restored.journal.read().filter(event => event.type === 'tool.result').at(-1)!.data as any
  assert.match(result.results[0].content, /Unknown process/)
})

test('command tool schemas expose bounded waiting without arbitrary PID control', () => {
  const tools = commandTools(createCommandProcesses(tmpdir()))
  assert.deepEqual(tools.map(tool => tool.name), ['bash', 'process.wait', 'process.stop'])
})
