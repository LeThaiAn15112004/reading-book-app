import { randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { SUPPORTED_FORMATS } from '@reading-book/config'
import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import type { Book } from '@reading-book/book-reader-sdk'
import { coverUrlForBookId } from '../files/cover-protocol'
import { openBookContent } from '../files/open-book-content'
import { relinkBookToFile } from '../files/relink-book'
import { checkBookSignature, toSignatureDto } from '../signature/book-signature'
import {
  bookFileStorage,
  checkRegisteredBookPath,
  ensureCoversDir,
  removeCoverFile,
  removeManagedBookDir,
} from '../files/sandbox'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import { cancelTranscriptionOfBook } from '../transcription/transcription-runtime'
import { removeTxtData } from '../txt/txt-runtime'
import type {
  BookSummaryDto,
  CheckSignatureResult,
  CollectionSummaryDto,
  DocumentFormatDto,
  OkResult,
  OpenBookContentResult,
  ReadingStatusDto,
  RelinkBookResult,
  UpdateBookMetadataInput,
} from './api-types'
import { LibraryChannels } from './channels'

function toSummaryDto(
  book: Book,
  authorNames: string,
  genreNames: string[] = [],
  session?: { lastReadLocation?: string; lastReadAt?: string; progressPercent?: number },
  readingStatus: ReadingStatusDto = 'not-started',
  chapterCount = 0,
): BookSummaryDto {
  // A multi-chapter audiobook's `file_path` is its first chapter file: that name says nothing about the whole book.
  const fileName = chapterCount > 0 ? book.title : path.basename(book.filePath)
  const dto: BookSummaryDto = {
    id: book.id,
    title: book.title,
    format: book.format as DocumentFormatDto,
    addedAt: book.addedAt,
    updatedAt: book.updatedAt,
    fileName,
    isFavorite: book.isFavorite,
    readingStatus,
    fileStorage: bookFileStorage(book.filePath),
  }
  if (chapterCount > 0) dto.chapterCount = chapterCount
  if (book.coverPath) dto.coverUrl = coverUrlForBookId(book.id)
  if (authorNames.trim()) dto.author = authorNames
  if (book.fileSizeBytes != null) dto.fileSizeBytes = book.fileSizeBytes
  if (book.description) dto.description = book.description
  if (genreNames.length > 0) dto.genres = genreNames
  if (book.pageCount != null) dto.pageCount = book.pageCount
  if (book.signature) dto.signature = toSignatureDto(book.signature)
  if (session?.lastReadLocation) {
    dto.lastReadLocation = session.lastReadLocation
    if (session.lastReadAt) dto.lastReadAt = session.lastReadAt
    if (session.progressPercent != null) dto.progressPercent = session.progressPercent
  }
  if (book.sourceProvider === 'google_drive' || book.sourceProvider === 'dropbox' || book.sourceProvider === 'onedrive') {
    dto.sourceProvider = book.sourceProvider
  }
  if (book.externalId) dto.externalId = book.externalId
  return dto
}

/** Handlers for library:* — list/get from SQLite (T2.8). */
export function registerLibraryIpc(): void {
  ipcMain.removeHandler(LibraryChannels.listBooks)
  ipcMain.handle(LibraryChannels.listBooks, async (): Promise<BookSummaryDto[]> => {
    const store = getLibraryStore()
    const rows = await store.listAll()
    const chapterCounts = store.audioChapterCounts()
    return rows.map(({ book, authorNames, genreNames, session, readingStatus }) =>
      toSummaryDto(book, authorNames, genreNames, session, readingStatus, chapterCounts.get(book.id) ?? 0),
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
      const readingStatus = store.readingStatusForBook(book.id)
      const chapterCount = store.audioChapterCounts().get(book.id) ?? 0
      return toSummaryDto(book, authorNames, genreNames, session, readingStatus, chapterCount)
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

  ipcMain.removeHandler(LibraryChannels.checkSignature)
  ipcMain.handle(
    LibraryChannels.checkSignature,
    async (_event, id: unknown): Promise<CheckSignatureResult> => {
      if (typeof id !== 'string' || !id.trim()) return { ok: false, errorCode: 'not_found' }
      return checkBookSignature(id.trim())
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

  ipcMain.removeHandler(LibraryChannels.markAsCompleted)
  ipcMain.handle(
    LibraryChannels.markAsCompleted,
    async (_event, id: unknown): Promise<OkResult> => {
      if (typeof id !== 'string' || !id.trim()) return { ok: false }
      const store = getLibraryStore()
      if (!(await store.findById(id.trim()))) return { ok: false }
      store.setReadingStatus(id.trim(), 'completed')
      return { ok: true }
    },
  )

  ipcMain.removeHandler(LibraryChannels.setGeneratedCover)
  ipcMain.handle(
    LibraryChannels.setGeneratedCover,
    async (_event, id: unknown, png: unknown): Promise<OkResult> => {
      if (typeof id !== 'string' || !id.trim() || !(png instanceof ArrayBuffer)) {
        return { ok: false }
      }
      const bytes = Buffer.from(png)
      const isPng =
        bytes.length > 8 &&
        bytes.length <= 4 * 1024 * 1024 &&
        bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      if (!isPng) return { ok: false }
      const store = getLibraryStore()
      const book = await store.findById(id.trim())
      if (!book || book.coverPath) return { ok: false }
      const dest = path.join(ensureCoversDir(), `${randomUUID()}.png`)
      await fsp.writeFile(dest, bytes)
      store.setCoverPath(book.id, dest)
      return { ok: true }
    },
  )

  ipcMain.removeHandler(LibraryChannels.setFavorite)
  ipcMain.handle(
    LibraryChannels.setFavorite,
    async (_event, id: unknown, value: unknown): Promise<OkResult> => {
      if (
        typeof id !== 'string' ||
        !id.trim() ||
        typeof value !== 'boolean'
      ) {
        return { ok: false }
      }
      const store = getLibraryStore()
      if (!(await store.findById(id.trim()))) return { ok: false }
      store.setFavorite(id.trim(), value)
      return { ok: true }
    },
  )

  ipcMain.removeHandler(LibraryChannels.updateMetadata)
  ipcMain.handle(
    LibraryChannels.updateMetadata,
    async (_event, input: unknown): Promise<OkResult> => {
      if (!input || typeof input !== 'object') return { ok: false }
      const value = input as Partial<UpdateBookMetadataInput>
      if (
        typeof value.id !== 'string' ||
        !value.id.trim() ||
        typeof value.title !== 'string' ||
        !value.title.trim()
      ) {
        return { ok: false }
      }
      const store = getLibraryStore()
      const id = value.id.trim()
      if (!(await store.findById(id))) return { ok: false }
      store.updateLibraryMetadata(id, {
        title: value.title,
        description:
          typeof value.description === 'string' ? value.description : null,
        pageCount:
          typeof value.pageCount === 'number' ? value.pageCount : null,
      })
      store.replaceAuthorsByName(
        id,
        typeof value.author === 'string' ? [value.author] : [],
      )
      store.setGenres(
        id,
        Array.isArray(value.genres)
          ? value.genres.filter((genre): genre is string => typeof genre === 'string')
          : [],
      )
      return { ok: true }
    },
  )

  ipcMain.removeHandler(LibraryChannels.showInFolder)
  ipcMain.handle(
    LibraryChannels.showInFolder,
    async (_event, id: unknown): Promise<OkResult> => {
      if (typeof id !== 'string' || !id.trim()) return { ok: false }
      const book = await getLibraryStore().findById(id.trim())
      if (!book) return { ok: false }
      // Path check only (no disk access): for a moved file this still opens the last known folder.
      const checked = checkRegisteredBookPath(book.filePath, book.format)
      if (!checked.ok) return { ok: false }
      shell.showItemInFolder(checked.path)
      return { ok: true }
    },
  )

  ipcMain.removeHandler(LibraryChannels.copyFilePath)
  ipcMain.handle(
    LibraryChannels.copyFilePath,
    async (_event, id: unknown): Promise<OkResult> => {
      if (typeof id !== 'string' || !id.trim()) return { ok: false }
      const book = await getLibraryStore().findById(id.trim())
      if (!book) return { ok: false }
      const checked = checkRegisteredBookPath(book.filePath, book.format)
      if (!checked.ok) return { ok: false }
      // A multi-chapter audiobook is a folder of files: copying chapter 0's path would name only a part of it.
      clipboard.writeText(getLibraryStore().hasAudioChapters(book.id) ? path.dirname(checked.path) : checked.path)
      return { ok: true }
    },
  )

  ipcMain.removeHandler(LibraryChannels.removeBook)
  ipcMain.handle(
    LibraryChannels.removeBook,
    async (_event, id: unknown): Promise<OkResult> => {
      if (typeof id !== 'string' || !id.trim()) return { ok: false }
      const store = getLibraryStore()
      const book = await store.findById(id.trim())
      if (!book) return { ok: false }
      // A multi-chapter audiobook's files are all app-owned: dropping only the record would orphan them.
      // The UI offers `removeAudiobook` for it instead.
      if (store.hasAudioChapters(book.id)) return { ok: false }
      // A queued or running transcription of this audiobook is stopped first (FR-015): it must not keep reading a book that is gone.
      await cancelTranscriptionOfBook(book.id)
      await store.deleteCascade(book.id)
      // The book file is kept (sandbox copy or the user's own); only app-owned data goes: the cover
      // and, for TXT, the edited copy.
      await removeCoverFile(book.coverPath)
      await removeTxtData(book.id)
      return { ok: true }
    },
  )

  ipcMain.removeHandler(LibraryChannels.deleteBookFile)
  ipcMain.handle(
    LibraryChannels.deleteBookFile,
    async (_event, id: unknown): Promise<OkResult> => {
      if (typeof id !== 'string' || !id.trim()) return { ok: false }
      const store = getLibraryStore()
      const book = await store.findById(id.trim())
      if (!book) return { ok: false }
      if (store.hasAudioChapters(book.id)) return { ok: false } // see removeAudiobook
      // Only app-owned copies are ever deleted. A referenced book's file — and its parent
      // folder — belong to the user; removeManagedBookDir enforces that a second time.
      if (bookFileStorage(book.filePath) !== 'managed') return { ok: false }
      await cancelTranscriptionOfBook(book.id) // before the file goes: a running transcription reads it
      if (!(await removeManagedBookDir(book.filePath))) return { ok: false }
      await store.deleteCascade(book.id)
      await removeCoverFile(book.coverPath)
      await removeTxtData(book.id)
      return { ok: true }
    },
  )

  ipcMain.removeHandler(LibraryChannels.removeAudiobook)
  ipcMain.handle(
    LibraryChannels.removeAudiobook,
    async (_event, id: unknown): Promise<OkResult> => {
      if (typeof id !== 'string' || !id.trim()) return { ok: false }
      const store = getLibraryStore()
      const book = await store.findById(id.trim())
      if (!book || !store.hasAudioChapters(book.id)) return { ok: false }
      // Folder first, record second: if the files cannot be removed the record stays (nothing becomes unreachable)
      // and the user can retry. removeManagedBookDir refuses anything but `{sandbox}/{uuid}/{file}`. The user's
      // original ZIP is not referenced anywhere after the import and is never touched.
      try {
        if (bookFileStorage(book.filePath) !== 'managed') return { ok: false }
        // A transcription of this audiobook reads these very files: stop it (and wait for it) before they are removed.
        await cancelTranscriptionOfBook(book.id)
        if (!(await removeManagedBookDir(book.filePath))) return { ok: false }
      } catch {
        return { ok: false }
      }
      await store.deleteCascade(book.id) // chapter rows cascade
      await removeCoverFile(book.coverPath)
      return { ok: true }
    },
  )

  ipcMain.removeHandler(LibraryChannels.relinkBook)
  ipcMain.handle(
    LibraryChannels.relinkBook,
    async (event, id: unknown): Promise<RelinkBookResult> => {
      const notFound: RelinkBookResult = {
        ok: false,
        errorCode: 'not_found',
        errorMessage: 'Book not found.',
      }
      if (typeof id !== 'string' || !id.trim()) return notFound
      const book = await getLibraryStore().findById(id.trim())
      if (!book) return notFound
      if (getLibraryStore().hasAudioChapters(book.id)) {
        // Its identity is the hash of an ordered list of files, not of one file: there is nothing to match a picked file against.
        return {
          ok: false,
          errorCode: 'wrong_file',
          errorMessage: 'An audiobook made of several chapter files cannot be relinked.',
        }
      }

      // The renderer only ever names a book id — the path comes from this native dialog.
      const descriptor = SUPPORTED_FORMATS.find((d) => d.format === book.format)
      const dialogOptions: Electron.OpenDialogOptions = {
        title: `Locate “${book.title}”`,
        properties: ['openFile'],
        filters: descriptor
          ? [
              {
                name: descriptor.displayName,
                extensions: descriptor.extensions.map((ext) => ext.replace(/^\./, '')),
              },
            ]
          : [],
      }
      const parent = BrowserWindow.fromWebContents(event.sender)
      const { canceled, filePaths } = parent
        ? await dialog.showOpenDialog(parent, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)
      if (canceled || filePaths.length === 0) {
        return { ok: false, errorCode: 'cancelled' }
      }
      return relinkBookToFile(book.id, filePaths[0])
    },
  )

  ipcMain.removeHandler(LibraryChannels.listCollections)
  ipcMain.handle(
    LibraryChannels.listCollections,
    async (): Promise<CollectionSummaryDto[]> =>
      getLibraryStore().listCollections(),
  )

  ipcMain.removeHandler(LibraryChannels.createCollection)
  ipcMain.handle(
    LibraryChannels.createCollection,
    async (_event, input: unknown): Promise<CollectionSummaryDto> => {
      const value =
        input && typeof input === 'object'
          ? (input as { name?: unknown; description?: unknown })
          : {}
      if (typeof value.name !== 'string' || !value.name.trim()) {
        throw new Error('Collection name is required')
      }
      return getLibraryStore().createCollection({
        name: value.name,
        description:
          typeof value.description === 'string' ? value.description : undefined,
      })
    },
  )

  ipcMain.removeHandler(LibraryChannels.updateCollection)
  ipcMain.handle(
    LibraryChannels.updateCollection,
    async (
      _event,
      collectionId: unknown,
      input: unknown,
    ): Promise<CollectionSummaryDto | null> => {
      const value =
        input && typeof input === 'object'
          ? (input as { name?: unknown; description?: unknown })
          : {}
      if (
        typeof collectionId !== 'string' ||
        !collectionId.trim() ||
        typeof value.name !== 'string' ||
        !value.name.trim()
      ) {
        return null
      }
      return (
        getLibraryStore().updateCollection(collectionId.trim(), {
          name: value.name,
          description:
            typeof value.description === 'string'
              ? value.description
              : undefined,
        }) ?? null
      )
    },
  )

  ipcMain.removeHandler(LibraryChannels.deleteCollection)
  ipcMain.handle(
    LibraryChannels.deleteCollection,
    async (_event, collectionId: unknown): Promise<OkResult> => {
      if (typeof collectionId !== 'string' || !collectionId.trim()) {
        return { ok: false }
      }
      return {
        ok: getLibraryStore().deleteCollection(collectionId.trim()),
      }
    },
  )

  ipcMain.removeHandler(LibraryChannels.addBookToCollection)
  ipcMain.handle(
    LibraryChannels.addBookToCollection,
    async (
      _event,
      collectionId: unknown,
      bookId: unknown,
    ): Promise<OkResult> => {
      if (
        typeof collectionId !== 'string' ||
        !collectionId.trim() ||
        typeof bookId !== 'string' ||
        !bookId.trim()
      ) {
        return { ok: false }
      }
      const store = getLibraryStore()
      const hasCollection = store
        .listCollections()
        .some((collection) => collection.id === collectionId.trim())
      if (!hasCollection || !(await store.findById(bookId.trim()))) {
        return { ok: false }
      }
      store.addBookToCollection(collectionId.trim(), bookId.trim())
      return { ok: true }
    },
  )

  ipcMain.removeHandler(LibraryChannels.removeBookFromCollection)
  ipcMain.handle(
    LibraryChannels.removeBookFromCollection,
    async (
      _event,
      collectionId: unknown,
      bookId: unknown,
    ): Promise<OkResult> => {
      if (
        typeof collectionId !== 'string' ||
        !collectionId.trim() ||
        typeof bookId !== 'string' ||
        !bookId.trim()
      ) {
        return { ok: false }
      }
      return {
        ok: getLibraryStore().removeBookFromCollection(
          collectionId.trim(),
          bookId.trim(),
        ),
      }
    },
  )
}
