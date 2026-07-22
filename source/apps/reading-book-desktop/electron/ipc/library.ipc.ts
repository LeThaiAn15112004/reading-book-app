import path from 'node:path'
import { ipcMain } from 'electron'
import type { Book } from '@reading-book/domain'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import type { BookSummaryDto, DocumentFormatDto, OkResult } from './api-types'
import { LibraryChannels } from './channels'

function toSummaryDto(book: Book, authorNames: string): BookSummaryDto {
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
  if (book.coverPath) dto.coverPath = book.coverPath
  if (authorNames.trim()) dto.author = authorNames
  return dto
}

/** Handlers for library:* — list/get from SQLite (T2.8). */
export function registerLibraryIpc(): void {
  ipcMain.removeHandler(LibraryChannels.listBooks)
  ipcMain.handle(LibraryChannels.listBooks, async (): Promise<BookSummaryDto[]> => {
    const rows = await getLibraryStore().listAll()
    return rows.map(({ book, authorNames }) => toSummaryDto(book, authorNames))
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
      return toSummaryDto(book, authorNames)
    },
  )

  ipcMain.removeHandler(LibraryChannels.deleteBook)
  ipcMain.handle(LibraryChannels.deleteBook, async (_event, _id: string): Promise<OkResult> => ({
    ok: true,
  }))
}
