/** Narrow Desktop API exposed to the renderer via contextBridge (`window.api`). */

export type DocumentFormatDto = 'epub' | 'pdf' | 'txt' | 'md' | 'docx'

export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform
}

/** Plain book metadata for IPC (not a domain class). */
export interface BookSummaryDto {
  id: string
  title: string
  format: DocumentFormatDto
  coverPath?: string
  addedAt: string
  updatedAt: string
}

export interface OkResult {
  ok: boolean
}

export interface ImportResult {
  ok: boolean
  bookId: string | null
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
