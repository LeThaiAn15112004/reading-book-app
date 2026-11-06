/**
 * Mobile's `LibraryStore` (spec 008, T044): the SDK port over the host's SQLite, writing `books` rows that mean
 * exactly what Desktop's `SqliteLibraryStore` rows mean (FR-021; checked by the contract fixtures, T046). Row
 * mapping reuses the SDK's JSON helpers (`parseMetadata`, `signatureInfoFromMetadata`, `normalizeGenreNames`).
 *
 * Mobile-only rules (data-model.md), enforced on every save:
 *   - `id` is a UUID;
 *   - `sha256` is unique, lowercase hex, the same SHA-256 of the file bytes Desktop uses;
 *   - `file_path` is relative, `books/{id}/file`, never absolute (absolute paths change after iOS app updates);
 *   - `cover_path` is relative, `covers/{id}.png`, or absent;
 *   - `file_format` is `epub`, `pdf`, `txt` or `md`;
 *   - `signatureStatus` stays absent (not checked; Mobile never verifies signatures).
 */
import {
  Book,
  STARTED_LOCATION_LABEL,
  isDocumentFormat,
  isPersistedLocationJson,
  libraryCodec,
  libraryStatements as q,
  normalizeGenreNames,
  parseReadingState,
  type BookAuthor,
  type BookMetadataJson,
  type LibraryStore,
  type ReadingStateJson,
} from '@reading-book/book-reader-sdk'
import type { SqlDriver, SqlStatement } from '../db/sql-driver'

// The SQL (core `libraryStatements`) and the row codecs (`libraryCodec`) are shared with Desktop (spec 009 T032);
// this store keeps the Mobile rules, the control flow and the batch transactions.
type BookRow = libraryCodec.BookRow
export type ReadingSessionSummary = libraryCodec.ReadingSessionSummary
export type BookListItem = libraryCodec.BookListItem
export type CollectionListItem = libraryCodec.CollectionListItem

const queryOne = async <Row>(db: SqlDriver, statement: SqlStatement): Promise<Row | undefined> =>
  (await db.query<Row>(statement.sql, statement.params))[0]

export const MOBILE_BOOK_FORMATS = ['epub', 'pdf', 'txt', 'md'] as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/

export class MobileBookRuleError extends Error {
  constructor(readonly rule: string, message: string) {
    super(message)
    this.name = 'MobileBookRuleError'
  }
}

export const bookFilePath = (id: string) => `books/${id}/file`
export const bookCoverPath = (id: string) => `covers/${id}.png`

export function assertMobileBookRules(book: Book): void {
  const fail = (rule: string, message: string): never => {
    throw new MobileBookRuleError(rule, message)
  }
  if (!UUID.test(book.id)) fail('id', `Book id must be a UUID, got "${book.id}"`)
  if (!SHA256.test(book.sha256)) fail('sha256', 'sha256 must be 64 lowercase hex characters (SHA-256 of the file bytes)')
  if (book.filePath !== bookFilePath(book.id)) fail('file_path', `file_path must be "${bookFilePath(book.id)}", relative to app storage`)
  if (book.coverPath !== undefined && book.coverPath !== bookCoverPath(book.id)) fail('cover_path', `cover_path must be "${bookCoverPath(book.id)}" or absent`)
  if (!(MOBILE_BOOK_FORMATS as readonly string[]).includes(book.format)) fail('file_format', `Mobile stores only ${MOBILE_BOOK_FORMATS.join(', ')}, not ${book.format}`)
  if (book.signature !== undefined) fail('signatureStatus', 'Mobile never checks signatures, so signatureStatus stays absent')
}

export class MobileLibraryStore implements LibraryStore {
  constructor(private readonly db: SqlDriver) {}

  private run(statement: SqlStatement) {
    return this.db.run(statement.sql, statement.params)
  }

  async findById(id: string): Promise<Book | undefined> {
    const row = await queryOne<BookRow>(this.db, q.selectBookById(id))
    return row ? libraryCodec.bookFromRow(row) : undefined
  }

  async findBySha256(hash: string): Promise<Book | undefined> {
    const row = await queryOne<BookRow>(this.db, q.selectBookBySha256(hash))
    return row ? libraryCodec.bookFromRow(row) : undefined
  }

  /** Not used by the first release; Desktop's store does not implement it either. */
  async findByAuthor(): Promise<Book[]> {
    throw new Error('MobileLibraryStore.findByAuthor is not implemented (not used by the first release)')
  }

  async save(book: Book): Promise<void> {
    assertMobileBookRules(book)
    await this.run(q.insertBook(libraryCodec.bookToRowValues(book)))
  }

