/**
 * Export of a book's annotations to a `.readmate-notes.json` file (specs/006-annotation-import-export, US1).
 *
 * Reads only SQLite — never the book file, so it works when the file was moved or deleted. The save dialog,
 * the target check and the write are injected: `annotation-transfer.ipc.ts` passes the real ones (Electron
 * dialog, `writeFileSafely`), the Main spike passes stubs.
 */
import {
  FILE_EXTENSION,
  type AnnotationFile,
  buildAnnotationFile,
  isReadmateAuthoredKey,
  renderReadableMarkdown,
  serializeAnnotationFile,
  type ExportRow,
  type TransferBook,
  type TransferFormat,
} from '@reading-book/book-reader-sdk'
import type { EmbeddedAnnotationLedgerEntry } from '@reading-book/book-reader-sdk'
import type { AnnotationExportResult } from '../ipc/api-types'
import type { TransferNoteRow } from '../persistence/sqlite-overlay-store'

const TRANSFER_FORMATS: readonly string[] = ['epub', 'pdf', 'txt', 'md']

/** The slice of a library book export needs. */
export interface ExportBookInfo {
  id: string
  title: string
  author?: string
  format: string
  sha256: string
  pageCount?: number
}

export interface ExportDeps {
  findBook(bookId: string): Promise<ExportBookInfo | null>
  /** Annotation rows as stored (`SqliteOverlayStore.listAnnotationsForTransfer`). */
  listRows(bookId: string): TransferNoteRow[]
  /** PDF sync ledger of the book (`SqliteOverlayStore.listEmbeddedLedger`). */
  ledger(bookId: string): EmbeddedAnnotationLedgerEntry[]
  /** TXT: `txt_documents.content_sha256` of the edited copy, when there is one. */
  txtContentSha256(bookId: string): string | undefined
  /** Native save dialog (`kind` picks the file filter); resolves to the chosen path or null when the user cancelled. */
  chooseTarget(defaultFileName: string, kind: 'restore' | 'readable'): Promise<string | null>
  /** True when the chosen path must not be written (inside the app's own data folder). */
  isForbiddenTarget(target: string): boolean
  /** Atomic write (temp file + rename): no partial file is left on failure. */
  write(target: string, bytes: Uint8Array): Promise<void>
  appVersion: string
  now?: () => Date
}

/** `<title>.readmate-notes.json` with characters Windows forbids replaced. */
export function defaultRestoreFileName(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'book'
  return `${safe}${FILE_EXTENSION}`
}

/** `<title>.md` for the readable copy. */
export function defaultReadableFileName(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'book'
  return `${safe}.md`
}

/** The path the user picked, ending in `.md` (anything else gets `.md` appended). */
export function withReadableExtension(target: string): string {
  return target.toLowerCase().endsWith('.md') ? target : `${target}.md`
}

/** The path the user picked, ending in `.readmate-notes.json` (a plain `.json` is converted, anything else is appended). */
export function withRestoreExtension(target: string): string {
  if (target.toLowerCase().endsWith(FILE_EXTENSION)) return target
  return `${target.replace(/\.json$/i, '')}${FILE_EXTENSION}`
}

/**
 * PDF origin per row: `file` when the sync ledger links the row to annotations read from the PDF and none of those
 * keys is the key of an annotation Readmate wrote itself; every other row is `app`.
 */
function pdfOrigins(rows: readonly TransferNoteRow[], ledger: readonly EmbeddedAnnotationLedgerEntry[]): Map<string, { origin: 'file'; sourceKeys: string[] }> {
  const keysOf = new Map<string, string[]>()
  for (const e of ledger) keysOf.set(e.noteId, [...(keysOf.get(e.noteId) ?? []), e.sourceKey])
  const out = new Map<string, { origin: 'file'; sourceKeys: string[] }>()
  for (const row of rows) {
    const keys = keysOf.get(row.id)
    if (!keys?.length) continue
    if (keys.some((k) => isReadmateAuthoredKey(row.id, k))) continue
    out.set(row.id, { origin: 'file', sourceKeys: keys })
  }
  return out
}

type BuiltFile = { ok: true; file: AnnotationFile; exported: number } | { ok: false; errorCode: 'not_found' | 'empty'; message?: string }

/** Read the book's annotation rows (SQLite only — never the book file) and build the annotations file. */
async function buildFileFor(bookId: string, deps: ExportDeps): Promise<BuiltFile> {
  const book = await deps.findBook(bookId)
  if (!book || !TRANSFER_FORMATS.includes(book.format)) return { ok: false, errorCode: 'not_found' }
  const format = book.format as TransferFormat

  const stored = deps.listRows(book.id)
  const origins = format === 'pdf' ? pdfOrigins(stored, deps.ledger(book.id)) : new Map()
  const rows: ExportRow[] = stored.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    note: r.note,
    ...(origins.get(r.id) ?? {}),
  }))

  const header: TransferBook = { title: book.title, format, sha256: book.sha256 }
  if (book.author) header.author = book.author
  if (format === 'pdf' && book.pageCount && book.pageCount > 0) header.pageCount = book.pageCount

  const built = buildAnnotationFile({
    book: header,
    rows,
    txtContentSha256: format === 'txt' ? deps.txtContentSha256(book.id) : undefined,
    appVersion: deps.appVersion,
    now: (deps.now ?? (() => new Date()))(),
  })
  // Nothing to export: say so before any dialog is shown and write nothing.
  if (!built.ok) return { ok: false, errorCode: 'empty', message: 'This book has no annotations to export.' }
  return { ok: true, file: built.file, exported: built.exported }
}

/** Ask for a target, refuse the app's own data folder, write atomically. */
async function saveText(
  text: string,
  defaultName: string,
  kind: 'restore' | 'readable',
  deps: ExportDeps,
  withExtension: (target: string) => string,
): Promise<{ ok: true } | { ok: false; errorCode: 'cancelled' | 'write_failed'; message?: string }> {
  const picked = await deps.chooseTarget(defaultName, kind)
  if (!picked) return { ok: false, errorCode: 'cancelled' }
  const target = withExtension(picked)
  if (deps.isForbiddenTarget(target)) {
    return { ok: false, errorCode: 'write_failed', message: "Choose a folder outside the app's own data folder." }
  }
  try {
    await deps.write(target, new TextEncoder().encode(text))
  } catch (err) {
    return { ok: false, errorCode: 'write_failed', message: err instanceof Error ? err.message : 'The file could not be written.' }
  }
  return { ok: true }
}

export async function exportRestoreAnnotations(bookId: string, deps: ExportDeps): Promise<AnnotationExportResult> {
  const built = await buildFileFor(bookId, deps)
  if (!built.ok) return built
  const saved = await saveText(serializeAnnotationFile(built.file), defaultRestoreFileName(built.file.book.title), 'restore', deps, withRestoreExtension)
  return saved.ok ? { ok: true, exported: built.exported } : saved
}

/** The readable Markdown copy: quotes and comments in reading order. It cannot be imported. */
export async function exportReadableAnnotations(bookId: string, deps: ExportDeps): Promise<AnnotationExportResult> {
  const built = await buildFileFor(bookId, deps)
  if (!built.ok) return built
  // EPUB headings are `Chapter N` from the stored chapter index: Main has no EPUB table-of-contents reader (research R9, T048).
  const saved = await saveText(renderReadableMarkdown(built.file), defaultReadableFileName(built.file.book.title), 'readable', deps, withReadableExtension)
  return saved.ok ? { ok: true, exported: built.exported } : saved
}
