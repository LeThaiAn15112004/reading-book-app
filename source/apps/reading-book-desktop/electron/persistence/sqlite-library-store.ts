import {
  Author,
  Book,
  BookAuthor,
  STARTED_LOCATION_LABEL,
  isAudioFormat,
  isDocumentFormat,
  isPersistedLocationJson,
  libraryCodec,
  libraryStatements as q,
  normalizeGenreNames,
  parseGenres,
  parseReadingState,
  signatureMetadataPatch,
  validateChapterRecords,
  type AudioChapterRecord,
  type BookMetadataJson,
  type BookSignatureInfo,
  type LibraryStore,
  type ReadingStateJson,
  type SyncSqlDriver,
} from '@reading-book/book-reader-sdk'
import type { Database as SqliteDatabase } from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { getDatabase } from './db'
import { createSyncSqlDriver } from './sql-driver'

// Rows, codecs and list shapes are core's (spec 009 T032); re-exported because Main imports them from here.
export type ReadingSessionSummary = libraryCodec.ReadingSessionSummary
export type BookListItem = libraryCodec.BookListItem
export type CollectionListItem = libraryCodec.CollectionListItem

type BookRow = libraryCodec.BookRow

/**
 * SQLite LibraryStore — T2.7 find + T2.8 save / linkAuthors / listAll.
 * Genres, reading state and the lesser book metadata live in JSON columns of `books`
 * (migration 020) instead of separate tables.
 */
export class SqliteLibraryStore implements LibraryStore {
  private readonly sql: SyncSqlDriver

  constructor(db: SqliteDatabase = getDatabase()) {
    this.sql = createSyncSqlDriver(db)
  }

  async findById(id: string): Promise<Book | undefined> {
    const row = this.sql.get<BookRow>(q.selectBookById(id))
    return row ? libraryCodec.bookFromRow(row) : undefined
  }

  async findBySha256(hash: string): Promise<Book | undefined> {
    const row = this.sql.get<BookRow>(q.selectBookBySha256(hash))
    return row ? libraryCodec.bookFromRow(row) : undefined
  }

  async findByAuthor(_authorId: string): Promise<Book[]> {
    throw new Error('SqliteLibraryStore.findByAuthor is not implemented yet')
  }

  /** Cloud Sources: find a book already imported from a given provider file (dedup lazy download). */
  async findByProviderAndExternalId(
    provider: string,
    externalId: string,
  ): Promise<Book | undefined> {
    const row = this.sql.get<BookRow>(q.selectBookByProviderAndExternalId(provider, externalId))
    return row ? libraryCodec.bookFromRow(row) : undefined
  }

  async save(book: Book): Promise<void> {
    this.sql.run(q.insertBook(libraryCodec.bookToRowValues(book, [])))
  }

  /**
   * Link book ↔ authors. Caller must ensure each authorId already exists in `authors`.
   */
  async linkAuthors(bookId: string, authors: BookAuthor[]): Promise<void> {
    this.sql.transaction(() => {
      for (const link of authors) {
        this.sql.run(q.insertBookAuthor(bookId, link.authorId, link.sortOrder))
      }
    })
  }

  /**
   * Port method kept for the SDK contract, but there is no `genres` table to link against any
   * more (migration 020): genres are names stored in `books.genres_json`.
   */
  async linkGenres(): Promise<void> {
    throw new Error(
      'SqliteLibraryStore.linkGenres is unsupported: genres live in books.genres_json — use persistImportedBook() or setGenres().',
    )
  }

  /**
   * Find author by case-insensitive name, or create a new row.
   */
  findOrCreateAuthorByName(name: string): Author {
    const trimmed = name.trim()
    if (!trimmed) {
      throw new Error('Author name must not be empty')
    }

    const existing = this.sql.get<{ id: string; name: string; sort_name: string | null; created_at: string }>(
      q.selectAuthorByName(trimmed),
    )

    if (existing) {
      return new Author({
        id: existing.id,
        name: existing.name,
        sortName: existing.sort_name ?? undefined,
        createdAt: existing.created_at,
      })
    }

    const author = Author.create(randomUUID(), trimmed)
    this.sql.run(q.insertAuthor(author.id, author.name, author.sortName ?? null, author.createdAt))
    return author
  }

