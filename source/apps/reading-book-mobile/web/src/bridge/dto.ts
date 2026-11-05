/**
 * Store records → Desktop's DTOs (`electron/ipc/api-types.ts`), with the same rules as Desktop's Main handlers
 * (`library.ipc.ts`, `overlay.ipc.ts`): optional fields only when set, locators as JSON strings, PDF / TXT / Markdown
 * payloads packed by the SDK. DTOs stay plain, structured-clone-safe objects; no path ever reaches them.
 */
import {
  Location,
  packMdAnnotationRef,
  packPdfAnnotationRef,
  packTxtAnnotationRef,
  type BookmarkRecord,
  type HighlightRecord,
  type NoteLocator,
  type NoteSelectionText,
} from '@reading-book/book-reader-sdk'
import type { BookListItem } from '../stores/library-store'
import type { SessionRecord } from '../stores/overlay-store'

type Api = Window['api']
export type BookSummaryDto = Awaited<ReturnType<Api['library']['getBook']>> & object
export type BookmarkDto = Awaited<ReturnType<Api['overlay']['listBookmarks']>>[number]
export type HighlightDto = Awaited<ReturnType<Api['overlay']['listHighlights']>>[number]
export type ReadingSessionStateDto = NonNullable<Awaited<ReturnType<Api['overlay']['getSessionState']>>>
export type OkResult = Awaited<ReturnType<Api['library']['markAsReading']>>

export function toSummaryDto(item: BookListItem, coverUrl: string | undefined): BookSummaryDto {
  const { book, authorNames, genreNames, session, readingStatus } = item
  const dto: BookSummaryDto = {
    id: book.id,
    title: book.title,
    format: book.format as BookSummaryDto['format'],
    addedAt: book.addedAt,
    updatedAt: book.updatedAt,
    // The stored path is `books/{id}/file`, which says nothing; Library search matches the title and format instead.
    fileName: `${book.title}.${book.format}`,
    isFavorite: book.isFavorite,
    readingStatus,
    // Every Mobile book is an app copy, but `managed` would offer Desktop's "Delete file", which Mobile does not have:
    // on Mobile, Remove already deletes the copy (FR-017h).
    fileStorage: 'referenced',
  }
  if (coverUrl) dto.coverUrl = coverUrl
  if (authorNames.trim()) dto.author = authorNames
  if (book.fileSizeBytes != null) dto.fileSizeBytes = book.fileSizeBytes
  if (book.description) dto.description = book.description
  if (genreNames.length > 0) dto.genres = genreNames
  if (book.pageCount != null) dto.pageCount = book.pageCount
  if (session?.lastReadLocation) {
    dto.lastReadLocation = session.lastReadLocation
    if (session.lastReadAt) dto.lastReadAt = session.lastReadAt
    if (session.progressPercent != null) dto.progressPercent = session.progressPercent
  }
  return dto
}

export function toSessionDto(state: SessionRecord): ReadingSessionStateDto {
  const dto: ReadingSessionStateDto = { bookId: state.bookId, percent: state.percent, isLandscape: state.isLandscape, updatedAt: state.updatedAt }
  if (state.lastReadLocation) dto.lastReadLocation = state.lastReadLocation
  if (state.lastReadLabel) dto.lastReadLabel = state.lastReadLabel
  if (state.fontFamily) dto.fontFamily = state.fontFamily
  if (state.fontSize != null) dto.fontSize = state.fontSize
  if (state.fontWeight) dto.fontWeight = state.fontWeight
  if (state.lineHeight != null) dto.lineHeight = state.lineHeight
  if (state.textAlign) dto.textAlign = state.textAlign
  if (state.layoutMode) dto.layoutMode = state.layoutMode
  if (state.pageTurnMode) dto.pageTurnMode = state.pageTurnMode
  if (state.marginsEnabled != null) dto.marginsEnabled = state.marginsEnabled
  if (state.marginPreset) dto.marginPreset = state.marginPreset
  return dto
}

export function toBookmarkDto(bookmark: BookmarkRecord): BookmarkDto {
  const dto: BookmarkDto = { id: bookmark.id, bookId: bookmark.bookId, locatorRef: JSON.stringify(bookmark.locator), createdAt: bookmark.createdAt }
  if (bookmark.label) dto.label = bookmark.label
  if (bookmark.excerpt) dto.excerpt = bookmark.excerpt
  return dto
}

export function toHighlightDto(highlight: HighlightRecord): HighlightDto {
  const dto: HighlightDto = {
    id: highlight.id,
    bookId: highlight.bookId,
    locatorRef: JSON.stringify(highlight.locator),
    styleKind: highlight.styleKind,
    colorHex: highlight.colorHex,
    tags: highlight.tags,
    createdAt: highlight.createdAt,
    updatedAt: highlight.updatedAt,
  }
  if (highlight.note) dto.note = highlight.note
  if (highlight.selectionText) dto.selectionTextRef = JSON.stringify(highlight.selectionText)
  if (highlight.pdfAnnotation) dto.pdfAnnotationRef = packPdfAnnotationRef(highlight.pdfAnnotation)
  if (highlight.txtAnnotation) dto.txtAnnotationRef = packTxtAnnotationRef(highlight.txtAnnotation)
  if (highlight.mdAnnotation) dto.mdAnnotationRef = packMdAnnotationRef(highlight.mdAnnotation)
  return dto
}

/** Desktop's parseLocatorRef: a valid `Location` JSON, else undefined (rejected at the boundary). */
export function parseLocatorRef(raw: unknown): NoteLocator | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  try {
    Location.parse(raw)
    return JSON.parse(raw) as NoteLocator
  } catch {
    return undefined
  }
}

export function parseSelectionTextRef(raw: unknown): NoteSelectionText | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  try {
    return JSON.parse(raw) as NoteSelectionText
  } catch {
    return undefined
  }
}
