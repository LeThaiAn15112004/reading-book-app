/**
 * Spec 016 (FR-006, research R10), Mobile: `library.getCoverSource` / `library.readBookRange` with Desktop's types.
 * Ranges come from the local server (`Range` → `206`) — the WebView never receives the whole book to draw a cover.
 */
import { readEpubLeadingDocuments } from '@core'
import { idOf, type BridgeContext } from './context'
import { HostCallError } from './host-client'
import { openBookZip } from './ranged-book'

type Library = Window['api']['library']
type CoverSource = Awaited<ReturnType<Library['getCoverSource']>>
type BookRange = Awaited<ReturnType<Library['readBookRange']>>

/** Same bounds as Desktop (`files/cover-source.ts`). */
const BOOK_RANGE_MAX_BYTES = 1024 * 1024
const TEXT_HEAD_BYTES = 64 * 1024
const TEXT_MAX_CHARS = 4000
const RANGE_FORMATS = new Set(['pdf', 'epub', 'txt', 'md'])

function headText(bytes: Uint8Array): string {
  let text = new TextDecoder('utf-8').decode(bytes)
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  if (text.endsWith('�')) text = text.slice(0, -1)
  return text.slice(0, TEXT_MAX_CHARS)
}

function readErrorCode(error: unknown): 'not_found' | 'read_failed' | 'range' {
  if (error instanceof HostCallError) {
    if (error.code === 'NOT_FOUND') return 'not_found'
    if (error.code === 'INVALID_ARGUMENT') return 'range'
  }
  return 'read_failed'
}

export function createCoverSourceMethods(ctx: BridgeContext): Pick<Library, 'getCoverSource' | 'readBookRange'> {
  return {
    async getCoverSource(id): Promise<CoverSource> {
      const bookId = idOf(id)
      if (!bookId) return { ok: false, errorCode: 'not_found' }
      const book = await ctx.library.findById(bookId)
      if (!book) return { ok: false, errorCode: 'not_found' }
      try {
        const format = String(book.format).toLowerCase()
        if (format === 'pdf') {
          const { sizeBytes } = await ctx.content.readRange(bookId, 0, 1)
          return { ok: true, kind: 'pdf', sizeBytes }
        }
        if (format === 'txt' || format === 'md') {
          const { sizeBytes } = await ctx.content.readRange(bookId, 0, 1)
          const { data } = await ctx.content.readRange(bookId, 0, Math.max(1, Math.min(sizeBytes, TEXT_HEAD_BYTES)))
          const text = headText(data)
          return text.trim() ? { ok: true, kind: 'text', text } : { ok: false, errorCode: 'nothing_to_render' }
        }
        if (format === 'epub') {
          const documents = await readEpubLeadingDocuments(await openBookZip(ctx, bookId))
          return documents.length ? { ok: true, kind: 'html', documents } : { ok: false, errorCode: 'nothing_to_render' }
        }
        return { ok: false, errorCode: 'nothing_to_render' }
      } catch (error) {
        const code = readErrorCode(error)
        return { ok: false, errorCode: code === 'not_found' ? 'missing_file' : 'read_failed' }
      }
    },

    async readBookRange(input): Promise<BookRange> {
      const { bookId: rawId, offset, length } = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
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
      const bookId = idOf(rawId)
      if (!bookId) return { ok: false, errorCode: 'not_found' }
      const book = await ctx.library.findById(bookId)
      if (!book) return { ok: false, errorCode: 'not_found' }
      if (!RANGE_FORMATS.has(String(book.format).toLowerCase())) return { ok: false, errorCode: 'path_denied' }
      try {
        const { data, sizeBytes } = await ctx.content.readRange(bookId, offset, length)
        const copy = data.slice().buffer as ArrayBuffer
        return { ok: true, data: copy, sizeBytes }
      } catch (error) {
        const code = readErrorCode(error)
        return { ok: false, errorCode: code === 'not_found' ? 'missing_file' : code }
      }
    },
  }
}