  getReadingSessionSummary(bookId: string): ReadingSessionSummary | undefined {
    const row = this.sql.get<{ reading_state_json: string }>(q.selectBookReadingState(bookId))
    if (!row) return undefined
    return libraryCodec.sessionSummaryFromState(parseReadingState(row.reading_state_json))
  }

  /**
   * Merge `patch` into `reading_state_json` in one atomic statement. `json_patch` (RFC 7396)
   * overwrites the keys present in `patch` and keeps every other key.
   */
  private patchReadingState(bookId: string, patch: ReadingStateJson): void {
    this.sql.run(q.patchReadingState(bookId, patch))
  }

  /**
   * Mark book as in-progress (Library Reading shelf).
   * Does not overwrite a valid Location JSON (CFI); only fills empty with "Started".
   */
  markAsReading(bookId: string, now = new Date().toISOString()): void {
    this.setReadingStatus(bookId, 'reading', now)
    const row = this.sql.get<{ reading_state_json: string }>(q.selectBookReadingState(bookId))
    if (!row) return

    const current = parseReadingState(row.reading_state_json).lastReadLocation ?? ''
    const patch: ReadingStateJson = { updatedAt: now }
    if (!isPersistedLocationJson(current)) {
      patch.lastReadLocation = current.trim() || STARTED_LOCATION_LABEL
    }
    this.patchReadingState(bookId, patch)
  }

  setReadingStatus(
    bookId: string,
    status: 'reading' | 'completed' | 'not-started',
    now = new Date().toISOString(),
  ): void {
    this.sql.run(q.updateReadingStatus(bookId, status, now))
  }

  /**
   * Point a book at a (moved) file. The caller must already have verified that the file's SHA-256
   * equals `books.sha256`. Only the path moves — book id, annotations, chunks and progress stay.
   */
  updateFilePath(bookId: string, filePath: string): void {
    this.sql.run(q.updateFilePath(bookId, filePath, new Date().toISOString()))
  }

  /**
   * The book's file now has this content: a PDF whose annotations Readmate or another app just wrote
   * (the book is the same, so id, annotations and progress stay). Keeps `books.sha256` equal to the
   * file on disk so "Locate file" (`library:relinkBook`, an exact hash match) and duplicate detection
   * keep working. No-op when unchanged; skipped (returns false) if another book already has that hash
   * (`idx_books_sha256` is unique). `updated_at` is left alone: derived data, not a user edit.
   */
  updateFileFingerprint(bookId: string, sha256: string, fileSizeBytes: number): boolean {
    try {
      const result = this.sql.run(q.updateFileFingerprint(bookId, sha256, JSON.stringify({ fileSizeBytes })))
      return result.changes > 0
    } catch {
      return false
    }
  }

  setCoverPath(bookId: string, coverPath: string): void {
    this.sql.run(q.updateCoverPath(bookId, coverPath, new Date().toISOString()))
  }

  setFavorite(bookId: string, value: boolean): void {
    this.sql.run(q.updateFavorite(bookId, value, new Date().toISOString()))
  }

  /**
   * Persist book + authors + genres atomically (genres and the default empty reading state are
   * columns of the same `books` row).
   */
  persistImportedBook(
    book: Book,
    authorNames: string[] = [],
    genreNames: string[] = [],
  ): void {
    this.sql.transaction(() => {
      this.insertBookWithAuthors(book, authorNames, genreNames)
    })
  }

  /**
   * Persist a multi-chapter audiobook atomically: the parent `books` row, its authors and EVERY chapter row in one
   * transaction — either all of it exists afterwards or none of it (a failed insert, e.g. a duplicate `sha256`,
   * rolls everything back). The chapter list is validated first (>= 2 chapters, positions 0..n-1, canonical file
   * names), and the parent's `file_path` must be chapter 0's file, which is what keeps every path helper working.
   * Files are the caller's business; nothing here touches the disk.
   */
  persistImportedAudiobook(
    book: Book,
    chapters: readonly AudioChapterRecord[],
    authorNames: string[] = [],
    genreNames: string[] = [],
  ): void {
    if (!isAudioFormat(book.format)) throw new Error('persistImportedAudiobook: the parent book is not an audio format')
    const check = validateChapterRecords(book.id, chapters)
    if (!check.ok) throw new Error(`persistImportedAudiobook: ${check.reason}`)
    const first = chapters[0] as AudioChapterRecord
    if (path.basename(book.filePath) !== first.fileName) {
      throw new Error('persistImportedAudiobook: books.file_path must be the first chapter file')
    }
    if (book.format !== first.fileFormat) {
      throw new Error('persistImportedAudiobook: books.file_format must be the first chapter format')
    }
    this.sql.transaction(() => {
      this.insertBookWithAuthors(book, authorNames, genreNames)
      for (const c of chapters) {
        this.sql.run(q.insertAudioChapter(libraryCodec.audioChapterToValues(c)))
      }
    })
  }

