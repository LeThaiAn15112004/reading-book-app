/**
 * Mobile-only rules of the stores and the migration runner (spec 008, T042, T044, T045): what the shared contract
 * does not cover because Desktop has no such rule.
 */
import { Book, DocumentFormat } from '@core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MOBILE_MIGRATIONS, migrate, splitSqlStatements } from '../db/migrate'
import { MobileBookRuleError, MobileLibraryStore, bookCoverPath, bookFilePath } from '../stores/library-store'
import { MobileOverlayStore, OverlayValidationError } from '../stores/overlay-store'
import { createNodeSqliteDriver, type NodeSqliteDriver } from './node-sqlite-driver'

const ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const SHA = 'a'.repeat(64)
const book = (over: Partial<ConstructorParameters<typeof Book>[0]> = {}) =>
  new Book({ id: ID, title: 'T', filePath: bookFilePath(ID), format: DocumentFormat.Epub, sha256: SHA, addedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over })

let driver: NodeSqliteDriver
beforeEach(async () => {
  driver = createNodeSqliteDriver()
  await migrate(driver)
})
afterEach(() => driver.close())

describe('splitSqlStatements', () => {
  it('splits on top-level semicolons only', () => {
    const sql = [
      "-- a comment; not a split",
      "CREATE TABLE a (x TEXT DEFAULT 'semi;colon', \"we;ird\" INTEGER);",
      '/* block; comment */ CREATE INDEX i ON a (x);',
      "CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE a SET x = 'y;z'; DELETE FROM a WHERE 0; END;",
      "INSERT INTO a (x) VALUES ('it''s; fine')",
    ].join('\n')
    const parts = splitSqlStatements(sql)
    expect(parts).toHaveLength(4)
    expect(parts[0]).toMatch(/^CREATE TABLE a/)
    expect(parts[2]).toMatch(/BEGIN UPDATE a SET x = 'y;z'; DELETE FROM a WHERE 0; END$/)
    expect(parts[3]).toBe("INSERT INTO a (x) VALUES ('it''s; fine')")
  })

  it('splits the baseline into its statements', () => {
    expect(splitSqlStatements(MOBILE_MIGRATIONS[0]!.sql)).toHaveLength(6 + 11)
  })
})

describe('migrate', () => {
  it('is idempotent and records each migration once', async () => {
    const again = await migrate(driver)
    expect(again).toEqual({ applied: [], alreadyApplied: ['001_baseline.sql'] })
    expect(await driver.query('SELECT name FROM schema_migrations')).toEqual([{ name: '001_baseline.sql' }])
  })

  it('leaves nothing behind when a migration fails, so it is retried', async () => {
    const fresh = createNodeSqliteDriver()
    const bad = [...MOBILE_MIGRATIONS, { name: '002_bad.sql', sql: 'CREATE TABLE ok_part (x TEXT); CREATE TABLE books (dup TEXT);' }]
    await expect(migrate(fresh, bad)).rejects.toThrow()
    expect(await fresh.query("SELECT name FROM sqlite_master WHERE name = 'ok_part'")).toEqual([])
    expect((await fresh.query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name)).toEqual(['001_baseline.sql'])
    fresh.close()
  })

  it('refuses a database written by a newer app', async () => {
    await driver.run("INSERT INTO schema_migrations (name, applied_at) VALUES ('999_future.sql', 'x')")
    await expect(migrate(driver)).rejects.toThrow(/newer version/)
  })
})

