/**
 * Spec 016 (FR-006, research R10): the renderer draws a "first page" cover without receiving the whole book.
 *
 * - `readCoverSource(bookId)`: TXT / MD → the first ≤ 4 000 characters of the first 64 KiB; EPUB → the HTML of its
 *   first spine documents, read through the ranged ZIP reader; PDF → its size (page 1 is then read by ranges).
 * - `readBookRange({ bookId, offset, length })`: ≤ 1 MiB of a library book's file, path validated by
 *   `resolveBookFile` (the renderer only ever sends a book id). Audio formats are refused.
 * Only ever reads; never writes next to a book file.
 */
import fsp from 'node:fs/promises'
import { readEpubLeadingDocuments } from '@core'
import { openEpubArchive } from '../adapters/epub.adapter'
import type { BookRangeResultDto, CoverSourceDto } from '../ipc/api-types'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import { resolveBookFile } from './sandbox'

/** contracts/import-ipc.md: `1 ≤ length ≤ 1 048 576`. */
export const BOOK_RANGE_MAX_BYTES = 1024 * 1024
const TEXT_HEAD_BYTES = 64 * 1024
const TEXT_MAX_CHARS = 4000
const RANGE_FORMATS = new Set(['pdf', 'epub', 'txt', 'md'])

type Resolved =
  | { ok: true; path: string; format: string; size: number }
  | { ok: false; errorCode: 'not_found' | 'missing_file' | 'path_denied' | 'read_failed' }

async function resolve(id: unknown): Promise<Resolved> {
  if (typeof id !== 'string' || !id.trim()) return { ok: false, errorCode: 'not_found' }
  const book = await getLibraryStore().findById(id.trim())
  if (!book) return { ok: false, errorCode: 'not_found' }
  const file = await resolveBookFile(book)
  if (!file.ok) return { ok: false, errorCode: file.code }
  try {
    const info = await fsp.stat(file.path)
    return { ok: true, path: file.path, format: book.format.toLowerCase(), size: info.size }
  } catch {
    return { ok: false, errorCode: 'missing_file' }
  }
}

async function readAt(filePath: string, offset: number, length: number): Promise<Buffer> {
  const handle = await fsp.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    let done = 0
    while (done < length) {
      const { bytesRead } = await handle.read(buffer, done, length - done, offset + done)
      if (bytesRead === 0) break
      done += bytesRead
    }
    return done === length ? buffer : buffer.subarray(0, done)
  } finally {
    await handle.close()
  }
}

/** UTF-8 text of the first bytes, BOM stripped, a character cut at the end dropped. */
function headText(bytes: Buffer): string {
  let text = bytes.toString('utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  if (text.endsWith('�')) text = text.slice(0, -1)
  return text.slice(0, TEXT_MAX_CHARS)
}

export async function readCoverSource(id: unknown): Promise<CoverSourceDto> {
  const file = await resolve(id)
  if (!file.ok) return file
  try {
    switch (file.format) {
      case 'pdf':
        return { ok: true, kind: 'pdf', sizeBytes: file.size }
      case 'txt':
      case 'md': {
        const text = headText(await readAt(file.path, 0, Math.min(file.size, TEXT_HEAD_BYTES)))
        return text.trim() ? { ok: true, kind: 'text', text } : { ok: false, errorCode: 'nothing_to_render' }
      }
      case 'epub': {
        const { archive, close } = await openEpubArchive(file.path)
        try {
          const documents = await readEpubLeadingDocuments(archive)
          return documents.length ? { ok: true, kind: 'html', documents } : { ok: false, errorCode: 'nothing_to_render' }
        } finally {
          await close().catch(() => {})
        }
      }
      default:
        return { ok: false, errorCode: 'nothing_to_render' }
    }
  } catch {
    return { ok: false, errorCode: 'read_failed' }
  }
}

export async function readBookRange(input: unknown): Promise<BookRangeResultDto> {
  const { bookId, offset, length } = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  if (
    typeof offset !== 'number' ||
    typeof length !== 'number' ||
    !Number.isInteger(offset) ||
    !Number.isInteger(length) ||
    offset < 0 ||
    length < 1 ||
    length > BOOK_RANGE_MAX_BYTES
  ) {
    return { ok: false, errorCode: 'range' }
  }
  const file = await resolve(bookId)
  if (!file.ok) return file
  if (!RANGE_FORMATS.has(file.format)) return { ok: false, errorCode: 'path_denied' }
  if (offset + length > file.size) return { ok: false, errorCode: 'range' }
  try {
    const bytes = await readAt(file.path, offset, length)
    if (bytes.length !== length) return { ok: false, errorCode: 'read_failed' }
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    return { ok: true, data, sizeBytes: file.size }
  } catch {
    return { ok: false, errorCode: 'read_failed' }
  }
}
