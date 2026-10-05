import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { AttachmentRef } from './protocol.js'

/** Verify a durable image before projecting bytes into an API or presentation. */
export async function readImageAttachment(ref: AttachmentRef): Promise<Buffer> {
  const bytes = await readFile(ref.path)
  if (bytes.length !== ref.bytes || 'sha256:' + createHash('sha256').update(bytes).digest('hex') !== ref.attachmentId) {
    throw new Error('Stored image no longer matches its Journal reference')
  }
  return bytes
}
