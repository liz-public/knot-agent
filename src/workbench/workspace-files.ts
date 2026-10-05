/** Host-only, read-only filesystem view. No tools, Journal writes or retained content. */
import { open, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export class WorkspaceFileError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}
const fail = (code: string, message: string): never => { throw new WorkspaceFileError('workspace-file/' + code, message) }
const inside = (root: string, path: string) => {
  const part = relative(root, path)
  return part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part)
}

export async function readWorkspaceFile(workspace: string | undefined, path: string,
  action: 'list' | 'stat' | 'read', offset = 1, limit = 200) {
  if (!workspace) fail('unknown-workspace', 'Session has no workspace')
  if (!Number.isSafeInteger(offset) || offset < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    fail('invalid-range', 'offset must be positive and limit must be between 1 and 200')
  }
  try {
    const root = await realpath(workspace!)
    const requested = resolve(workspace!, path)
    if (!inside(resolve(workspace!), requested) && !inside(root, requested)) fail('outside-workspace', 'Path is outside the Session workspace')
    const target = await realpath(requested)
    if (!inside(root, target)) fail('outside-workspace', 'Symlink resolves outside the Session workspace')
    const info = await stat(target)
    const metadata = { absolutePath: target, version: `${info.mtimeMs}:${info.ctimeMs}:${info.size}`, bytes: info.size }
    if (action === 'stat') return metadata
    if (action === 'list') {
      if (!info.isDirectory()) fail('not-directory', 'Path is not a directory')
      const children = (await readdir(target, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
      // No recursive walk or per-entry stat. Symlinks are not advertised as readable files.
      return { path: relative(root, target), entries: children.slice(0, 1000).map(child => ({
        name: child.name, type: child.isDirectory() ? 'directory' : child.isFile() ? 'file' : 'other',
      })), truncated: children.length > 1000 }
    }
    if (!info.isFile()) fail('not-regular-file', 'Path is not a regular file')
    const file = await open(target, 'r')
    const decoder = new TextDecoder('utf-8', { fatal: true })
    const lines: string[] = []
    let pending = '', line = 1, pageBytes = 0
    const take = (value: string) => {
      if (value.includes('\0')) fail('not-text', 'File contains binary data')
      if (line++ >= offset) {
        pageBytes += Buffer.byteLength(value)
        if (pageBytes > 256 * 1024) fail('too-large', 'Text page exceeds 256 KiB')
        lines.push(value.replace(/\r$/, ''))
      }
    }
    try {
      const buffer = Buffer.alloc(16 * 1024)
      while (true) {
        const { bytesRead } = await file.read(buffer, 0, buffer.length, null)
        pending += decoder.decode(buffer.subarray(0, bytesRead), { stream: bytesRead > 0 })
        let end: number
        while ((end = pending.indexOf('\n')) >= 0) {
          take(pending.slice(0, end)); pending = pending.slice(end + 1)
          if (lines.length > limit) return { ...metadata, offset, text: lines.slice(0, limit).join('\n'), lines: limit, eof: false }
        }
        if (Buffer.byteLength(pending) > 256 * 1024) fail('too-large', 'Single line exceeds 256 KiB')
        if (!bytesRead) {
          if (pending) take(pending)
          return { ...metadata, offset, text: lines.slice(0, limit).join('\n'), lines: Math.min(lines.length, limit), eof: lines.length <= limit }
        }
      }
    } catch (error) {
      if (error instanceof TypeError) fail('not-text', 'File is not UTF-8 text')
      throw error
    } finally { await file.close() }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') fail('not-found', 'Workspace path was not found')
    throw error
  }
}
