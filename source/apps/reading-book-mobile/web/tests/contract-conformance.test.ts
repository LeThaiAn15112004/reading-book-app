/**
 * Data contract, Mobile side (spec 008, T046 / FR-019, SC-006): the same versioned fixtures and the same runner that
 * Desktop's real stores pass (`spike:contract:fixtures`), run through `MobileOverlayStore` and `MobileLibraryStore`
 * on the Mobile baseline schema, on `node:sqlite`. Plus: the baseline has exactly Desktop's columns for every
 * first-release table.
 */
import { Book, Location, ReadingSessionState } from '@reading-book/book-reader-sdk'
import { afterAll, describe, expect, it } from 'vitest'
import { runOverlayContract, type ContractHost, type NoteRowRaw } from '../../../book-reader-sdk/tests/contracts/contract-runner'
import { loadContractFixtures } from '../../../book-reader-sdk/tests/contracts/fixtures'
import { columnsOf, migratedDesktopDatabase, schemaOf } from '../../scripts/dump-desktop-schema.mjs'
import { migrate } from '../src/db/migrate'
import { MobileLibraryStore, bookFilePath } from '../src/stores/library-store'
import { MobileOverlayStore } from '../src/stores/overlay-store'
import { createNodeSqliteDriver } from './node-sqlite-driver'

const FIRST_RELEASE_TABLES = ['books', 'authors', 'book_authors', 'collections', 'collection_books', 'notes']

describe('Mobile stores pass the Desktop data contract', async () => {
  const driver = createNodeSqliteDriver()
  afterAll(() => driver.close())
  await migrate(driver)
  const library = new MobileLibraryStore(driver)
  let n = 0
  const host: ContractHost = {
    overlay: new MobileOverlayStore(driver),
    library,
    async addBook(format) {
      const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
      await library.save(new Book({ id, title: `Contract ${format}`, filePath: bookFilePath(id), format: format as Book['format'], sha256: id.replaceAll('-', '').padEnd(64, '0'), addedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }))
      return id
    },
    async noteRow(id) {
      return driver.raw.prepare('SELECT id, book_id, note_json, created_at, updated_at FROM notes WHERE id = ?').get(id) as NoteRowRaw | undefined
    },
    async insertNoteRow(row) {
      driver.raw.prepare('INSERT INTO notes (id, book_id, note_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(row.id, row.book_id, row.note_json, row.created_at, row.updated_at)
    },
    async bookRow(id) {
      return driver.raw.prepare('SELECT * FROM books WHERE id = ?').get(id) as Record<string, unknown> | undefined
    },
    async countNotes(bookId) {
      return (driver.raw.prepare('SELECT count(*) AS n FROM notes WHERE book_id = ?').get(bookId) as { n: number }).n
    },
  }
  const fixtures = loadContractFixtures()
  const results = await runOverlayContract(host, { Location, ReadingSessionState, Book }, fixtures)

  it('runs every fixture', () => {
    expect(fixtures.length).toBe(9)
    expect(results.length).toBe(39)
  })

  for (const r of results) {
    it(r.name, () => {
      expect(r.detail ?? '').toBe('')
      expect(r.ok).toBe(true)
    })
  }
})

describe('Mobile baseline schema matches Desktop', () => {
  const desktop = migratedDesktopDatabase().db
  const mobile = createNodeSqliteDriver()
  afterAll(() => {
    desktop.close()
    mobile.close()
  })

  it('has the same columns, types, defaults and keys for every first-release table', async () => {
    await migrate(mobile)
    for (const table of FIRST_RELEASE_TABLES) expect(columnsOf(mobile.raw, table), table).toEqual(columnsOf(desktop, table))
  })

  it('has the same indexes, and no table outside the first release', () => {
    const indexes = (db: Parameters<typeof schemaOf>[0]) => schemaOf(db, FIRST_RELEASE_TABLES).filter((r) => r.type === 'index').map((r) => r.sql.replace(/\s+/g, ' '))
    expect(indexes(mobile.raw)).toEqual(indexes(desktop))
    const tables = schemaOf(mobile.raw).filter((r) => r.type === 'table').map((r) => r.name).sort()
    expect(tables).toEqual([...FIRST_RELEASE_TABLES, 'schema_migrations'].sort())
  })
})
