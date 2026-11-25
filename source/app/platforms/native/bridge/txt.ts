/**
 * The phone's TXT group (spec 008 T061; spec 019 FR-015a).
 *
 * `txt.open` is always read-only: the phone does not edit TXT books, so there are no text revisions (`revision` is
 * always 0) and `editable` is always false. The text is decoded exactly as Desktop's Main does (`txt-codec.ts`, which
 * lives in Electron Main and cannot be imported: R7); highlights are the book's stored rows.
 *
 * `txt.commit` writes MARKS only (`specs/019-mobile-reader-redesign/contracts/mobile-txt-commit.md`): a `text`
 * refuses, a revision other than 0 conflicts, every row is checked against the book's decoded text with the same core
 * checks as Main (`parseTxtAnnotationRef`, `isConsistentTxtHighlight`, `isValidTxtRange`, `quoteMatchesText`), and the
 * rows are written in ONE host transaction — all or nothing.
 */
import {
  TXT_MAX_FILE_BYTES,
  detectTxtBom,
  isConsistentTxtHighlight,
  isValidTxtRange,
  normalizeTxtText,
  parseTxtAnnotationRef,
  quoteMatchesText,
  type SaveHighlightInput,
} from '@core'
import { MOBILE_WRITABLE_STYLE_KINDS, OverlayValidationError } from '../stores/overlay-store'
import { idOf, type BridgeContext } from './context'
import { parseLocatorRef, parseSelectionTextRef, toHighlightDto } from './dto'
import { HostCallError } from './host-client'

type Txt = Window['api']['txt']
type TxtOpenResult = Awaited<ReturnType<Txt['open']>>
type TxtCommitInput = Parameters<Txt['commit']>[0]
type TxtCommitResult = Awaited<ReturnType<Txt['commit']>>
type UpsertDto = TxtCommitInput['upserts'][number]

/** Desktop Main's limits for one commit (`txt-document-service.ts`). */
const MAX_UPSERTS = 20_000
const MAX_DELETES = 20_000
const MAX_ID_LENGTH = 128
const ID_RE = /^[A-Za-z0-9_-]+$/
const MAX_NOTE_LENGTH = 10_000
const MAX_TAGS = 100

const commitFailure = (errorCode: NonNullable<TxtCommitResult['errorCode']>, errorMessage: string): TxtCommitResult => ({
  ok: false,
  errorCode,
  errorMessage,
})

const validId = (id: unknown): id is string => typeof id === 'string' && !!id && id.length <= MAX_ID_LENGTH && ID_RE.test(id)

/** One mark of a commit against the text it belongs to, in the store's shape; null when anything about it is off. */
function validateUpsert(bookId: string, raw: unknown, text: string): SaveHighlightInput | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Partial<UpsertDto>
  if (!validId(row.id)) return null
  if (typeof row.styleKind !== 'string' || !MOBILE_WRITABLE_STYLE_KINDS.includes(row.styleKind)) return null
  if (typeof row.colorHex !== 'string' || !row.colorHex.trim() || row.colorHex.length > 32) return null
  if (row.note !== undefined && (typeof row.note !== 'string' || row.note.length > MAX_NOTE_LENGTH)) return null
  if (row.tags !== undefined) {
    if (!Array.isArray(row.tags) || row.tags.length > MAX_TAGS) return null
    if (row.tags.some((tag) => typeof tag !== 'string' || tag.length > 200)) return null
  }
  if (row.createdAt !== undefined && typeof row.createdAt !== 'string') return null
  const annotation = parseTxtAnnotationRef(row.txtAnnotationRef)
  if (!annotation) return null
  const locator = parseLocatorRef(row.locatorRef)
  if (!locator || !isConsistentTxtHighlight(locator, annotation)) return null
  if (!isValidTxtRange(annotation.startOffset, annotation.endOffset, text)) return null
  const selectionText = parseSelectionTextRef(row.selectionTextRef)
  if (row.selectionTextRef !== undefined && !selectionText) return null
  if (!quoteMatchesText(text, { id: row.id, ...annotation }, selectionText?.highlight)) return null
  return {
    id: row.id,
    bookId,
    locator,
    styleKind: row.styleKind,
    colorHex: row.colorHex.trim(),
    note: row.note?.trim() || undefined,
    tags: row.tags,
    selectionText,
    txtAnnotation: annotation,
    createdAt: row.createdAt?.trim() || undefined,
  }
}

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
    commit: (inputRaw) =>
      ctx.writes.run(async (): Promise<TxtCommitResult> => {
        if (!inputRaw || typeof inputRaw !== 'object') return commitFailure('invalid', 'Invalid commit.')
        const input = inputRaw as Partial<TxtCommitInput>
        const bookId = idOf(input.bookId)
        if (!bookId) return commitFailure('invalid', 'Invalid book.')
        // The phone never edits the text (FR-015a): a commit carrying text is refused before anything else.
        if (input.text !== undefined) return commitFailure('invalid', 'The text of a TXT book cannot be changed on the phone.')
        if (typeof input.baseRevision !== 'number' || !Number.isInteger(input.baseRevision)) return commitFailure('invalid', 'Invalid revision.')
        if (!Array.isArray(input.upserts) || input.upserts.length > MAX_UPSERTS) return commitFailure('invalid', 'Invalid annotations.')
        if (!Array.isArray(input.deletedIds) || input.deletedIds.length > MAX_DELETES || !input.deletedIds.every(validId)) {
          return commitFailure('invalid', 'Invalid annotations.')
        }
        if (input.baseRevision !== 0) return commitFailure('conflict', 'The text changed since it was opened.')

        const book = await ctx.library.findById(bookId)
        if (!book || book.format !== 'txt') return commitFailure('not_found', 'Book not found.')
        // The offsets are checked against the text: an unreadable file writes nothing.
        let text: string
        try {
          text = decodeTxtBytes(new Uint8Array(await ctx.content.read(bookId))).text
        } catch {
          return commitFailure('not_found', 'The book file could not be read.')
        }
        const upserts: SaveHighlightInput[] = []
        for (const raw of input.upserts) {
          const row = validateUpsert(bookId, raw, text)
          if (!row) return commitFailure('invalid', 'Invalid annotation.')
          upserts.push(row)
        }
        try {
          await ctx.overlay.commitTxtAnnotations(bookId, upserts, input.deletedIds)
        } catch (error) {
          if (error instanceof OverlayValidationError) return commitFailure('invalid', 'Invalid annotation.')
          return commitFailure('db_failed', 'The annotations could not be saved.')
        }
        return { ok: true, revision: 0 }
      }),
  }
}
