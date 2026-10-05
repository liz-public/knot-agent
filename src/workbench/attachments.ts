/** Session-owned file intake and image admission. No DSH runtime or Agent flow. */
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { join, relative, resolve, isAbsolute, sep } from 'node:path'
import sharp from 'sharp'
import type { AttachmentRef } from '../agent/protocol.js'
import { readImageAttachment } from '../agent/attachment-content.js'

export const IMAGE_LIMITS = {
  maxImageBytes: 20 * 1024 * 1024, maxImagesPerMessage: 20,
  maxMessageImageBytes: 200 * 1024 * 1024, maxImagePixels: 64_000_000, maxImageDimension: 8192,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
}
export const ATTACHMENT_MESSAGE_BYTES = Math.ceil(IMAGE_LIMITS.maxMessageImageBytes * 4 / 3) + 1024 * 1024

export class AttachmentError extends Error {
  readonly code = 'session/attachment-invalid'
  constructor(message: string, readonly reason: string) { super(message) }
}
const invalid = (message: string, reason = 'INVALID_ATTACHMENT') => new AttachmentError(message, reason)
const nameOf = (name = 'file') => {
  const leaf = name.split(/[\\/]/).at(-1)!.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200)
  return !leaf || leaf === '.' || leaf === '..' ? 'file' : leaf
}
export const attachmentMetadata = ({ kind: _kind, path: _path, ...metadata }: AttachmentRef) => metadata

export function createAttachmentStore(workspace: string, sessionId: string) {
  const root = resolve(workspace, '.knot', 'attachments', sessionId)
  const receipts = new Map<string, AttachmentRef>()

  async function saveFile(data: AsyncIterable<Uint8Array>, name?: string): Promise<AttachmentRef> {
    await mkdir(root, { recursive: true })
    const temporary = join(root, '.upload-' + randomUUID())
    const file = await open(temporary, 'wx', 0o600)
    const hash = createHash('sha256')
    let bytes = 0
    try {
      for await (const chunk of data) {
        hash.update(chunk); bytes += chunk.length
        // FileHandle.write may write only a prefix; preserve every input byte.
        let offset = 0
        while (offset < chunk.length) offset += (await file.write(chunk, offset, chunk.length - offset)).bytesWritten
      }
      await file.close()
      const digest = hash.digest('hex'), leaf = nameOf(name)
      const directory = join(root, digest)
      await mkdir(directory, { recursive: true })
      const path = join(directory, leaf)
      await rename(temporary, path)
      await chmod(path, 0o400)
      return { kind: 'file', attachmentId: 'sha256:' + digest, name: leaf, bytes, path }
    } catch (error) {
      await file.close().catch(() => {})
      await unlink(temporary).catch(() => {})
      throw error
    }
  }

  async function upload(data: AsyncIterable<Uint8Array>, name?: string) {
    const file = await saveFile(data, name)
    const receiptId = randomUUID()
    receipts.set(receiptId, file)
    return { receiptId, file: attachmentMetadata(file) }
  }

  async function image(part: Record<string, unknown>): Promise<AttachmentRef> {
    if (typeof part.data !== 'string' || typeof part.mediaType !== 'string' || !IMAGE_LIMITS.mediaTypes.includes(part.mediaType)) {
      throw invalid('Invalid encoded image', 'INVALID_IMAGE')
    }
    const bytes = Buffer.from(part.data, 'base64')
    if (bytes.length > IMAGE_LIMITS.maxImageBytes) throw invalid('Image exceeds 20 MiB', 'IMAGE_TOO_LARGE')
    const decoder = sharp(bytes, { limitInputPixels: IMAGE_LIMITS.maxImagePixels, failOn: 'warning' })
    const metadata = await decoder.metadata()
    const type = metadata.format === 'jpeg' ? 'image/jpeg' : 'image/' + metadata.format
    if (type !== part.mediaType) throw invalid('Image type does not match its bytes', 'IMAGE_TYPE_MISMATCH')
    if (!metadata.width || !metadata.height || metadata.width > IMAGE_LIMITS.maxImageDimension || metadata.height > IMAGE_LIMITS.maxImageDimension) {
      throw invalid('Invalid or oversized image dimensions', 'IMAGE_DIMENSION_TOO_LARGE')
    }
    const scale = Math.min(1, Math.sqrt(2048 * 2048 / (metadata.width * metadata.height)))
    const normalized = await decoder.rotate().resize({ width: Math.max(1, Math.floor(metadata.width * scale)),
      height: Math.max(1, Math.floor(metadata.height * scale)), fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true })
    const name = nameOf(typeof part.name === 'string' ? part.name : 'image.webp')
    const ref = await saveFile((async function* () { yield normalized.data })(), name.replace(/\.[^.]+$/, '') + '.webp')
    return { ...ref, kind: 'image', name, mediaType: 'image/webp', width: normalized.info.width, height: normalized.info.height }
  }

  async function admit(parts: unknown) {
    if (!Array.isArray(parts) || parts.some(part => !part || typeof part !== 'object' || !['text', 'file', 'image'].includes(part.type))) {
      throw invalid('Expected text, file receipts or encoded images')
    }
    const images = parts.filter(part => part.type === 'image')
    if (images.length > IMAGE_LIMITS.maxImagesPerMessage) throw invalid('Too many images', 'TOO_MANY_IMAGES')
    if (images.reduce((sum, part) => sum + (typeof part.data === 'string' ? Buffer.byteLength(part.data, 'base64') : 0), 0) > IMAGE_LIMITS.maxMessageImageBytes) {
      throw invalid('Image batch exceeds 200 MiB', 'MESSAGE_IMAGES_TOO_LARGE')
    }
    // Validate every receipt before storing images; foreign/unuploaded paths are never accepted.
    for (const part of parts) {
      if (part.type === 'file' && !receipts.has(part.receiptId)) throw invalid('File was not uploaded for this Session', 'FILE_NOT_STAGED')
      if (part.type === 'text' && typeof part.text !== 'string') throw invalid('Invalid text part')
    }
    const attachments: AttachmentRef[] = []
    for (const part of parts) {
      if (part.type === 'image') {
        try { attachments.push(await image(part)) }
        catch (error) { throw error instanceof AttachmentError ? error : invalid(String(error), 'INVALID_IMAGE') }
      }
      if (part.type === 'file') attachments.push(receipts.get(part.receiptId)!)
    }
    return { content: parts.filter(part => part.type === 'text').map(part => part.text).join('\n'), attachments }
  }

  function retire(parts: unknown) {
    for (const part of parts as { type: string; receiptId?: string }[]) if (part.type === 'file') receipts.delete(part.receiptId!)
  }

  async function read(ref: AttachmentRef) {
    const within = relative(root, resolve(ref.path))
    if (isAbsolute(within) || within === '..' || within.startsWith('..' + sep)) throw invalid('Attachment is outside this Session')
    const bytes = ref.kind === 'image' ? await readImageAttachment(ref) : await readFile(ref.path)
    return { attachment: attachmentMetadata(ref), data: bytes.toString('base64') }
  }
  return { upload, admit, retire, read }
}
