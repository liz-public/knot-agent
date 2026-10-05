/** CASE2-owned execution resources; no Journal, Host, PTY or persisted process state. */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'

export interface ToolOutput {
  open(meta: { readonly turnId: string; readonly callId: string; readonly toolName: string; readonly command: string }): {
    write(update: { readonly stream: 'stdout' | 'stderr'; readonly text: string }): void | Promise<void>
    close(result: { readonly exitCode: number }): void | Promise<void>
  } | undefined
}

export const COMMAND_WAIT_MS = 10_000
export const COMMAND_OUTPUT_BYTES = 64 * 1024
type Output = { cursor: number; stream: 'stdout' | 'stderr'; text: string; bytes: number }
type Process = {
  child: ChildProcess; chunks: Output[]; bytes: number; nextCursor: number; lostThrough: number;
  closed: boolean; stopRequested: boolean; exitCode: number | null; signal: NodeJS.Signals | null;
  error?: string; changed: Set<() => void>;
}

function present(action: () => void | Promise<void>) {
  try { void Promise.resolve(action()).catch(() => {}) } catch { /* Observation never changes execution. */ }
}

export function createCommandProcesses(cwd: string, output?: ToolOutput) {
  const processes = new Map<string, Process>()
  let closing = false

  function get(processId: string) {
    const process = processes.get(processId)
    if (!process) throw new Error('Unknown process handle in this runtime; a prior runtime cannot be resumed or queried here.')
    return process
  }

  function checkCursor(process: Process, cursor: number) {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > process.nextCursor) throw new TypeError('cursor must address output already produced by this process')
  }

  function snapshot(processId: string, process: Process, cursor: number) {
    checkCursor(process, cursor)
    const chunks = process.chunks.filter(chunk => chunk.cursor >= cursor)
    const status = !process.closed ? 'running' : process.stopRequested ? 'stopped' : 'completed'
    return {
      ok: !process.error && (!process.closed || process.exitCode === 0 || status === 'stopped'),
      status, processId,
      stdout: chunks.filter(chunk => chunk.stream === 'stdout').map(chunk => chunk.text).join(''),
      stderr: chunks.filter(chunk => chunk.stream === 'stderr').map(chunk => chunk.text).join(''),
      nextCursor: process.nextCursor, truncated: cursor <= process.lostThrough,
      ...(process.closed ? { exitCode: process.exitCode, signal: process.signal } : {}),
      ...(process.error ? { error: process.error } : {}),
      ...(!process.closed ? { hint: 'The command is still running, not successful yet. Use process.wait with processId and nextCursor, or process.stop.' }
        : status === 'stopped' ? { hint: 'The command terminated after a stop request, not command success. Use process.wait with your previous cursor for any unread output.' } : {}),
    }
  }

  function waitFor(process: Process, ms: number, ready: () => boolean) {
    if (!Number.isSafeInteger(ms) || ms < 0 || ms > COMMAND_WAIT_MS) throw new TypeError(`wait must be an integer from 0 to ${COMMAND_WAIT_MS} ms`)
    if (ready() || ms === 0) return Promise.resolve()
    return new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); process.changed.delete(check); resolve() }
      const check = () => { if (ready()) finish() }
      const timer = setTimeout(finish, ms)
      process.changed.add(check)
    })
  }

  async function start(command: string, context: { turnId: string; callId: string }, yieldMs = COMMAND_WAIT_MS) {
    if (closing) throw new Error('Command runtime is closed')
    // Validate before launching: bad arguments must not produce side effects.
    if (!Number.isSafeInteger(yieldMs) || yieldMs < 0 || yieldMs > COMMAND_WAIT_MS) throw new TypeError(`yieldMs must be an integer from 0 to ${COMMAND_WAIT_MS}`)
    const processId = randomUUID()
    let channel: ReturnType<ToolOutput['open']>
    present(() => { channel = output?.open({ ...context, toolName: 'bash', command }) })
    const child = spawn(command, { cwd, shell: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    const process_: Process = { child, chunks: [], bytes: 0, nextCursor: 0, lostThrough: -1, closed: false,
      stopRequested: false, exitCode: null, signal: null, changed: new Set() }
    processes.set(processId, process_)
    const notify = () => { for (const listener of [...process_.changed]) listener() }
    const append = (stream: 'stdout' | 'stderr', text: string) => {
      if (!text) return
      const liveText = text
      const cursor = process_.nextCursor++
      let bytes = Buffer.byteLength(text)
      if (bytes > COMMAND_OUTPUT_BYTES) {
        const raw = Buffer.from(text)
        let offset = raw.length - COMMAND_OUTPUT_BYTES
        while ((raw[offset]! & 0xc0) === 0x80) offset++ // Never split a UTF-8 character.
        text = raw.subarray(offset).toString('utf8'); bytes = Buffer.byteLength(text)
        process_.lostThrough = Math.max(process_.lostThrough, cursor)
      }
      process_.chunks.push({ cursor, stream, text, bytes }); process_.bytes += bytes
      while (process_.bytes > COMMAND_OUTPUT_BYTES) {
        const dropped = process_.chunks.shift()!
        process_.bytes -= dropped.bytes; process_.lostThrough = Math.max(process_.lostThrough, dropped.cursor)
      }
      if (channel) present(() => channel!.write({ stream, text: liveText }))
      notify()
    }
    child.stdout!.setEncoding('utf8').on('data', text => append('stdout', text))
    child.stderr!.setEncoding('utf8').on('data', text => append('stderr', text))
    child.once('error', error => { process_.error = error.message; append('stderr', error.message) })
    child.once('close', (code, signal) => {
      process_.closed = true; process_.exitCode = code; process_.signal = signal
      if (channel) present(() => channel!.close({ exitCode: code ?? 1 }))
      notify()
    })
    await waitFor(process_, yieldMs, () => process_.closed)
    const result = snapshot(processId, process_, 0)
    // Inline commands already have a complete Journal result. Only commands
    // actually exposed as background handles need retained external resources.
    if (process_.closed) {
      processes.delete(processId)
      return { ...result, processId: undefined }
    }
    return result
  }

  async function wait(processId: string, cursor: number, waitMs = COMMAND_WAIT_MS) {
    const process = get(processId)
    checkCursor(process, cursor)
    await waitFor(process, waitMs, () => process.closed || process.nextCursor > cursor)
    return snapshot(processId, process, cursor)
  }

  async function stop(processId: string) {
    const process = get(processId)
    if (!process.closed && process.child.pid !== undefined) {
      if (globalThis.process.platform === 'win32') throw new Error('Process-group stop is currently supported on POSIX only')
      try {
        globalThis.process.kill(-process.child.pid, 'SIGTERM')
        process.stopRequested = true
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
    }
    await waitFor(process, COMMAND_WAIT_MS, () => process.closed)
    return snapshot(processId, process, process.nextCursor)
  }

  async function close() {
    closing = true
    const results = await Promise.all([...processes.keys()].map(stop))
    for (const [id, process] of processes) if (process.closed) processes.delete(id)
    if (results.some(result => result.status === 'running')) throw new Error('Some commands have not confirmed normal termination; force-killing is not enabled.')
  }
  return { start, wait, stop, close }
}

export type CommandProcesses = ReturnType<typeof createCommandProcesses>