  /** Caller must ensure each author exists in `authors` (same contract as Desktop). */
  async linkAuthors(bookId: string, authors: BookAuthor[]): Promise<void> {
    if (authors.length === 0) return
    await this.db.transaction(authors.map((link) => q.insertBookAuthor(bookId, link.authorId, link.sortOrder)))
  }

  /** Genres are names in books.genres_json (Desktop migration 020); there is no table to link. */
  async linkGenres(): Promise<void> {
    throw new Error('MobileLibraryStore.linkGenres is unsupported: genres live in books.genres_json')
  }

  /**
   * Removes the book's rows in one transaction. The dependents are deleted explicitly, so the result does not depend
   * on the connection's `foreign_keys` setting. Files are the bridge's job, after this (data-model.md, Removal).
   */
  async deleteCascade(bookId: string): Promise<void> {
    await this.db.transaction([
      q.deleteNotesOfBook(bookId),
      q.deleteCollectionLinksOfBook(bookId),
      q.deleteBookAuthors(bookId),
      q.deleteBook(bookId),
    ])
  }

  // --- What Desktop's SqliteLibraryStore offers beyond the port (library:* handlers), with the same meaning. ----

  /** Book row + authors + genres in ONE transaction (Desktop's persistImportedBook). */
  async persistImported(book: Book, authorNames: readonly string[] = [], genreNames: readonly string[] = []): Promise<void> {
    assertMobileBookRules(book)
    const statements: SqlStatement[] = [q.insertBook(libraryCodec.bookToRowValues(book, genreNames))]
    statements.push(...(await this.authorLinkStatements(book.id, authorNames)))
    await this.db.transaction(statements)
  }

  /** Every listable book, newest first; a row of a format the app does not know is left out, never fatal. */
  async listItems(): Promise<BookListItem[]> {
    const statement = q.selectAllBooksNewestFirst()
    const rows = await this.db.query<BookRow>(statement.sql, statement.params)
    const authors = await this.allAuthorNames()
    return rows.filter((row) => isDocumentFormat(row.file_format)).map((row) => libraryCodec.bookListItemFromRow(row, authors.get(row.id) ?? ''))
  }

  async getItem(id: string): Promise<BookListItem | undefined> {
    const row = await queryOne<BookRow>(this.db, q.selectBookById(id))
    if (!row || !isDocumentFormat(row.file_format)) return undefined
    return libraryCodec.bookListItemFromRow(row, await this.authorNamesForBook(id))
  }

  async authorNamesForBook(bookId: string): Promise<string> {
    const statement = q.selectAuthorNamesOfBook(bookId)
    const rows = await this.db.query<{ name: string }>(statement.sql, statement.params)
    return rows.map((r) => r.name).join(', ')
  }

  /** Desktop's markAsReading: status `reading`; an empty location becomes the `Started` label, a real one is kept. */
  async markAsReading(bookId: string, now = new Date().toISOString()): Promise<void> {
    const row = await queryOne<{ reading_state_json: string }>(this.db, q.selectBookReadingState(bookId))
    if (!row) return
    const current = parseReadingState(row.reading_state_json).lastReadLocation ?? ''
    const patch: ReadingStateJson = { updatedAt: now }
    if (!isPersistedLocationJson(current)) patch.lastReadLocation = current.trim() || STARTED_LOCATION_LABEL
    await this.db.transaction([q.updateReadingStatus(bookId, 'reading', now), q.patchReadingState(bookId, patch)])
  }

  async setReadingStatus(bookId: string, status: 'reading' | 'completed' | 'not-started', now = new Date().toISOString()): Promise<void> {
    await this.run(q.updateReadingStatus(bookId, status, now))
  }

  async setFavorite(bookId: string, value: boolean): Promise<void> {
    await this.run(q.updateFavorite(bookId, value, new Date().toISOString()))
  }

  /** Mobile's cover is always `covers/{id}.png` (data-model.md). */
  async setCoverPath(bookId: string): Promise<void> {
    await this.run(q.updateCoverPath(bookId, bookCoverPath(bookId), new Date().toISOString()))
  }

