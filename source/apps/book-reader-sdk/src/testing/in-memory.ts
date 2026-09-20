import { SdkError } from '../core/errors.js'
import type { BookmarkRecord } from '../domain/annotation/bookmark.js'
import type { HighlightRecord } from '../domain/annotation/highlight.js'
import type { Book, BookAuthor, BookGenre, ReadingSessionState } from '../domain/index.js'
import type { LibraryStore } from '../domain-ports/library-store.js'
import type { OverlayStore, SaveBookmarkInput, SaveHighlightInput } from '../domain-ports/overlay-store.js'
import type { FileRef, FileSystemAdapter } from '../ports/file-system.js'
import type { StorageAdapter } from '../ports/storage.js'

/** JSON round-trip copy: proves adapters never share mutable objects with the stores. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

let nextId = 1
function mintId(prefix: string): string {
  return `${prefix}-${nextId++}`
}

export interface InMemoryStorage extends StorageAdapter {
  /** Raw tables, for assertions in tests. */
  readonly tables: {
    books: Map<string, Book>
    bookAuthors: Map<string, BookAuthor[]>
    bookGenres: Map<string, BookGenre[]>
    bookmarks: Map<string, BookmarkRecord>
    highlights: Map<string, HighlightRecord>
    sessions: Map<string, ReadingSessionState>
  }
}

/**
 * Reference `StorageAdapter` — the executable spec of the storage ports, and a working backend
 * for prototypes, Storybook and tests. Data lives only as long as the object.
 */
export function createInMemoryStorage(): InMemoryStorage {
  const books = new Map<string, Book>()
  const bookAuthors = new Map<string, BookAuthor[]>()
  const bookGenres = new Map<string, BookGenre[]>()
  const bookmarks = new Map<string, BookmarkRecord>()
  const highlights = new Map<string, HighlightRecord>()
  const sessions = new Map<string, ReadingSessionState>()

  const byBook = <T extends { bookId: string; createdAt: string }>(map: Map<string, T>, bookId: string) =>
    [...map.values()]
      .filter((row) => row.bookId === bookId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone)

  const library: LibraryStore = {
    findById: async (id) => (books.has(id) ? clone(books.get(id) as Book) : undefined),
    findBySha256: async (sha256) => {
      const found = [...books.values()].find((b) => b.sha256 === sha256)
      return found ? clone(found) : undefined
    },
    findByAuthor: async (authorId) => {
      const bookIds = [...bookAuthors.entries()]
        .filter(([, links]) => links.some((l) => l.authorId === authorId))
        .map(([bookId]) => bookId)
      return bookIds.map((id) => books.get(id)).filter((b): b is Book => b !== undefined).map(clone)
    },
    save: async (book) => {
      books.set(book.id, clone(book))
    },
    linkAuthors: async (bookId, authors) => {
      bookAuthors.set(bookId, clone(authors))
    },
    linkGenres: async (bookId, genres) => {
      bookGenres.set(bookId, clone(genres))
    },
    deleteCascade: async (bookId) => {
      books.delete(bookId)
      bookAuthors.delete(bookId)
      bookGenres.delete(bookId)
      sessions.delete(bookId)
      for (const [key, row] of [...bookmarks]) if (row.bookId === bookId) bookmarks.delete(key)
      for (const [key, row] of [...highlights]) if (row.bookId === bookId) highlights.delete(key)
    },
  }

  const saveBookmark = async (input: SaveBookmarkInput): Promise<BookmarkRecord> => {
    if (highlights.has(input.id ?? '')) {
      throw new SdkError('STORAGE_FAILED', `note ${input.id} exists but is not a bookmark`)
    }
    const id = input.id ?? mintId('bookmark')
    const existing = bookmarks.get(id)
    const now = new Date().toISOString()
    const record: BookmarkRecord = {
      id,
      bookId: input.bookId,
      locator: input.locator,
      label: input.label,
      excerpt: input.excerpt,
      createdAt: existing?.createdAt ?? input.createdAt ?? now,
    }
    bookmarks.set(id, clone(record))
    return clone(record)
  }

  const saveHighlight = async (input: SaveHighlightInput): Promise<HighlightRecord> => {
    if (bookmarks.has(input.id ?? '')) {
      throw new SdkError('STORAGE_FAILED', `note ${input.id} exists but is not a highlight`)
    }
    const id = input.id ?? mintId('highlight')
    const existing = highlights.get(id)
    const now = new Date().toISOString()
    const record: HighlightRecord = {
      id,
      bookId: input.bookId,
      locator: input.locator,
      styleKind: input.styleKind,
      colorHex: input.colorHex,
      note: input.note,
      tags: input.tags ? [...input.tags] : [],
      selectionText: input.selectionText,
      createdAt: existing?.createdAt ?? input.createdAt ?? now,
      updatedAt: now,
    }
    highlights.set(id, clone(record))
    return clone(record)
  }

  const overlays: OverlayStore = {
    getSessionState: async (bookId) => (sessions.has(bookId) ? clone(sessions.get(bookId) as ReadingSessionState) : undefined),
    saveSessionState: async (session) => {
      sessions.set(session.bookId, clone(session))
    },
    listBookmarks: (bookId) => Promise.resolve(byBook(bookmarks, bookId)),
    saveBookmark,
    deleteBookmark: async (bookId, id) => bookmarks.get(id)?.bookId === bookId && bookmarks.delete(id),
    listHighlights: (bookId) => Promise.resolve(byBook(highlights, bookId)),
    saveHighlight,
    deleteHighlight: async (bookId, id) => highlights.get(id)?.bookId === bookId && highlights.delete(id),
  }

  return {
    tables: { books, bookAuthors, bookGenres, bookmarks, highlights, sessions },
    library,
    overlays,
  }
}

export interface InMemoryFileSystem extends FileSystemAdapter {
  readonly files: Map<FileRef, Uint8Array>
}

/** Reference `FileSystemAdapter`; sandbox refs are `sandbox://<name>`. */
export function createInMemoryFileSystem(initial: Record<FileRef, Uint8Array> = {}): InMemoryFileSystem {
  const files = new Map<FileRef, Uint8Array>(Object.entries(initial))
  const read = (ref: FileRef) => {
    const bytes = files.get(ref)
    if (!bytes) throw new SdkError('NOT_FOUND', `No such file: ${ref}`)
    return bytes
  }
  return {
    files,
    readBytes: async (ref) => read(ref).slice(),
    copyToSandbox: async (source, targetName) => {
      const ref = `sandbox://${targetName}`
      files.set(ref, read(source).slice())
      return ref
    },
    writeSandboxFile: async (targetName, bytes) => {
      const ref = `sandbox://${targetName}`
      files.set(ref, bytes.slice())
      return ref
    },
    removeSandboxFile: async (ref) => {
      if (!ref.startsWith('sandbox://')) {
        throw new SdkError('INVALID_ARGUMENT', `Refusing to delete a non-sandbox file: ${ref}`)
      }
      files.delete(ref)
    },
    exists: async (ref) => files.has(ref),
  }
}
