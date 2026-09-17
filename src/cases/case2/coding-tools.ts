import { exec } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { ToolDefinition, ToolExecution } from '../case1/tools.js'

function textArgument(arguments_: Record<string, unknown>, name: string): string {
  const value = arguments_[name]
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`)
  return value
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

export function codingTools(cwd: string): readonly ToolDefinition[] {
  const read: ToolDefinition = {
    name: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'read',
        description: 'Read a UTF-8 text file from the workspace.',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
          additionalProperties: false,
        },
      },
    },
    async execute(arguments_) {
      const path = textArgument(arguments_, 'path')
      const content = await readFile(workspacePath(cwd, path), 'utf8')
      return result({ ok: true, path, content })
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
    execute(arguments_) {
      const command = textArgument(arguments_, 'command')
      return new Promise(resolveResult => {
        exec(command, { cwd }, (error, stdout, stderr) => {
          const exitCode = typeof error?.code === 'number' ? error.code : error === null ? 0 : 1
          resolveResult(result({ ok: error === null, exitCode, stdout, stderr }))
        })
      })
    },
  }

  return [read, write, edit, bash]
}
