/**
 * `txt.open`, always read-only (spec 008, T061): the first release does not edit TXT books, so there are no text
 * revisions and `editable` is always false. The text is decoded exactly as Desktop's Main does (`txt-codec.ts`, which
 * lives in Electron Main and cannot be imported: R7); highlights are the book's stored rows.
 */
import { TXT_MAX_FILE_BYTES, detectTxtBom, normalizeTxtText } from '@reading-book/book-reader-sdk'
import { idOf, type BridgeContext } from './context'
import { toHighlightDto } from './dto'
import { HostCallError } from './host-client'
import { notAvailableResult } from './unavailable'

type Txt = Window['api']['txt']
type TxtOpenResult = Awaited<ReturnType<Txt['open']>>

export interface DecodedTxt {
  text: string
  encoding: string
  legacy: boolean
}

function guessUtf16(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const sample = Math.min(bytes.length, 4096) & ~1
  if (sample < 4) return null
  let evenZeros = 0
  let oddZeros = 0
  for (let i = 0; i < sample; i += 2) {
    if (bytes[i] === 0) evenZeros++
    if (bytes[i + 1] === 0) oddZeros++
  }
  const pairs = sample / 2
  if (oddZeros > pairs * 0.4 && evenZeros < pairs * 0.05) return 'utf-16le'
  if (evenZeros > pairs * 0.4 && oddZeros < pairs * 0.05) return 'utf-16be'
  return null
}

/** Same decision as Desktop's `decodeTxtBytes`: BOM, then UTF-16 by shape, then strict UTF-8, else Windows-1252. */
export function decodeTxtBytes(bytes: Uint8Array): DecodedTxt {
  const bom = detectTxtBom(bytes)
  if (bom) return { text: normalizeTxtText(new TextDecoder(bom.encoding).decode(bytes.subarray(bom.length))), encoding: bom.encoding, legacy: false }
  const utf16 = guessUtf16(bytes)
  if (utf16) return { text: normalizeTxtText(new TextDecoder(utf16).decode(bytes)), encoding: utf16, legacy: false }
  try {
    return { text: normalizeTxtText(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), encoding: 'utf-8', legacy: false }
  } catch {
    return { text: normalizeTxtText(new TextDecoder('windows-1252').decode(bytes)), encoding: 'windows-1252', legacy: true }
  }
}

export function createTxtGroup(ctx: BridgeContext): Txt {
  const fail = (bookId: string, errorCode: NonNullable<TxtOpenResult['errorCode']>, errorMessage: string): TxtOpenResult => ({ ok: false, bookId, errorCode, errorMessage })

  return {
    async open(bookIdRaw) {
      const bookId = idOf(bookIdRaw)
      if (!bookId) return fail('', 'not_found', 'Book not found.')
      const book = await ctx.library.findById(bookId)
      if (!book || book.format !== 'txt') return fail(bookId, 'not_found', 'Book not found.')
      if (book.fileSizeBytes != null && book.fileSizeBytes > TXT_MAX_FILE_BYTES) return fail(bookId, 'too_large', 'This text file is too large to open.')
      let bytes: Uint8Array
      try {
        bytes = new Uint8Array(await ctx.content.read(bookId))
      } catch (error) {
        const code = error instanceof HostCallError ? error.code : ''
        if (code === 'NOT_FOUND') return fail(bookId, 'missing_file', 'The book file could not be found. It may have been moved, renamed, or deleted.')
        if (code === 'BOOK_TOO_LARGE_FOR_DEV') return fail(bookId, 'too_large', 'Books larger than 20 MB open only in the installed app, not in Expo Go.')
        return fail(bookId, 'read_failed', 'Could not read the book file.')
      }
      if (bytes.length > TXT_MAX_FILE_BYTES) return fail(bookId, 'too_large', 'This text file is too large to open.')
      const decoded = decodeTxtBytes(bytes)
      const highlights = (await ctx.overlay.listHighlights(bookId)).filter((h) => h.txtAnnotation).map(toHighlightDto)
      return {
        ok: true,
        bookId,
        text: decoded.text,
        revision: 0,
        editable: false,
        edited: false,
        notices: decoded.legacy ? ['legacy_encoding'] : [],
        encoding: decoded.encoding,
        highlights,
      }
    },
    commit: notAvailableResult('txt.commit'),
  }
}
