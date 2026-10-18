import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import {
  Location,
  TXT_EDIT_MAX_CHARS,
  TXT_MAX_FILE_BYTES,
  isConsistentTxtHighlight,
  isValidTxtRange,
  packTxtAnnotationRef,
  parseSelectionTextRef,
  parseTxtAnnotationRef,
  quoteMatchesText,
  type HighlightRecord,
  type NoteLocator,
  type SaveHighlightInput as SdkSaveHighlightInput,
} from '@reading-book/book-reader-sdk'
import type { BookFileResolution } from '../files/sandbox'
import type {
  HighlightDto,
  SaveHighlightInput,
  TxtCommitErrorCode,
  TxtCommitInput,
  TxtCommitResult,
  TxtOpenNotice,
  TxtOpenResult,
} from '../ipc/api-types'
import {
  TxtRevisionConflictError,
  TxtRowOwnershipError,
  type TxtDocumentRow,
  type TxtCommitWrite,
} from '../persistence/sqlite-txt-store'
import { decodeTxtBytes } from './txt-codec'
import type { TxtWorkingCopyStore } from './txt-working-copy'

/** What the service needs to know about a book (a subset of the SDK `Book`). */
export interface TxtBookInfo {
  id: string
  filePath: string
  format: string
  sha256: string
}

export interface TxtDocumentServiceDeps {
  findBook(bookId: string): Promise<TxtBookInfo | undefined>
  /** The existing book-path validation (`resolveBookFile`). */
  resolveFile(book: TxtBookInfo): Promise<BookFileResolution>
  store: {
    getDocument(bookId: string): TxtDocumentRow | undefined
    commit(write: TxtCommitWrite): void
  }
  overlays: { listHighlights(bookId: string): Promise<HighlightRecord[]> }
  copies: TxtWorkingCopyStore
  /** The derived search / word-count index of the book is stale once its text changed. */
  invalidateIndex?(bookId: string): void
  log?(message: string, err?: unknown): void
}

export interface TxtDocumentService {
  open(bookId: unknown): Promise<TxtOpenResult>
  commit(input: unknown): Promise<TxtCommitResult>
  /** Drop what was cached for a book (it was removed from the library). */
  forget(bookId: string): void
}

const MAX_UPSERTS = 20_000
const MAX_DELETES = 20_000
const MAX_ID_LENGTH = 128
const ID_RE = /^[A-Za-z0-9_-]+$/
const STYLE_KINDS = new Set(['highlight', 'underline', 'strikethrough', 'textbox'])
const MAX_NOTE_LENGTH = 10_000
const MAX_TAGS = 100
/** A commit text may be a few characters per byte over the file limit (UTF-16 units vs bytes). */
const MAX_COMMIT_CHARS = TXT_MAX_FILE_BYTES

interface OpenSession {
  revision: number
  text: string
  sourceSha256?: string
}

function sha256Of(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function commitFailure(errorCode: TxtCommitErrorCode, errorMessage: string): TxtCommitResult {
  return { ok: false, errorCode, errorMessage }
}

/** Decodes an untrusted `locatorRef`; null unless it is a valid `Location` JSON. */
function parseLocatorRef(raw: unknown): NoteLocator | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    Location.parse(raw)
    return JSON.parse(raw) as NoteLocator
  } catch {
    return null
  }
}

function toHighlightDto(record: HighlightRecord): HighlightDto | null {
  if (!record.txtAnnotation) return null
  const dto: HighlightDto = {
    id: record.id,
    bookId: record.bookId,
    locatorRef: JSON.stringify(record.locator),
    styleKind: record.styleKind,
    colorHex: record.colorHex,
    tags: record.tags,
    txtAnnotationRef: packTxtAnnotationRef(record.txtAnnotation),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
  if (record.note) dto.note = record.note
  if (record.selectionText) dto.selectionTextRef = JSON.stringify(record.selectionText)
  return dto
}

/**
 * Validate one annotation row of a commit against the text it will belong to. Returns the row in
 * the shape the store writes, or null when anything about it is off — a bad commit is refused as a
 * whole, never half-applied.
 */
function validateUpsert(bookId: string, raw: unknown, text: string): SdkSaveHighlightInput | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Partial<SaveHighlightInput>
  if (typeof row.id !== 'string' || !row.id || row.id.length > MAX_ID_LENGTH || !ID_RE.test(row.id)) return null
  if (typeof row.styleKind !== 'string' || !STYLE_KINDS.has(row.styleKind)) return null
  if (typeof row.colorHex !== 'string' || !row.colorHex.trim() || row.colorHex.length > 32) return null
  if (row.note !== undefined && (typeof row.note !== 'string' || row.note.length > MAX_NOTE_LENGTH)) return null
  if (row.tags !== undefined) {
    if (!Array.isArray(row.tags) || row.tags.length > MAX_TAGS) return null
    if (row.tags.some((t) => typeof t !== 'string' || t.length > 200)) return null
  }
  if (row.createdAt !== undefined && typeof row.createdAt !== 'string') return null

  const annotation = parseTxtAnnotationRef(row.txtAnnotationRef)
  if (!annotation) return null
  const locator = parseLocatorRef(row.locatorRef)
  if (!locator || !isConsistentTxtHighlight(locator, annotation)) return null
  // The anchor must be a real range of THIS text, and still sit on the words it was made on.
  if (!isValidTxtRange(annotation.startOffset, annotation.endOffset, text)) return null
  const selectionText = parseSelectionTextRef(row.selectionTextRef)
  if (row.selectionTextRef !== undefined && !selectionText) return null
  if (!quoteMatchesText(text, { id: row.id, ...annotation }, selectionText?.highlight)) return null

  return {
    id: row.id,
    bookId,
    locator,
    styleKind: row.styleKind as SdkSaveHighlightInput['styleKind'],
    colorHex: row.colorHex.trim(),
    note: row.note?.trim() || undefined,
    tags: row.tags,
    selectionText,
    txtAnnotation: annotation,
    createdAt: row.createdAt?.trim() || undefined,
  }
}

