/**
 * Import of an annotations file into a book (specs/006-annotation-import-export, US2 / FR-004..FR-013).
 *
 *   pickFile   open dialog → parse (content, not the file name) → identify the file's book → check the target's book file →
 *              plan (add / present / not placed) → a Main-held preview session. Nothing is written.
 *   setTarget  the user's explicit choice of target book; re-plans.
 *   confirm    ONE synchronous `BEGIN IMMEDIATE` transaction: re-validate the preview, then write every annotation, or none.
 *
 * Everything outside the transaction may await; the transaction itself never does (a single connection is shared, so an
 * await inside it would let another handler's writes land in — and be rolled back with — this import).
 * The dialog, the file read, the stores and the PDF scan are injected: `annotation-transfer.ipc.ts` passes the real
 * ones, the Main spike passes the real stores with a stubbed dialog.
 */
import {
  contentKeyOfNote,
  decidePlacement,
  embeddedAnnotationIdentities,
  parseAnnotationFile,
  planImport,
  type AnnotationFile,
  type ImportPlan,
  type RejectedAnnotation,
  type SaveHighlightInput,
} from '@reading-book/book-reader-sdk'
import type {
  AnnotationImportPreviewDto,
  AnnotationImportPreviewResult,
  AnnotationImportResult,
  AnnotationTransferErrorCode,
  AnnotationTransferProgressDto,
  OkResult,
} from '../ipc/api-types'
import type { TransferNoteRow } from '../persistence/sqlite-overlay-store'
import { identifyBook, type IdentifyLibrary } from './identify-book'

const TRANSFER_FORMATS: readonly string[] = ['epub', 'pdf', 'txt', 'md']

export interface ImportBookInfo {
  id: string
  title: string
  author?: string
  format: string
  sha256: string
  pageCount?: number
}

export interface ImportDeps {
  /** Native open dialog; the chosen path or null when the user cancelled. */
  pickFilePath(): Promise<string | null>
  /** The picked file's text (may throw: unreadable, too large). */
  readText(filePath: string): Promise<string>
  library: IdentifyLibrary
  findBook(bookId: string): Promise<ImportBookInfo | null>
  /** True when the book's own file can still be resolved (moved / deleted files are refused, nothing is written). */
  bookFileAvailable(bookId: string): Promise<boolean>
  /** TXT target: its current canonical text (the edited copy when there is one), for quote re-anchoring; null when unavailable. */
  txtText?(bookId: string): Promise<string | null>
  /**
   * PDF target: identity keys of the annotations found in a scan of the target file and the file's own page count (used when the
   * library does not know it); null when it cannot be scanned.
   */
  scanPdfKeys(bookId: string): Promise<{ keys: ReadonlySet<string>; pageCount?: number } | null>
  // ---- synchronous reads / writes (used inside the transaction) ----
  listRows(bookId: string): TransferNoteRow[]
  /** Cheap fingerprint of the book's annotation rows (ids + last-change times): the preview's freshness proof. */
  annotationStamp(bookId: string): string
  existingNoteIds(ids: readonly string[]): Set<string>
  bookSha256(bookId: string): string | undefined
  txtState(bookId: string): { revision: number; contentSha256?: string }
  /** Write one annotation row (`SqliteOverlayStore.writeHighlight`). */
  writeRow(input: SaveHighlightInput): void
  db: { exec(sql: string): void }
  newId(): string
  progress(event: AnnotationTransferProgressDto): void
}

interface Freshness {
  sha256: string
  txt?: { revision: number; contentSha256?: string }
  /** `annotationStamp` of the target when the preview was made. */
  rowsStamp: string
}

interface Session {
  id: string
  /** The book the import was started from (Reader menu); undefined for the Library action. */
  startedFrom?: { bookId: string; title: string }
  file: AnnotationFile
  rejected: RejectedAnnotation[]
  target: { book: ImportBookInfo; matchedBy: 'sha256' | 'title' | 'chosen' } | null
  requiresChoice: boolean
  fileBookMissing?: { title: string; author?: string }
  plan: ImportPlan
  freshness: Freshness | null
}

const EMPTY_PLAN: ImportPlan = { toAdd: [], present: 0, notPlaced: [] }

const MESSAGES: Partial<Record<AnnotationTransferErrorCode, string>> = {
  not_found: 'That book or import session was not found.',
  damaged: 'The file is damaged and cannot be imported.',
  newer_version: 'This file was made by a newer version of Readmate. Update the app to import it.',
  not_annotation_file: 'This is not a Readmate annotations file.',
  format_mismatch: 'The file and the book are different formats, so the annotations cannot be imported.',
  file_unavailable: 'The book file could not be found. Relink the book from the Library, then try again.',
  target_not_confirmed: 'Choose the book to import into first.',
  stale_preview: 'The book changed since the preview was made. Review the new preview and confirm again.',
  write_failed: 'The annotations could not be saved. Nothing was changed.',
  book_missing: 'The book this file belongs to is not in your library.',
}

