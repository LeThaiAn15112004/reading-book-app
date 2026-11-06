/**
 * `library.*` (spec 008, T058; `contracts/mobile-bridge.md`). Same validation and results as Desktop's
 * `library.ipc.ts`; the differences are Mobile's storage:
 *   - `openBookContent` fetches the bytes from the local server, or through `files.readChunk` in Expo Go;
 *   - `coverUrl` is built per launch (server) or is a `data:` URL (Expo Go), never stored;
 *   - `removeBook` removes the rows, then the app's copy and cover (FR-017h): every Mobile book is an app copy, and
 *     the original the user picked was never referenced. A file left behind is caught by the startup sweep.
 * Every write runs through the single write queue.
 */
import { checkMdFileSize, describeMdTooLarge } from '@core'
import { bytesToBase64 } from '../host/encoding'
import type { BookListItem } from '../stores/library-store'
import { idOf, type BridgeContext } from './context'
import { toSummaryDto, type BookSummaryDto } from './dto'
import { HostCallError } from './host-client'
import { notAvailable, notAvailableResult } from './unavailable'

type Library = Window['api']['library']
type OpenBookContentResult = Awaited<ReturnType<Library['openBookContent']>>

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const COVER_MAX_BYTES = 4 * 1024 * 1024

export function createLibraryGroup(ctx: BridgeContext): Library {
  const { library, writes } = ctx

  async function summary(item: BookListItem): Promise<BookSummaryDto> {
    const cover = item.book.coverPath ? await ctx.content.coverUrl(item.book.id, item.book.updatedAt) : undefined
    return toSummaryDto(item, cover)
  }

  const fail = (bookId: string, errorCode: NonNullable<OpenBookContentResult['errorCode']>, errorMessage: string): OpenBookContentResult => ({
    ok: false,
    bookId,
    errorCode,
    errorMessage,
  })

  return {
    async listBooks() {
      return Promise.all((await library.listItems()).map(summary))
    },

    async getBook(id) {
      const bookId = idOf(id)
      const item = bookId ? await library.getItem(bookId) : undefined
      return item ? summary(item) : null
    },

    async openBookContent(id) {
      const bookId = idOf(id)
      if (!bookId) return fail('', 'not_found', 'Book not found.')
      const book = await library.findById(bookId)
      if (!book) return fail(bookId, 'not_found', 'Book not found.')
      // TXT is read through txt.open; nothing is sent here, as on Desktop.
      if (book.format === 'txt') return { ok: true, bookId, format: 'txt', data: new ArrayBuffer(0), byteLength: 0 }
      if (book.format === 'md' && book.fileSizeBytes != null && !checkMdFileSize(book.fileSizeBytes).ok) return fail(bookId, 'too_large', describeMdTooLarge())
      let data: ArrayBuffer
      try {
        data = await ctx.content.read(bookId)
      } catch (error) {
        const code = error instanceof HostCallError ? error.code : ''
        if (code === 'NOT_FOUND') return fail(bookId, 'missing_file', 'The book file could not be found. It may have been moved, renamed, or deleted.')
        if (code === 'BOOK_TOO_LARGE_FOR_DEV') return fail(bookId, 'too_large', 'Books larger than 20 MB open only in the installed app, not in Expo Go.')
        return fail(bookId, 'read_failed', 'Could not read the book file.')
      }
      if (book.format === 'md' && !checkMdFileSize(data.byteLength).ok) return fail(bookId, 'too_large', describeMdTooLarge())
      return { ok: true, bookId, format: book.format as OpenBookContentResult['format'], data, byteLength: data.byteLength }
    },

    markAsReading: (id) =>
      writes.run(async () => {
        const bookId = idOf(id)
        if (!bookId || !(await library.findById(bookId))) return { ok: false }
        await library.markAsReading(bookId)
        return { ok: true }
      }),

    markAsCompleted: (id) =>
      writes.run(async () => {
        const bookId = idOf(id)
        if (!bookId || !(await library.findById(bookId))) return { ok: false }
        await library.setReadingStatus(bookId, 'completed')
        return { ok: true }
      }),

    setFavorite: (id, value) =>
      writes.run(async () => {
        const bookId = idOf(id)
        if (!bookId || typeof value !== 'boolean' || !(await library.findById(bookId))) return { ok: false }
        await library.setFavorite(bookId, value)
        return { ok: true }
      }),

    /** A cover rendered by the UI; refused when the book already has one (Desktop's rule). File first, then row. */
    setGeneratedCover: (id, png) =>
      writes.run(async () => {
        const bookId = idOf(id)
        if (!bookId || !(png instanceof ArrayBuffer)) return { ok: false }
        const bytes = new Uint8Array(png)
        if (bytes.length <= 8 || bytes.length > COVER_MAX_BYTES || PNG_MAGIC.some((b, i) => bytes[i] !== b)) return { ok: false }
        const book = await library.findById(bookId)
        if (!book || book.coverPath) return { ok: false }
        try {
          await ctx.client.call('files', 'writeCover', { bookId, base64: bytesToBase64(bytes) })
          await library.setCoverPath(bookId)
          return { ok: true }
        } catch {
          return { ok: false }
        }
      }),

    updateMetadata: (input) =>
      writes.run(async () => {
        const value = (input && typeof input === 'object' ? input : {}) as Partial<Parameters<Library['updateMetadata']>[0]>
        const bookId = idOf(value.id)
        if (!bookId || typeof value.title !== 'string' || !value.title.trim()) return { ok: false }
        const ok = await library.updateLibraryMetadata(bookId, {
          title: value.title,
          description: typeof value.description === 'string' ? value.description : null,
          pageCount: typeof value.pageCount === 'number' ? value.pageCount : null,
          authorNames: typeof value.author === 'string' ? [value.author] : [],
          genreNames: Array.isArray(value.genres) ? value.genres.filter((g): g is string => typeof g === 'string') : [],
        })
        return { ok }
      }),

    removeBook: (id) =>
      writes.run(async () => {
        const bookId = idOf(id)
        if (!bookId || !(await library.findById(bookId))) return { ok: false }
        // Rows first, in one transaction: a row pointing at no file can then never exist (data-model.md, Removal).
        await library.deleteCascade(bookId)
        try {
          await ctx.client.call('files', 'removeBook', { bookId })
        } catch (error) {
          // The book is gone from the library; its folder is removed by the next startup sweep.
          console.warn('[bridge] removing the book files failed; the startup sweep will remove them', error)
        }
        return { ok: true }
      }),

    async listCollections() {
      return library.listCollections()
    },

    createCollection: (input) =>
      writes.run(async () => {
        const value = (input && typeof input === 'object' ? input : {}) as { name?: unknown; description?: unknown }
        if (typeof value.name !== 'string' || !value.name.trim()) throw new Error('Collection name is required')
        return library.createCollection({ name: value.name, description: typeof value.description === 'string' ? value.description : undefined }, ctx.newId())
      }),

    updateCollection: (collectionId, input) =>
      writes.run(async () => {
        const id = idOf(collectionId)
        const value = (input && typeof input === 'object' ? input : {}) as { name?: unknown; description?: unknown }
        if (!id || typeof value.name !== 'string' || !value.name.trim()) return null
        return (await library.updateCollection(id, { name: value.name, description: typeof value.description === 'string' ? value.description : undefined })) ?? null
      }),

    deleteCollection: (collectionId) =>
      writes.run(async () => {
        const id = idOf(collectionId)
        return { ok: id ? await library.deleteCollection(id) : false }
      }),

    addBookToCollection: (collectionId, bookIdRaw) =>
      writes.run(async () => {
        const id = idOf(collectionId)
        const bookId = idOf(bookIdRaw)
        if (!id || !bookId || !(await library.collectionExists(id)) || !(await library.findById(bookId))) return { ok: false }
        await library.addBookToCollection(id, bookId)
        return { ok: true }
      }),

    removeBookFromCollection: (collectionId, bookIdRaw) =>
      writes.run(async () => {
        const id = idOf(collectionId)
        const bookId = idOf(bookIdRaw)
        return { ok: id && bookId ? await library.removeBookFromCollection(id, bookId) : false }
      }),

    showInFolder: notAvailable('library.showInFolder'),
    copyFilePath: notAvailable('library.copyFilePath'),
    deleteBookFile: notAvailable('library.deleteBookFile'),
    removeAudiobook: notAvailable('library.removeAudiobook'),
    relinkBook: notAvailableResult('library.relinkBook'),
    checkSignature: notAvailableResult('library.checkSignature'),
  }
}