describe('MobileLibraryStore rules', () => {
  const rule = async (b: Book) => {
    try {
      await new MobileLibraryStore(driver).save(b)
    } catch (error) {
      return error instanceof MobileBookRuleError ? error.rule : String(error)
    }
    return 'saved'
  }

  it('accepts a book that follows every rule', async () => {
    expect(await rule(book({ coverPath: bookCoverPath(ID) }))).toBe('saved')
  })
  it('refuses an id that is not a UUID', async () => {
    expect(await rule(book({ id: 'book-1', filePath: bookFilePath('book-1') }))).toBe('id')
  })
  it('refuses an absolute or foreign file path', async () => {
    expect(await rule(book({ filePath: '/data/user/0/app/files/books/x/file' }))).toBe('file_path')
    expect(await rule(book({ filePath: `books/${ID}/book.epub` }))).toBe('file_path')
  })
  it('refuses a cover outside covers/{id}.png', async () => {
    expect(await rule(book({ coverPath: 'covers/other.png' }))).toBe('cover_path')
  })
  it('refuses formats outside the first release', async () => {
    expect(await rule(book({ format: DocumentFormat.Mp3 }))).toBe('file_format')
    expect(await rule(book({ format: 'docx' as DocumentFormat }))).toBe('file_format')
  })
  it('refuses a sha256 that is not lowercase hex SHA-256', async () => {
    expect(await rule(book({ sha256: 'ABC' }))).toBe('sha256')
  })
  it('refuses a signature status (Mobile never checks one)', async () => {
    expect(await rule(book({ signature: { status: 'unsigned' } as never }))).toBe('signatureStatus')
  })
  it('removes notes, collection links and author links with the book, even with foreign keys off', async () => {
    const store = new MobileLibraryStore(driver)
    await store.save(book())
    await driver.run("INSERT INTO authors (id, name, created_at) VALUES ('a1', 'A', 't')")
    await store.linkAuthors(ID, [{ bookId: ID, authorId: 'a1', sortOrder: 0 } as never])
    await driver.run("INSERT INTO collections (id, name, created_at, updated_at) VALUES ('c1', 'C', 't', 't')")
    await driver.run("INSERT INTO collection_books (collection_id, book_id, added_at) VALUES ('c1', ?, 't')", [ID])
    await new MobileOverlayStore(driver).saveBookmark({ bookId: ID, locator: { kind: 'cfi', cfi: 'epubcfi(/6/2!/4/2/1:0)', chapterIndex: 0 } })
    driver.raw.exec('PRAGMA foreign_keys = OFF')
    await store.deleteCascade(ID)
    for (const table of ['books', 'notes', 'collection_books', 'book_authors']) {
      expect((await driver.query<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))[0]!.n, table).toBe(0)
    }
  })
})

describe('MobileOverlayStore validation (Main re-validation, SDK functions)', () => {
  const overlay = () => new MobileOverlayStore(driver)
  const save = async (over: Record<string, unknown>) => {
    const library = new MobileLibraryStore(driver)
    if (!(await library.findById(ID))) await library.save(book({ format: DocumentFormat.Pdf }))
    return overlay().saveHighlight({ bookId: ID, locator: { kind: 'page-rect', page: 1, chapterIndex: 0 }, styleKind: 'highlight', colorHex: '#FFEB3B', ...over } as never)
  }

  it('refuses a locator that is not a Location', async () => {
    await expect(save({ locator: { kind: 'nonsense' } })).rejects.toBeInstanceOf(OverlayValidationError)
  })
  it('refuses kinds Mobile does not create (shapes, typewriter, attachments)', async () => {
    for (const styleKind of ['rectangle', 'typewriter', 'attachment', 'textbox']) await expect(save({ styleKind })).rejects.toThrow(/does not create/)
  })
  it('refuses PDF markup whose page does not match the locator', async () => {
    await expect(save({ pdfAnnotation: { pageIndex: 3, rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.02, pageIndex: 3 }] } })).rejects.toThrow(/PDF markup/)
  })
  it('refuses an invalid TXT range', async () => {
    await expect(save({ locator: { kind: 'text-offset', offset: 0, blockId: 'txt', chapterIndex: 0 }, txtAnnotation: { startOffset: 5, endOffset: 2 } })).rejects.toThrow(/TXT range/)
  })
  it('accepts underline, strikethrough and squiggly', async () => {
    for (const styleKind of ['underline', 'strikethrough', 'squiggly']) await expect(save({ styleKind })).resolves.toMatchObject({ styleKind })
  })
})
