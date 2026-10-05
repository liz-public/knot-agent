/** User-operated PTYs. Transient Host resources, independent of Agent tools and Journal. */
import { accessSync, constants } from 'node:fs'
import { basename } from 'node:path'
import pty, { type IPty } from 'node-pty'
import xterm from '@xterm/headless'
import serialize from '@xterm/addon-serialize'

export const terminalLimits = { maxInputBytes: 64 * 1024, maxCols: 500, maxRows: 200, scrollback: 1000 }
export interface Shell { path: string; name: string; args: string[] }
export interface TerminalInfo {
  id: string; title: string; shell: Shell; cwd: string; cols: number; rows: number
  state: 'running' | 'exited'; exitCode: number | null; controllerId?: string
}
export type TerminalFrame = { type: 'snapshot'; sequence: number; screen: string; info: TerminalInfo }
  | { type: 'output'; sequence: number; data: string } | { type: 'state'; info: TerminalInfo }
export class UserTerminalError extends Error {
  constructor(readonly code: string, message: string, readonly details: object = {}) { super(message) }
}
function dimensions(cols: unknown, rows: unknown): void {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || Number(cols) < 2 || Number(rows) < 1
    || Number(cols) > terminalLimits.maxCols || Number(rows) > terminalLimits.maxRows) {
    throw new UserTerminalError('terminal/invalid-size', 'Invalid terminal dimensions')
  }
}
export function terminalShells(): Shell[] {
  return [...new Set([process.env['SHELL'], '/bin/zsh', '/bin/bash', '/bin/sh'].filter((p): p is string => !!p))]
    .filter(path => { try { accessSync(path, constants.X_OK); return true } catch { return false } })
    .map(path => ({ path, name: basename(path), args: ['-i'] }))
}

class UserTerminal {
  info: TerminalInfo
  private readonly process: IPty
  private readonly screen: xterm.Terminal
  private readonly serializer = new serialize.SerializeAddon()
  private readonly followers = new Set<(frame: TerminalFrame) => void>()
  private operations = Promise.resolve()
  private sequence = 0
  private readonly exited: Promise<void>
  private closing?: Promise<void>
  constructor(cwd: string, id: string, shell: Shell, cols: number, rows: number) {
    this.process = pty.spawn(shell.path, shell.args, { cwd, cols, rows, name: 'xterm-256color' })
    this.info = { id, title: shell.name, shell, cwd, cols, rows, state: 'running', exitCode: null }
    this.screen = new xterm.Terminal({ cols, rows, scrollback: terminalLimits.scrollback, allowProposedApi: true })
    this.screen.loadAddon(this.serializer)
    this.process.onData(data => {
      this.process.pause()
      void this.enqueue(async () => {
        await new Promise<void>(resolve => this.screen.write(data, resolve))
        this.emit({ type: 'output', sequence: ++this.sequence, data })
        this.process.resume()
      })
    })
    this.exited = new Promise(resolve => this.process.onExit(({ exitCode }) => {
      void this.enqueue(() => {
        this.info = { ...this.info, state: 'exited', exitCode }
        this.emit({ type: 'state', info: this.info })
        resolve()
      })
    }))
  }
  private emit(frame: TerminalFrame): void { for (const receive of this.followers) receive(frame) }
  private enqueue(action: () => void | Promise<void>): Promise<void> {
    const result = this.operations.then(action)
    this.operations = result.catch(() => {})
    return result
  }
  async follow(attachmentId: string, receive: (frame: TerminalFrame) => void): Promise<() => void> {
    await this.enqueue(() => {
      this.info = { ...this.info, controllerId: attachmentId }
      this.emit({ type: 'state', info: this.info })
      this.followers.add(receive)
      receive({ type: 'snapshot', sequence: this.sequence, screen: this.serializer.serialize(), info: this.info })
    })
    return () => {
      this.followers.delete(receive)
      if (this.info.controllerId === attachmentId) {
        delete this.info.controllerId
        this.emit({ type: 'state', info: this.info })
      }
    }
  }
  private requireControl(attachmentId: unknown): void {
    if (this.info.state !== 'running' || !attachmentId || attachmentId !== this.info.controllerId) {
      throw new UserTerminalError('terminal/control-unavailable', 'Terminal input is not owned by this view', {
        reason: this.info.state === 'running' ? 'read-only' : 'not-running',
      })
    }
  }
  write(attachmentId: unknown, data: unknown): void {
    this.requireControl(attachmentId)
    if (typeof data !== 'string' || Buffer.byteLength(data) > terminalLimits.maxInputBytes) {
      throw new UserTerminalError('terminal/invalid-input', 'Terminal input is too large or not text')
    }
    this.process.write(data)
  }
  resize(attachmentId: unknown, cols: number, rows: number): Promise<void> {
    dimensions(cols, rows)
    return this.enqueue(() => {
      this.requireControl(attachmentId)
      this.process.resize(cols, rows)
      this.screen.resize(cols, rows)
      this.info = { ...this.info, cols, rows }
      this.emit({ type: 'state', info: this.info })
    })
  }
  rename(title: unknown): void {
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 120) {
      throw new UserTerminalError('terminal/invalid-title', 'Terminal title must be 1–120 characters')
    }
    this.info = { ...this.info, title: title.trim() }
    this.emit({ type: 'state', info: this.info })
  }
  close(): Promise<void> { return this.closing ??= this.shutdown() }
  private async shutdown(): Promise<void> {
    if (this.info.state === 'running') {
      this.process.kill()
      const force = setTimeout(() => { if (this.info.state === 'running') this.process.kill('SIGKILL') }, 1000)
      try { await this.exited } finally { clearTimeout(force) }
    }
    this.followers.clear()
    this.screen.dispose()
  }
}

