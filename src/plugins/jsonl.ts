import { appendFile, readFile } from 'node:fs/promises'
import type { Plugin } from '../journal.js'

export const JSONL_LOAD = 'storage.load'

export const jsonlLoadPlugin = (path: string): Plugin => journal => {
  let loaded = false
  journal.subscribe(JSONL_LOAD, async () => {
    if (loaded) throw new Error('JSONL session has already been loaded')
    loaded = true

    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }

    const lines = text.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!
      if (line.length === 0 && index === lines.length - 1) continue
      try {
        const event = JSON.parse(line) as { type?: unknown; data?: unknown }
        if (typeof event.type !== 'string' || !Object.hasOwn(event, 'data')) {
          throw new TypeError('expected { type: string, data: unknown }')
        }
        journal.append(event.type, event.data)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`invalid JSONL event at line ${index + 1}: ${message}`)
      }
    }
  })
}

export const jsonlStorePlugin = (path: string): Plugin => journal =>
  journal.subscribe('*', async event => {
    const data = JSON.stringify(event.data)
    if (data === undefined) {
      throw new TypeError(`event ${event.type} is not JSONL serializable`)
    }
    const line = `{"type":${JSON.stringify(event.type)},"data":${data}}`
    await appendFile(path, `${line}\n`, 'utf8')
  })