export function createTxtDocumentService(deps: TxtDocumentServiceDeps): TxtDocumentService {
  const log = deps.log ?? (() => {})
  /** Text and revision each open book's commits are validated against (set by `open`). */
  const sessions = new Map<string, OpenSession>()
  /** One commit at a time per book — a second one waits for the first. */
  const chains = new Map<string, Promise<unknown>>()

  function openError(
    bookId: string,
    errorCode: NonNullable<TxtOpenResult['errorCode']>,
    errorMessage: string,
  ): TxtOpenResult {
    return { ok: false, bookId, errorCode, errorMessage }
  }

  async function readSource(book: TxtBookInfo): Promise<{ bytes: Buffer } | { error: TxtOpenResult }> {
    const file = await deps.resolveFile(book)
    if (!file.ok) {
      switch (file.code) {
        case 'path_denied':
          return { error: openError(book.id, 'path_denied', 'This book’s file location is not valid.') }
        case 'missing_file':
          return {
            error: openError(
              book.id,
              'missing_file',
              'The book file could not be found. It may have been moved, renamed, or deleted.',
            ),
          }
        default:
          return { error: openError(book.id, 'read_failed', 'Could not read the book file.') }
      }
    }
    try {
      const stat = await fsp.stat(file.path)
      if (stat.size > TXT_MAX_FILE_BYTES) {
        return { error: openError(book.id, 'too_large', 'This text file is too large to open.') }
      }
      return { bytes: await fsp.readFile(file.path) }
    } catch {
      return { error: openError(book.id, 'read_failed', 'Could not read the book file.') }
    }
  }

  async function open(bookIdRaw: unknown): Promise<TxtOpenResult> {
    const bookId = typeof bookIdRaw === 'string' ? bookIdRaw.trim() : ''
    if (!bookId) return openError('', 'not_found', 'Book not found.')
    const book = await deps.findBook(bookId)
    if (!book || book.format !== 'txt') return openError(bookId, 'not_found', 'Book not found.')

    const notices: TxtOpenNotice[] = []
    const row = deps.store.getDocument(bookId)
    let text: string | undefined
    let revision = 0
    let edited = false
    let encoding = 'utf-8'
    let sourceSha256: string | undefined

    // 1. The app's edited copy, when it exists and is intact.
    if (row) {
      revision = row.revision
      try {
        const copy = await deps.copies.read(bookId, row.revision)
        if (copy !== null && sha256Of(copy) === row.contentSha256) {
          text = copy
          edited = true
          sourceSha256 = row.sourceSha256
        } else {
          notices.push('working_copy_lost')
        }
      } catch (err) {
        log('txt: reading the edited copy failed', err)
        notices.push('working_copy_lost')
      }
    }

    // 2. The original file: the text itself when there is no usable copy, otherwise only checked
    //    for having changed behind our back.
    const source = await readSource(book)
    if ('bytes' in source) {
      const bytesSha = sha256Of(source.bytes)
      if (text === undefined) {
        const decoded = decodeTxtBytes(source.bytes)
        text = decoded.text
        encoding = decoded.encoding
        if (decoded.legacy) notices.push('legacy_encoding')
        sourceSha256 = bytesSha
        if (book.sha256 && book.sha256 !== bytesSha) notices.push('source_changed')
      } else if (row?.sourceSha256 && row.sourceSha256 !== bytesSha) {
        notices.push('source_changed')
      }
    } else if (text === undefined) {
      return source.error
    }

    const records = await deps.overlays.listHighlights(bookId)
    const highlights = records.map(toHighlightDto).filter((h): h is HighlightDto => h !== null)

    sessions.set(bookId, { revision, text, sourceSha256 })
    return {
      ok: true,
      bookId,
      text,
      revision,
      editable: text.length <= TXT_EDIT_MAX_CHARS,
      edited,
      notices,
      encoding,
      highlights,
    }
  }

  async function commitNow(inputRaw: unknown): Promise<TxtCommitResult> {
    if (!inputRaw || typeof inputRaw !== 'object') return commitFailure('invalid', 'Invalid request.')
    const input = inputRaw as Partial<TxtCommitInput>
    const bookId = typeof input.bookId === 'string' ? input.bookId.trim() : ''
    if (!bookId) return commitFailure('not_found', 'Book not found.')
    if (!Number.isSafeInteger(input.baseRevision) || (input.baseRevision as number) < 0) {
      return commitFailure('invalid', 'Invalid revision.')
    }
    const baseRevision = input.baseRevision as number
    if (input.text !== undefined && typeof input.text !== 'string') return commitFailure('invalid', 'Invalid text.')
    if (!Array.isArray(input.upserts) || input.upserts.length > MAX_UPSERTS) {
      return commitFailure('invalid', 'Invalid annotations.')
    }
    if (
      !Array.isArray(input.deletedIds) ||
      input.deletedIds.length > MAX_DELETES ||
      input.deletedIds.some((id) => typeof id !== 'string' || !id || id.length > MAX_ID_LENGTH)
    ) {
      return commitFailure('invalid', 'Invalid annotations.')
    }
    if (input.text !== undefined && input.text.length > MAX_COMMIT_CHARS) {
      return commitFailure('too_large', 'The text is too large to save.')
    }

    const book = await deps.findBook(bookId)
    if (!book || book.format !== 'txt') return commitFailure('not_found', 'Book not found.')
    const session = sessions.get(bookId)
    // A commit without a prior open is a renderer bug — refuse rather than guess the base text.
    if (!session) return commitFailure('conflict', 'The document is not open.')
    if (session.revision !== baseRevision) {
      return commitFailure('conflict', 'The document changed since it was opened.')
    }

    const textChanged = input.text !== undefined && input.text !== session.text
    const nextText = textChanged ? (input.text as string) : session.text
    const upserts: SdkSaveHighlightInput[] = []
    for (const raw of input.upserts) {
      const checked = validateUpsert(bookId, raw, nextText)
      if (!checked) return commitFailure('invalid', 'An annotation does not match the text.')
      upserts.push(checked)
    }

    const nextRevision = textChanged ? session.revision + 1 : session.revision
    let wroteCopy = false
    if (textChanged) {
      try {
        // Written first and made current by the transaction below: until then it's just a stray file.
        await deps.copies.write(bookId, nextRevision, nextText)
        wroteCopy = true
      } catch (err) {
        log('txt: writing the edited copy failed', err)
        return commitFailure('write_failed', 'Could not save your changes to disk.')
      }
    }

    try {
      deps.store.commit({
        bookId,
        expectedRevision: session.revision,
        nextDocument: textChanged
          ? {
              revision: nextRevision,
              contentSha256: sha256Of(nextText),
              charCount: nextText.length,
              sourceSha256: session.sourceSha256,
            }
          : undefined,
        upserts,
        deletedIds: input.deletedIds,
      })
    } catch (err) {
      if (wroteCopy) await deps.copies.prune(bookId, session.revision > 0 ? session.revision : null).catch(() => {})
      if (err instanceof TxtRevisionConflictError) {
        return commitFailure('conflict', 'The document changed since it was opened.')
      }
      if (err instanceof TxtRowOwnershipError) {
        return commitFailure('invalid', 'An annotation does not belong to this book.')
      }
      log('txt: the commit transaction failed', err)
      return commitFailure('db_failed', 'Could not save your changes.')
    }

    sessions.set(bookId, { ...session, revision: nextRevision, text: nextText })
    if (textChanged) {
      // The new revision is current; older files are garbage, and the search / word-count index
      // (built from the old text) must be rebuilt on the next open.
      await deps.copies.prune(bookId, nextRevision).catch(() => {})
      try {
        deps.invalidateIndex?.(bookId)
      } catch (err) {
        log('txt: invalidating the index failed', err)
      }
    }
    return { ok: true, revision: nextRevision }
  }

  function commit(input: unknown): Promise<TxtCommitResult> {
    const key =
      input && typeof input === 'object' && typeof (input as { bookId?: unknown }).bookId === 'string'
        ? ((input as { bookId: string }).bookId.trim() || '')
        : ''
    const previous = chains.get(key) ?? Promise.resolve()
    const run = previous.then(
      () => commitNow(input),
      () => commitNow(input),
    )
    chains.set(key, run)
    void run.finally(() => {
      if (chains.get(key) === run) chains.delete(key)
    })
    return run
  }

  return {
    open,
    commit,
    forget: (bookId) => {
      sessions.delete(bookId)
    },
  }
}