/** One collection per HTTP Host; switching browser tabs never disposes a PTY. */
export function createUserTerminals() {
  const sessions = new Map<string, Map<string, UserTerminal>>()
  const get = (sessionId: string, id: string) => {
    const terminal = sessions.get(sessionId)?.get(id)
    if (!terminal) throw new UserTerminalError('terminal/unavailable', 'Terminal no longer exists')
    return terminal
  }
  return {
    list: (sessionId: string) => [...(sessions.get(sessionId)?.values() ?? [])].map(terminal => terminal.info),
    get,
    create(sessionId: string, cwd: string, input: { id: string; shellPath?: string; cols: number; rows: number }): TerminalInfo {
      if (typeof input.id !== 'string' || !/^[\w-]{1,128}$/.test(input.id)) throw new UserTerminalError('terminal/invalid-id', 'Invalid terminal ID')
      dimensions(input.cols, input.rows)
      const entries = sessions.get(sessionId) ?? new Map<string, UserTerminal>()
      if (entries.has(input.id)) return entries.get(input.id)!.info
      if (entries.size >= 8) throw new UserTerminalError('terminal/limit-reached', 'At most 8 terminals per Session', { limit: 8 })
      const shells = terminalShells()
      const shell = input.shellPath === undefined ? shells[0] : shells.find(shell => shell.path === input.shellPath)
      if (!shell) throw new UserTerminalError('terminal/unavailable', 'Shell is unavailable')
      const terminal = new UserTerminal(cwd, input.id, shell, input.cols, input.rows)
      entries.set(input.id, terminal); sessions.set(sessionId, entries)
      return terminal.info
    },
    async close(sessionId: string, id: string): Promise<void> {
      const entries = sessions.get(sessionId)
      const terminal = entries?.get(id)
      if (!terminal) return
      await terminal.close(); entries!.delete(id)
      if (!entries!.size && sessions.get(sessionId) === entries) sessions.delete(sessionId)
    },
    async dispose(): Promise<void> {
      await Promise.all([...sessions.values()].flatMap(entries => [...entries.values()].map(terminal => terminal.close())))
      sessions.clear()
    },
  }
}