  /** Chapters of a multi-chapter audiobook in playback order; `[]` for every other book. */
  listAudioChapters(bookId: string): AudioChapterRecord[] {
    return this.sql.all<libraryCodec.AudioChapterRow>(q.selectAudioChapters(bookId)).map(libraryCodec.audioChapterFromRow)
  }

  /** One chapter of ONE book — never a chapter of another book; `undefined` when there is none. */
  getAudioChapter(bookId: string, chapterId: string): AudioChapterRecord | undefined {
    const row = this.sql.get<libraryCodec.AudioChapterRow>(q.selectAudioChapter(bookId, chapterId))
    return row ? libraryCodec.audioChapterFromRow(row) : undefined
  }

  /** True when the book is a multi-chapter audiobook (has chapter rows). */
  hasAudioChapters(bookId: string): boolean {
    return this.sql.get(q.selectHasAudioChapters(bookId)) !== undefined
  }

  /** Chapter count per multi-chapter audiobook (books without chapters are absent). */
  audioChapterCounts(): Map<string, number> {
    const rows = this.sql.all<{ book_id: string; n: number }>(q.selectAudioChapterCounts())
    return new Map(rows.map((r) => [r.book_id, r.n]))
  }

  /** Folder of every registered book file (startup sweep: a folder some book lives in is never "partial"). */
  bookDirectories(): string[] {
    const rows = this.sql.all<{ file_path: string }>(q.selectBookFilePaths())
    return rows.map((r) => path.dirname(r.file_path))
  }

  /** Book row + authors; call inside a transaction. */
  private insertBookWithAuthors(book: Book, authorNames: string[], genreNames: string[]): void {
    this.sql.run(q.insertBook(libraryCodec.bookToRowValues(book, genreNames)))

    const authorLinks: BookAuthor[] = []
    authorNames.forEach((name, index) => {
      const trimmed = name.trim()
      if (!trimmed) return
      const author = this.findOrCreateAuthorByName(trimmed)
      authorLinks.push(
        new BookAuthor({
          bookId: book.id,
          authorId: author.id,
          sortOrder: index,
        }),
      )
    })

    if (authorLinks.length > 0) {
      for (const link of authorLinks) {
        this.sql.run(q.insertBookAuthor(book.id, link.authorId, link.sortOrder))
      }
    }
  }

  /** All books newest-first, with joined author names; genres + session come from the same row. */
  async listAll(): Promise<BookListItem[]> {
    const rows = this.sql.all<BookRow>(q.selectAllBooksNewestFirst())

    // A row whose format the app no longer supports (e.g. an old DOC/DOCX import) is left out of
    // the list — one such row must not hide the whole library. Its data stays in the database.
    return rows
      .filter((row) => isDocumentFormat(row.file_format))
      .map((row) => libraryCodec.bookListItemFromRow(row, this.authorNamesForBook(row.id)))
  }

  listCollections(): CollectionListItem[] {
    const rows = this.sql.all<libraryCodec.CollectionRow>(q.selectCollections())
    return rows.map((row) =>
      libraryCodec.collectionFromRow(
        row,
        this.sql.all<{ book_id: string }>(q.selectCollectionBookIds(row.id)).map((item) => item.book_id),
      ),
    )
  }

  createCollection(input: {
    name: string
    description?: string
  }): CollectionListItem {
    const now = new Date().toISOString()
    const collection: CollectionListItem = {
      id: randomUUID(),
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      bookIds: [],
      createdAt: now,
      updatedAt: now,
    }
    this.sql.run(
      q.insertCollection(collection.id, collection.name, collection.description ?? null, collection.createdAt, collection.updatedAt),
    )
    return collection
  }

  updateCollection(
    collectionId: string,
    input: { name: string; description?: string },
  ): CollectionListItem | undefined {
    const now = new Date().toISOString()
    const result = this.sql.run(
      q.updateCollection(collectionId, input.name.trim(), input.description?.trim() || null, now),
    )
    if (result.changes === 0) return undefined
    return this.listCollections().find((item) => item.id === collectionId)
  }