  /** Title, description, page count, authors and genres in ONE transaction (Desktop does them one after another). */
  async updateLibraryMetadata(
    bookId: string,
    fields: { title: string; description: string | null; pageCount: number | null; authorNames: string[]; genreNames: string[] },
  ): Promise<boolean> {
    const current = await queryOne<{ title: string }>(this.db, q.selectBookTitle(bookId))
    if (!current) return false
    // Only these keys are touched; `null` deletes the key, so unrelated metadata survives (json_patch).
    const patch: BookMetadataJson = {
      description: fields.description?.trim() || null,
      pageCount: fields.pageCount != null && fields.pageCount > 0 ? Math.floor(fields.pageCount) : null,
    }
    const title = fields.title.trim() || current.title
    await this.db.transaction([
      q.updateBookMetadataAndGenres(bookId, title, JSON.stringify(patch), JSON.stringify(normalizeGenreNames(fields.genreNames)), new Date().toISOString()),
      q.deleteBookAuthors(bookId),
      ...(await this.authorLinkStatements(bookId, fields.authorNames)),
    ])
    return true
  }

  async listCollections(): Promise<CollectionListItem[]> {
    const collections = q.selectCollections()
    const rows = await this.db.query<libraryCodec.CollectionRow>(collections.sql, collections.params)
    const linkStatement = q.selectAllCollectionLinks()
    const links = await this.db.query<{ collection_id: string; book_id: string }>(linkStatement.sql, linkStatement.params)
    return rows.map((row) =>
      libraryCodec.collectionFromRow(
        row,
        links.filter((l) => l.collection_id === row.id).map((l) => l.book_id),
      ),
    )
  }

  async createCollection(input: { name: string; description?: string }, id: string = globalThis.crypto.randomUUID()): Promise<CollectionListItem> {
    const now = new Date().toISOString()
    const item: CollectionListItem = { id, name: input.name.trim(), description: input.description?.trim() || undefined, bookIds: [], createdAt: now, updatedAt: now }
    await this.run(q.insertCollection(item.id, item.name, item.description ?? null, now, now))
    return item
  }

  async updateCollection(id: string, input: { name: string; description?: string }): Promise<CollectionListItem | undefined> {
    const result = await this.run(q.updateCollection(id, input.name.trim(), input.description?.trim() || null, new Date().toISOString()))
    if (result.changes === 0) return undefined
    return (await this.listCollections()).find((c) => c.id === id)
  }

  /** Links first, explicitly: the host's transaction connection has no foreign keys (expo-sqlite), so nothing cascades. */
  async deleteCollection(id: string): Promise<boolean> {
    const results = await this.db.transaction([q.deleteCollectionLinks(id), q.deleteCollection(id)])
    return results[1]!.changes > 0
  }

  async collectionExists(id: string): Promise<boolean> {
    return (await queryOne(this.db, q.selectCollectionExists(id))) !== undefined
  }

  async addBookToCollection(collectionId: string, bookId: string): Promise<void> {
    const now = new Date().toISOString()
    const next = await queryOne<{ value: number }>(this.db, q.selectNextCollectionSortOrder(collectionId))
    await this.db.transaction([q.insertCollectionBook(collectionId, bookId, next?.value ?? 0, now), q.touchCollection(collectionId, now)])
  }

  async removeBookFromCollection(collectionId: string, bookId: string): Promise<boolean> {
    const result = await this.run(q.deleteCollectionBook(collectionId, bookId))
    if (result.changes > 0) await this.run(q.touchCollection(collectionId, new Date().toISOString()))
    return result.changes > 0
  }

  async allBookIds(): Promise<string[]> {
    const statement = q.selectAllBookIds()
    return (await this.db.query<{ id: string }>(statement.sql, statement.params)).map((r) => r.id)
  }

  /** Statements linking `names` in order, creating the authors that do not exist yet (matched case-insensitively). */
  private async authorLinkStatements(bookId: string, names: readonly string[]): Promise<SqlStatement[]> {
    const statements: SqlStatement[] = []
    const seen = new Map<string, string>()
    for (const [index, raw] of names.entries()) {
      const name = raw.trim()
      if (!name) continue
      const key = name.toLowerCase()
      let authorId = seen.get(key)
      if (!authorId) {
        authorId = (await queryOne<{ id: string }>(this.db, q.selectAuthorByName(name)))?.id
        if (!authorId) {
          authorId = globalThis.crypto.randomUUID()
          statements.push(q.insertAuthor(authorId, name, null, new Date().toISOString()))
        }
        seen.set(key, authorId)
      }
      statements.push(q.insertBookAuthor(bookId, authorId, index))
    }
    return statements
  }

  private async allAuthorNames(): Promise<Map<string, string>> {
    const statement = q.selectAllAuthorNames()
    const rows = await this.db.query<{ book_id: string; name: string }>(statement.sql, statement.params)
    const out = new Map<string, string[]>()
    for (const r of rows) out.set(r.book_id, [...(out.get(r.book_id) ?? []), r.name])
    return new Map([...out].map(([id, names]) => [id, names.join(', ')]))
  }
}
