import path from 'node:path'
import { ipcMain } from 'electron'
import type { Book } from '@reading-book/domain'
import { coverUrlForBookId } from '../files/cover-protocol'
import { openBookContent } from '../files/open-book-content'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import type {
  BookSummaryDto,
  DocumentFormatDto,
  OkResult,
  OpenBookContentResult,
} from './api-types'
import { LibraryChannels } from './channels'

function toSummaryDto(
  book: Book,
  authorNames: string,
  genreNames: string[] = [],
  session?: { lastReadLocation?: string; lastReadAt?: string },
): BookSummaryDto {
  const fileName = path.basename(book.filePath)
  const dto: BookSummaryDto = {
    id: book.id,
    title: book.title,
    format: book.format as DocumentFormatDto,
    addedAt: book.addedAt,
    updatedAt: book.updatedAt,
    fileName,
    isFavorite: book.isFavorite,
  }
  if (book.coverPath) dto.coverUrl = coverUrlForBookId(book.id)
  if (authorNames.trim()) dto.author = authorNames
  if (book.fileSizeBytes != null) dto.fileSizeBytes = book.fileSizeBytes
  if (book.description) dto.description = book.description
  if (genreNames.length > 0) dto.genres = genreNames
  if (book.pageCount != null) dto.pageCount = book.pageCount
  if (session?.lastReadLocation) {
    dto.lastReadLocation = session.lastReadLocation
    dto.readingStatus = 'reading'
    if (session.lastReadAt) dto.lastReadAt = session.lastReadAt
  }
  return dto
}

/** Handlers for library:* — list/get from SQLite (T2.8). */
export function registerLibraryIpc(): void {
  ipcMain.removeHandler(LibraryChannels.listBooks)
  ipcMain.handle(LibraryChannels.listBooks, async (): Promise<BookSummaryDto[]> => {
    const rows = await getLibraryStore().listAll()
    return rows.map(({ book, authorNames, genreNames, session }) =>
      toSummaryDto(book, authorNames, genreNames, session),
    )
  })

  ipcMain.removeHandler(LibraryChannels.getBook)
  ipcMain.handle(
    LibraryChannels.getBook,
    async (_event, id: unknown): Promise<BookSummaryDto | null> => {
      if (typeof id !== 'string' || !id.trim()) return null
      const store = getLibraryStore()
      const book = await store.findById(id.trim())
      if (!book) return null
      const authorNames = store.authorNamesForBook(book.id)
      const genreNames = store.genreNamesForBook(book.id)
      const session = store.getReadingSessionSummary(book.id)
      return toSummaryDto(book, authorNames, genreNames, session)
    },
  )

  ipcMain.removeHandler(LibraryChannels.openBookContent)
  ipcMain.handle(
    LibraryChannels.openBookContent,
    async (_event, id: unknown): Promise<OpenBookContentResult> => {
      if (typeof id !== 'string' || !id.trim()) {
        return {
          ok: false,
          bookId: '',
          errorCode: 'not_found',
          errorMessage: 'Book not found.',
        }
      }
      return openBookContent(id.trim())
    },
  )

  ipcMain.removeHandler(LibraryChannels.markAsReading)
  ipcMain.handle(
    LibraryChannels.markAsReading,
    async (_event, id: unknown): Promise<OkResult> => {
      if (typeof id !== 'string' || !id.trim()) return { ok: false }
      const store = getLibraryStore()
      const book = await store.findById(id.trim())
      if (!book) return { ok: false }
      store.markAsReading(book.id)
      return { ok: true }
    },
  )

  ipcMain.removeHandler(LibraryChannels.deleteBook)
  ipcMain.handle(LibraryChannels.deleteBook, async (_event, _id: string): Promise<OkResult> => ({
    ok: true,
  }))
}