  deleteCollection(collectionId: string): boolean {
    return this.sql.run(q.deleteCollection(collectionId)).changes > 0
  }

  addBookToCollection(collectionId: string, bookId: string): void {
    const now = new Date().toISOString()
    this.sql.transaction(() => {
      const next = this.sql.get<{ value: number }>(q.selectNextCollectionSortOrder(collectionId)) as { value: number }
      this.sql.run(q.insertCollectionBook(collectionId, bookId, next.value, now))
      this.sql.run(q.touchCollection(collectionId, now))
    })
  }

  removeBookFromCollection(collectionId: string, bookId: string): boolean {
    const result = this.sql.run(q.deleteCollectionBook(collectionId, bookId))
    if (result.changes > 0) {
      this.sql.run(q.touchCollection(collectionId, new Date().toISOString()))
    }
    return result.changes > 0
  }

  authorNamesForBook(bookId: string): string {
    const rows = this.sql.all<{ name: string }>(q.selectAuthorNamesOfBook(bookId))
    return rows.map((r) => r.name).join(', ')
  }

  genreNamesForBook(bookId: string): string[] {
    const row = this.sql.get<{ genres_json: string }>(q.selectBookGenres(bookId))
    return row ? parseGenres(row.genres_json) : []
  }

  /** Update description / page_count / optional title (Library metadata backfill + edit dialog). */
  updateLibraryMetadata(
    bookId: string,
    fields: {
      description?: string | null
      pageCount?: number | null
      title?: string
    },
  ): void {
    const current = this.sql.get<{ title: string }>(q.selectBookTitle(bookId))
    if (!current) return

    // Only the keys present in `patch` are touched; `null` deletes the key, so unrelated
    // metadata (signerName, fileSizeBytes, …) survives.
    const patch: BookMetadataJson = {}
    if (fields.description !== undefined) {
      patch.description = fields.description?.trim() || null
    }
    if (fields.pageCount !== undefined) {
      patch.pageCount =
        fields.pageCount != null && fields.pageCount > 0
          ? Math.floor(fields.pageCount)
          : null
    }
    const title =
      fields.title?.trim() && fields.title.trim().length > 0
        ? fields.title.trim()
        : current.title

    this.sql.run(q.updateBookMetadata(bookId, title, JSON.stringify(patch), new Date().toISOString()))
  }

  /**
   * Store a signature-verification result, replacing the previous one member by member
   * (`signatureMetadataPatch` nulls anything the new result lacks, so no stale signer name
   * survives). `updated_at` is left alone: this is derived data, not a user edit.
   */
  saveSignature(bookId: string, info: BookSignatureInfo | undefined): void {
    this.sql.run(q.patchMetadata(bookId, JSON.stringify(signatureMetadataPatch(info))))
  }

  /** Replace author links for a book (used by metadata backfill after cascade wipe). */
  replaceAuthorsByName(bookId: string, authorNames: string[]): void {
    this.sql.transaction(() => {
      this.sql.run(q.deleteBookAuthors(bookId))
      authorNames.forEach((name, index) => {
        const trimmed = name.trim()
        if (!trimmed) return
        const author = this.findOrCreateAuthorByName(trimmed)
        this.sql.run(q.insertBookAuthor(bookId, author.id, index))
      })
    })
  }

  /** Replace a book's genres (trimmed, case-insensitively de-duplicated, sorted A→Z). */
  setGenres(bookId: string, genreNames: string[]): void {
    this.sql.run(q.updateGenres(bookId, JSON.stringify(normalizeGenreNames(genreNames))))
  }

  readingStatusForBook(
    bookId: string,
  ): 'reading' | 'completed' | 'not-started' {
    const row = this.sql.get<{ reading_status: libraryCodec.ReadingStatus }>(q.selectBookReadingStatus(bookId))
    return row?.reading_status ?? 'not-started'
  }

  async deleteCascade(bookId: string): Promise<void> {
    this.sql.run(q.deleteBook(bookId))
  }
}

let libraryStore: SqliteLibraryStore | null = null

/** Singleton LibraryStore backed by the open SQLite DB. */
export function getLibraryStore(): SqliteLibraryStore {
  if (!libraryStore) {
    libraryStore = new SqliteLibraryStore()
  }
  return libraryStore
}