function fail(errorCode: AnnotationTransferErrorCode, message?: string): { ok: false; errorCode: AnnotationTransferErrorCode; message?: string } {
  return { ok: false, errorCode, message: message ?? MESSAGES[errorCode] }
}

function keysOf(rows: readonly TransferNoteRow[]): Set<string> {
  const keys = new Set<string>()
  for (const row of rows) {
    const key = contentKeyOfNote(row.note)
    if (key) keys.add(key)
  }
  return keys
}

export interface ImportService {
  pickFile(input: { bookId?: string }): Promise<AnnotationImportPreviewResult>
  setTarget(sessionId: string, bookId: string): Promise<AnnotationImportPreviewResult>
  confirm(sessionId: string): Promise<AnnotationImportResult>
  discard(sessionId: string): OkResult
  cancel(sessionId: string): OkResult
  /** Drop every session of a book (it was removed from the library). */
  dropSessionsOfBook(bookId: string): void
}

export function createImportService(deps: ImportDeps): ImportService {
  const sessions = new Map<string, Session>()

  function toDto(s: Session): AnnotationImportPreviewDto {
    const dto: AnnotationImportPreviewDto = {
      sessionId: s.id,
      fileBook: { title: s.file.book.title, author: s.file.book.author, format: s.file.book.format },
      target: s.target ? { bookId: s.target.book.id, title: s.target.book.title, author: s.target.book.author, matchedBy: s.target.matchedBy } : null,
      requiresChoice: s.requiresChoice,
      toAdd: s.plan.toAdd.length,
      present: s.plan.present,
      notPlaced: [...s.plan.notPlaced],
    }
    if (s.startedFrom) dto.startedFrom = s.startedFrom
    if (s.fileBookMissing) dto.fileBookMissing = s.fileBookMissing
    return dto
  }

  /** Check the target, then plan against it. Does not touch the session. */
  async function planFor(
    file: AnnotationFile,
    rejected: readonly RejectedAnnotation[],
    book: ImportBookInfo,
  ): Promise<{ ok: true; plan: ImportPlan; freshness: Freshness } | { ok: false; errorCode: AnnotationTransferErrorCode; message?: string }> {
    if (!TRANSFER_FORMATS.includes(book.format) || book.format !== file.book.format) return fail('format_mismatch')
    if (!(await deps.bookFileAvailable(book.id))) return fail('file_unavailable')

    const rows = deps.listRows(book.id)
    const existingKeys = keysOf(rows)
    const txt = book.format === 'txt' ? deps.txtState(book.id) : undefined
    const scan = book.format === 'pdf' ? await deps.scanPdfKeys(book.id).catch(() => null) : null
    const scanKeys = new Set<string>()
    if (scan) for (const k of scan.keys) scanKeys.add(k)
    const pageCount = book.pageCount ?? scan?.pageCount

    const placement = decidePlacement(file, {
      title: book.title,
      author: book.author,
      format: book.format,
      sha256: book.sha256,
      pageCount,
      txtContentSha256: txt?.contentSha256,
    })
    // A TXT file that is not the text the annotations were made on is searched for each quote (FR-011); no text, nothing placed.
    const targetText = placement === 'txt-quote' ? ((await deps.txtText?.(book.id)) ?? undefined) : undefined
    const taken = deps.existingNoteIds(file.annotations.map((a) => a.sourceId))
    const plan = planImport({
      file,
      rejected,
      existingKeys,
      scanKeys,
      placement,
      targetPageCount: pageCount,
      targetText,
      isUsableId: (id) => !taken.has(id),
    })
    return { ok: true, plan, freshness: { sha256: book.sha256, txt, rowsStamp: deps.annotationStamp(book.id) } }
  }

  return {
    async pickFile(input) {
      const sessionId = deps.newId()
      deps.progress({ sessionId, phase: 'reading', done: 0, total: 1 })

      const picked = await deps.pickFilePath()
      if (!picked) return fail('cancelled')
      let text: string
      try {
        text = await deps.readText(picked)
      } catch {
        return fail('damaged', 'The file could not be read.')
      }

      const parsed = parseAnnotationFile(text)
      if (!parsed.ok) {
        const trimmed = text.trimStart()
        // Content decides, not the extension: text that is not JSON at all (a readable copy, a note) is not one of our files.
        const notJson = parsed.errorCode === 'damaged' && !(trimmed.startsWith('{') || trimmed.startsWith('['))
        const code: AnnotationTransferErrorCode = notJson ? 'not_annotation_file' : parsed.errorCode
        const readable = /\.(md|markdown)$/i.test(picked) && code === 'not_annotation_file'
        return fail(code, readable ? 'This is a readable copy of annotations. It cannot be imported; use the .readmate-notes.json file instead.' : undefined)
      }

      const startedFrom = input.bookId ? await deps.findBook(input.bookId) : null
      if (input.bookId && !startedFrom) return fail('not_found')

      const identified = await identifyBook(parsed.file.book, deps.library)
      const session: Session = {
        id: sessionId,
        startedFrom: startedFrom ? { bookId: startedFrom.id, title: startedFrom.title } : undefined,
        file: parsed.file,
        rejected: parsed.rejected,
        target: null,
        requiresChoice: false,
        plan: EMPTY_PLAN,
        freshness: null,
      }

      if (identified.found) {
        const book = await deps.findBook(identified.bookId)
        if (!book) return fail('not_found')
        // A file from another book than the one it was started from needs a deliberate choice (FR-010).
        session.requiresChoice = !!startedFrom && startedFrom.id !== book.id
        const planned = await planFor(parsed.file, parsed.rejected, book)
        if (!planned.ok) return planned
        session.target = { book, matchedBy: identified.matchedBy }
        session.plan = planned.plan
        session.freshness = planned.freshness
      } else {
        // The file's book is not in the library: no target until the user chooses another book of the same format.
        session.requiresChoice = true
        session.fileBookMissing = identified.missing
      }

      deps.progress({ sessionId, phase: 'planning', done: 1, total: 1 })
      sessions.set(sessionId, session)
      return { ok: true, preview: toDto(session) }
    },

    async setTarget(sessionId, bookId) {
      const session = sessions.get(sessionId)
      if (!session) return fail('not_found')
      const book = await deps.findBook(bookId)
      if (!book) return fail('not_found')
      const planned = await planFor(session.file, session.rejected, book)
      if (!planned.ok) return planned
      if (!sessions.has(sessionId)) return fail('cancelled')
      session.target = { book, matchedBy: 'chosen' }
      session.plan = planned.plan
      session.freshness = planned.freshness
      session.requiresChoice = false
      return { ok: true, preview: toDto(session) }
    },

    async confirm(sessionId) {
      const session = sessions.get(sessionId)
      if (!session) return fail('not_found')
      if (!session.target) return fail('book_missing')
      if (session.requiresChoice) return fail('target_not_confirmed')
      const { book } = session.target
      const freshness = session.freshness!
      const total = session.plan.toAdd.length
      deps.progress({ sessionId, phase: 'committing', done: 0, total })

      // From here to COMMIT / ROLLBACK there is no `await`.
      let added = 0
      deps.db.exec('BEGIN IMMEDIATE')
      try {
        const sha = deps.bookSha256(book.id)
        const txt = book.format === 'txt' ? deps.txtState(book.id) : undefined
        const stale =
          sha !== freshness.sha256 ||
          (freshness.txt && (txt?.revision !== freshness.txt.revision || txt?.contentSha256 !== freshness.txt.contentSha256)) ||
          deps.annotationStamp(book.id) !== freshness.rowsStamp
        if (stale) {
          deps.db.exec('ROLLBACK')
          return fail('stale_preview')
        }
        const taken = deps.existingNoteIds(session.plan.toAdd.flatMap((a) => (a.id ? [a.id] : [])))
        for (const a of session.plan.toAdd) {
          deps.writeRow({
            id: a.id && !taken.has(a.id) ? a.id : deps.newId(),
            bookId: book.id,
            locator: a.locator,
            styleKind: a.type,
            colorHex: a.colorHex,
            note: a.note,
            tags: a.tags,
            selectionText: a.selectionText,
            pdfAnnotation: a.pdfAnnotation,
            txtAnnotation: a.txtAnnotation,
            mdAnnotation: a.mdAnnotation,
            createdAt: a.createdAt,
          })
          added += 1
        }
        deps.db.exec('COMMIT')
      } catch (err) {
        try {
          deps.db.exec('ROLLBACK')
        } catch {
          // no transaction left to roll back
        }
        return fail('write_failed', err instanceof Error && err.message ? `The annotations could not be saved (${err.message}). Nothing was changed.` : undefined)
      }

      sessions.delete(sessionId)
      deps.progress({ sessionId, phase: 'committing', done: added, total })
      return { ok: true, added, present: session.plan.present, notPlaced: session.plan.notPlaced.length }
    },

    discard(sessionId) {
      sessions.delete(sessionId)
      return { ok: true }
    },

    cancel(sessionId) {
      sessions.delete(sessionId)
      return { ok: true }
    },

    dropSessionsOfBook(bookId) {
      for (const [id, s] of sessions) if (s.target?.book.id === bookId || s.startedFrom?.bookId === bookId) sessions.delete(id)
    },
  }
}

/** The identity keys of a scan of the PDF (`/NM` keys and the pre-`/NM` anchor keys), for "already in the file". */
export function scanKeysOf(items: Parameters<typeof embeddedAnnotationIdentities>[0]): Set<string> {
  const keys = new Set<string>()
  for (const id of embeddedAnnotationIdentities(items)) {
    keys.add(id.key)
    keys.add(id.legacyKey)
  }
  return keys
}
