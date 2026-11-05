/**
 * Acceptance 4.2 (spec 008, T037): the SDK's `persistence/sql-notes.ts` does NOT store Desktop's layout. Run through
 * the same contract runner and fixtures that Desktop's stores pass (`spike:contract:fixtures`), it fails every
 * stored-shape check. FR-023 keeps it out of production use; if this test ever starts passing, sql-notes was made
 * compatible and the comment in sql-notes.ts can change.
 */
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { Book, Location, ReadingSessionState, createSqlNoteRepositories, ensureNotesSchema, type SqlDatabase, type SqlValue } from '../../src/index.js'
import { runOverlayContract, type ContractHost, type NoteRowRaw } from './contract-runner.js'
import { loadContractFixtures } from './fixtures.js'

function nodeSqlDatabase(db: DatabaseSync): SqlDatabase {
  return {
    async run(sql: string, params: readonly SqlValue[] = []) {
      const r = db.prepare(sql).run(...(params as SqlValue[]))
      return { changes: Number(r.changes) }
    },
    async all<Row>(sql: string, params: readonly SqlValue[] = []) {
      return db.prepare(sql).all(...(params as SqlValue[])) as Row[]
    },
  }
}

describe('persistence/sql-notes.ts against the Desktop data contract', async () => {
  const raw = new DatabaseSync(':memory:')
  const sql = nodeSqlDatabase(raw)
  await ensureNotesSchema(sql)
  let n = 0
  const host: ContractHost = {
    overlay: createSqlNoteRepositories(sql),
    async addBook(format) {
      return `book-${format}-${++n}`
    },
    async noteRow(id) {
      return raw.prepare('SELECT id, book_id, note_json, created_at, updated_at FROM notes WHERE id = ?').get(id) as NoteRowRaw | undefined
    },
    async insertNoteRow(row) {
      raw.prepare('INSERT INTO notes (id, book_id, note_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(row.id, row.book_id, row.note_json, row.created_at, row.updated_at)
    },
    async bookRow() {
      return undefined // sql-notes keeps reading state in its own `reading_sessions` table, not in books.reading_state_json
    },
    async countNotes(bookId) {
      return (raw.prepare('SELECT count(*) AS n FROM notes WHERE book_id = ?').get(bookId) as { n: number }).n
    },
  }
  const fixtures = loadContractFixtures().filter((f) => !('book' in f))
  const results = await runOverlayContract(host, { Location, ReadingSessionState, Book }, fixtures)
  const byName = new Map(results.map((r) => [r.name, r]))

  it('fails the stored note_json check of every annotation and bookmark fixture', () => {
    const stored = fixtures.filter((f) => 'save' in f || 'bookmark' in f).map((f) => byName.get(`${f.kind}: stored note_json`))
    expect(stored).toHaveLength(6)
    for (const r of stored) expect(r?.ok, r?.name).toBe(false)
  })

  it('stores a flat layout: colour, locator and style kind at the top, where Desktop has style.colorHex, locatorExtended and type', async () => {
    expect(byName.get('epub-highlight: stored note_json')?.detail).toMatch(/^\$\.colorHex: got "#FFEB3B", expected undefined/)
    const saved = await host.overlay.saveHighlight({ bookId: 'probe', locator: { kind: 'cfi', cfi: 'epubcfi(/6/2!/4/2/1:0)', chapterIndex: 0 }, styleKind: 'highlight', colorHex: '#FFEB3B' })
    const stored = JSON.parse((await host.noteRow(saved.id))!.note_json) as Record<string, unknown>
    expect(Object.keys(stored)).toEqual(expect.arrayContaining(['group', 'locator', 'styleKind', 'colorHex']))
    expect(stored).not.toHaveProperty('locatorExtended')
    expect(stored).not.toHaveProperty('type')
  })

  it('does not write books.reading_state_json, where Desktop keeps the reading state', () => {
    expect(byName.get('reading-state-epub: stored reading_state_json')?.ok).toBe(false)
    expect(byName.get('reading-state-txt: stored reading_state_json')?.ok).toBe(false)
  })
})
