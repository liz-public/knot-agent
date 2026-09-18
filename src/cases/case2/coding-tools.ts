import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { ToolDefinition, ToolExecution } from '../case1/tools.js'

const READ_MAX_LINES = 2000
const READ_MAX_BYTES = 50 * 1024

export interface ToolOutput {
  open(meta: {
    readonly turnId: string
    readonly callId: string
    readonly toolName: string
    readonly command: string
  }): {
    write(update: { readonly stream: 'stdout' | 'stderr'; readonly text: string }): void | Promise<void>
    close(result: { readonly exitCode: number }): void | Promise<void>
  } | undefined
}

function textArgument(arguments_: Record<string, unknown>, name: string): string {
  const value = arguments_[name]
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`)
  return value
}

function positiveIntegerArgument(
  arguments_: Record<string, unknown>,
  name: string,
): number | undefined {
  const value = arguments_[name]
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${name} must be a positive integer`)
  }
  return Number(value)
}

function readTextPage(content: string, offset = 1, limit?: number) {
  const lines = content.split('\n')
  const totalLines = lines.length
  const startIndex = offset - 1
  if (startIndex >= totalLines) {
    throw new RangeError(`offset ${offset} is beyond end of file (${totalLines} lines)`)
  }

  const requestedLines = Math.min(limit ?? READ_MAX_LINES, READ_MAX_LINES)
  const selected: string[] = []
  let bytes = 0
  for (let index = startIndex; index < totalLines && selected.length < requestedLines; index += 1) {
    const line = lines[index]!
    const lineBytes = Buffer.byteLength(`${selected.length === 0 ? '' : '\n'}${line}`)
    if (bytes + lineBytes > READ_MAX_BYTES) break
    selected.push(line)
    bytes += lineBytes
  }

  if (selected.length === 0) {
    return {
      ok: false,
      content: '',
      startLine: offset,
      endLine: offset - 1,
      totalLines,
      truncated: true,
      nextOffset: offset,
      error: `line ${offset} exceeds the ${READ_MAX_BYTES}-byte read limit; use bash with a byte range`,
    }
  }

  const endLine = startIndex + selected.length
  const truncated = endLine < totalLines
  return {
    ok: true,
    content: selected.join('\n'),
    startLine: offset,
    endLine,
    totalLines,
    truncated,
    ...(truncated ? { nextOffset: endLine + 1 } : {}),
  }
}

function workspacePath(cwd: string, path: string): string {
  const absolute = resolve(cwd, path)
  const fromWorkspace = relative(cwd, absolute)
  if (fromWorkspace.startsWith('..') || isAbsolute(fromWorkspace)) {
    throw new Error(`path is outside the workspace: ${path}`)
  }
  return absolute
}

function result(data: Record<string, unknown>): ToolExecution {
  return { content: JSON.stringify(data) }
}

function present(action: () => void | Promise<void>): void {
  try {
    void Promise.resolve(action()).catch(() => undefined)
  } catch {
    // Presentation cannot change tool execution.
  }
}

export function codingTools(cwd: string, output?: ToolOutput): readonly ToolDefinition[] {
  const read: ToolDefinition = {
    name: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'read',
        description: 'Read a UTF-8 text file from the workspace. Returns at most 2000 lines or 50 KiB; use offset and limit to continue.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            offset: { type: 'integer', minimum: 1, description: '1-based first line to read.' },
            limit: { type: 'integer', minimum: 1, description: 'Maximum lines to read.' },
          },
          required: ['path'],
          additionalProperties: false,
        },
      },
    },
    async execute(arguments_) {
      const path = textArgument(arguments_, 'path')
      const offset = positiveIntegerArgument(arguments_, 'offset')
      const limit = positiveIntegerArgument(arguments_, 'limit')
      const content = await readFile(workspacePath(cwd, path), 'utf8')
      const page = readTextPage(content, offset, limit)
      return result({ path, ...page })
    },
  }

  const write: ToolDefinition = {
    name: 'write',
    schema: {
      type: 'function',
      function: {
        name: 'write',
        description: 'Create or replace a UTF-8 text file in the workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['path', 'content'],
          additionalProperties: false,
        },
      },
    },
    async execute(arguments_) {
      const path = textArgument(arguments_, 'path')
      const content = textArgument(arguments_, 'content')
      const absolute = workspacePath(cwd, path)
      await mkdir(dirname(absolute), { recursive: true })
      await writeFile(absolute, content, 'utf8')
      return result({ ok: true, path, bytes: Buffer.byteLength(content) })
    },
  }

  const edit: ToolDefinition = {
    name: 'edit',
    schema: {
      type: 'function',
      function: {
        name: 'edit',
        description: 'Replace one exact, unique text occurrence in a workspace file.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            oldText: { type: 'string' },
            newText: { type: 'string' },
          },
          required: ['path', 'oldText', 'newText'],
          additionalProperties: false,
        },
      },
    },
    async execute(arguments_) {
      const path = textArgument(arguments_, 'path')
      const oldText = textArgument(arguments_, 'oldText')
      const newText = textArgument(arguments_, 'newText')
      if (oldText.length === 0) return result({ ok: false, error: 'old_text_empty' })
      const absolute = workspacePath(cwd, path)
      const content = await readFile(absolute, 'utf8')
      const occurrences = content.split(oldText).length - 1
      if (occurrences !== 1) {
        return result({ ok: false, error: 'old_text_not_unique', occurrences, path })
      }
      await writeFile(absolute, content.replace(oldText, newText), 'utf8')
      return result({ ok: true, path })
    },
  }

  const bash: ToolDefinition = {
    name: 'bash',
    schema: {
      type: 'function',
      function: {
        name: 'bash',
        description: 'Run one shell command in the workspace and return its exit status and output.',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
          additionalProperties: false,
        },
      },
    },
    execute(arguments_, context) {
      const command = textArgument(arguments_, 'command')
      return new Promise(resolveResult => {
        let channel: ReturnType<ToolOutput['open']>
        try {
          channel = output?.open({ ...context, toolName: 'bash', command })
        } catch {
          // Presentation cannot change tool execution.
        }
        const child = spawn(command, { cwd, shell: true })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', chunk => {
          const text = String(chunk)
          stdout += text
          if (channel !== undefined) present(() => channel.write({ stream: 'stdout', text }))
        })
        child.stderr.on('data', chunk => {
          const text = String(chunk)
          stderr += text
          if (channel !== undefined) present(() => channel.write({ stream: 'stderr', text }))
        })
        child.once('error', error => {
          stderr += error.message
        })
        child.once('close', code => {
          const exitCode = code ?? 1
          if (channel !== undefined) present(() => channel.close({ exitCode }))
          resolveResult(result({ ok: exitCode === 0, exitCode, stdout, stderr }))
        })
      })
    },
  }

  return [read, write, edit, bash]
}
