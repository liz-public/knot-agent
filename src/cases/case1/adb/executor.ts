import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface AdbExecutorOptions {
  readonly serial?: string
  readonly adbPath?: string
  readonly defaultTimeoutMs?: number
}

export interface AdbExecutor {
  shell(command: string, timeoutMs?: number): Promise<string>
  shellLines(command: string, timeoutMs?: number): Promise<string[]>
}

function resolveAdbPath(custom?: string): string {
  if (custom !== undefined && custom.length > 0) return custom
  const home = process.env['HOME'] ?? ''
  return `${home}/Library/Android/sdk/platform-tools/adb`
}

export function createAdbExecutor(options: AdbExecutorOptions = {}): AdbExecutor {
  const adb = resolveAdbPath(options.adbPath)
  const serial = options.serial
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000

  const baseArgs = serial === undefined || serial.length === 0
    ? ['shell']
    : ['-s', serial, 'shell']

  return {
    async shell(command, timeoutMs = defaultTimeoutMs) {
      const { stdout, stderr } = await execFileAsync(
        adb,
        [...baseArgs, command],
        { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      )
      const out = stdout.trim()
      const errText = stderr.trim()
      if (out.length === 0 && errText.length > 0) return errText
      if (errText.length > 0 && !out.includes(errText)) return `${out}\n${errText}`.trim()
      return out
    },
    async shellLines(command, timeoutMs = defaultTimeoutMs) {
      const text = await this.shell(command, timeoutMs)
      return text.split('\n').map(line => line.trimEnd()).filter(line => line.length > 0)
    },
  }
}

export async function probeAdbDevice(executor: AdbExecutor): Promise<{ model: string; release: string }> {
  const model = await executor.shell('getprop ro.product.model')
  const release = await executor.shell('getprop ro.build.version.release')
  return { model, release }
}
