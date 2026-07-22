/** Narrow Desktop API exposed to the renderer via contextBridge (`window.api`). */

export type DocumentFormatDto = 'epub' | 'pdf' | 'txt' | 'md' | 'docx' | 'doc'

export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform
}

/** Shelf / nav reading status (user-marked completed; not derived from %). */
export type ReadingStatusDto = 'reading' | 'completed' | 'not-started'

/** Plain book metadata for IPC (not a domain class). */
export interface BookSummaryDto {
  id: string
  title: string
  format: DocumentFormatDto
  coverPath?: string
  addedAt: string
  updatedAt: string
  /** Display author(s); optional until import metadata lands (G2). */
  author?: string
  /** Original filename for Library search (FR-08). */
  fileName?: string
  isFavorite?: boolean
  readingStatus?: ReadingStatusDto
  /** Human-readable last-read location; when set, enables Continue Reading. */
  lastReadLocation?: string
  lastReadAt?: string
  noteCount?: number
}

export interface OkResult {
  ok: boolean
}

/** Stable codes for import failures (URL download / copy / format / dedup). */
export type ImportErrorCode =
  | 'scheme'
  | 'timeout'
  | 'too_large'
  | 'network'
  | 'not_direct_file'
  | 'http_status'
  | 'copy_failed'
  | 'unsupported_format'
  /** SHA-256 already in library (BR-03); bookId is the existing row. */
  | 'duplicate'

export interface ImportResult {
  ok: boolean
  bookId: string | null
  errorCode?: ImportErrorCode
  /** Short user-facing message when ok is false. */
  errorMessage?: string
}

export interface MutationResult {
  ok: boolean
  id: string | null
}

/** Highlight or note row returned by overlay.list (stub shape). */
export interface AnnotationDto {
  id: string
  bookId: string
  kind: 'highlight' | 'note'
  selectedText?: string
  content?: string
  colorHex?: string
  createdAt: string
}

export interface BookmarkDto {
  id: string
  bookId: string
  label?: string
  createdAt: string
}

export interface AddHighlightInput {
  bookId: string
  selectedText: string
  colorHex: string
}

export interface AddNoteInput {
  bookId: string
  content: string
  selectedText?: string
}

export interface DesktopApi {
  ping(): Promise<'pong'>
  getAppInfo(): Promise<AppInfo>
  library: {
    listBooks(): Promise<BookSummaryDto[]>
    getBook(id: string): Promise<BookSummaryDto | null>
    deleteBook(id: string): Promise<OkResult>
  }
  import: {
    fromFile(): Promise<ImportResult>
    fromUrl(url: string): Promise<ImportResult>
  }
  overlay: {
    list(bookId: string): Promise<AnnotationDto[]>
    addHighlight(input: AddHighlightInput): Promise<MutationResult>
    addNote(input: AddNoteInput): Promise<MutationResult>
    listBookmarks(bookId: string): Promise<BookmarkDto[]>
  }
}
