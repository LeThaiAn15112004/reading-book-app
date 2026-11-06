import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { overlayCodec, overlayStatements as q, type SqlValue, type Statement } from '../../src/index.js'

const placeholders = (sql: string): number => (sql.match(/\?/g) ?? []).length

describe('overlay statements', () => {
  it('every builder binds exactly as many parameters as it has placeholders', () => {
    const now = '2026-01-01T00:00:00.000Z'
    const all: Statement[] = [
      q.selectReadingStateRow('b'),
      q.selectFormatAndReadingState('b'),
      q.selectBookFormat('b'),
      q.selectChapterOfBook('c', 'b'),
      q.updateAudioProgress('b', '{}', now),
      q.patchSessionPreferences('b', '{}', now),
      q.overwriteSessionState('b', '{}', now, now),
      q.selectNoteCreatedAt('n', 'b'),
      q.selectNoteIdExists('n'),
      q.selectBookmarks('b'),
      q.selectHighlights('b'),
      q.selectHighlightsUnordered('b'),
      q.countHighlights('b'),
      q.selectHighlightStamps('b'),
      q.selectIsAttachment('n', 'b'),
      q.selectIsAnnotation('n', 'b'),
      q.selectAttachmentRow('n', 'b'),
      q.selectInk('b'),
      q.upsertBookmark('n', 'b', '{}', now, now),
      q.upsertHighlight('n', 'b', '{}', now, now),
      q.upsertInk('n', 'b', '{}', now, now),
      q.deleteBookmark('n', 'b'),
      q.deleteHighlight('n', 'b'),
      q.deleteInk('n', 'b'),
      q.selectEmbeddedLedger('b'),
      q.selectTwoWayLedger('b'),
      q.deleteLedgerByNote('b', 'n'),
      q.deleteLedgerByKey('b', 'k'),
      q.rekeyLedger('b', 'a', 'c', now),
      q.upsertEmbeddedLedger('b', 'k', 'n', 'h1', 'h2', now),
      q.upsertTwoWayLedger('b', 'k', 'n', 'h1', 'h2', '{}', null, now),
      q.updateLedgerBase('b', 'k', '{}', now),
      q.setLedgerConflict('b', 'k', '{}', now),
      q.clearLedgerConflict('b', 'k'),
    ]
    for (const statement of all) expect(statement.params.length, statement.sql).toBe(placeholders(statement.sql))
  })

  // The upsert guards, on a real SQLite: a write of one kind never converts a row of another kind.
  it('the upserts never convert a row of another kind (0 changes), and update their own kind', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE notes (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, note_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)')
    const run = (s: Statement) => Number(db.prepare(s.sql).run(...(s.params as SqlValue[])).changes)
    const json = (type: string, group: string) => JSON.stringify({ type, group })
    expect(run(q.upsertBookmark('bm', 'b1', json('bookmark', 'bookmark'), 't0', 't0'))).toBe(1)
    expect(run(q.upsertHighlight('bm', 'b1', json('highlight', 'annotation'), 't0', 't1'))).toBe(0)
    expect(run(q.upsertHighlight('hl', 'b1', json('highlight', 'annotation'), 't0', 't0'))).toBe(1)
    expect(run(q.upsertBookmark('hl', 'b1', json('bookmark', 'bookmark'), 't0', 't1'))).toBe(0)
    expect(run(q.upsertInk('hl', 'b1', json('ink', 'annotation'), 't0', 't1'))).toBe(0)
    expect(run(q.upsertInk('ink', 'b1', json('ink', 'annotation'), 't0', 't0'))).toBe(1)
    expect(run(q.upsertInk('ink', 'b2', json('ink', 'annotation'), 't0', 't2'))).toBe(0)
    expect(run(q.upsertHighlight('hl', 'b1', json('underline', 'annotation'), 'ignored', 't3'))).toBe(1)
    const row = db.prepare('SELECT created_at, updated_at FROM notes WHERE id = ?').get('hl') as { created_at: string; updated_at: string }
    expect(row).toEqual({ created_at: 't0', updated_at: 't3' })
    expect(run(q.deleteHighlight('hl', 'b1'))).toBe(1)
    expect(run(q.deleteHighlight('bm', 'b1'))).toBe(0)
  })
})

describe('overlay codec', () => {
  it('a bookmark note round-trips through its row', () => {
    const locator = { type: 'cfi', cfi: 'epubcfi(/6/2)' } as never
    const noteJson = overlayCodec.buildBookmarkNoteJson({ locator, label: 'L', excerpt: 'E', createdAt: 'a', modifiedAt: 'b' })
    const record = overlayCodec.bookmarkFromRow({ id: 'n', book_id: 'b', note_json: noteJson, created_at: 'a', updated_at: 'b' })
    expect(record).toMatchObject({ id: 'n', bookId: 'b', label: 'L', excerpt: 'E', createdAt: 'a' })
  })

  it('a row with unreadable JSON or no locator yields nothing', () => {
    const row = { id: 'n', book_id: 'b', created_at: 'a', updated_at: 'b' }
    expect(overlayCodec.bookmarkFromRow({ ...row, note_json: '{' })).toBeUndefined()
    expect(overlayCodec.highlightFromRow({ ...row, note_json: '{}' })).toBeUndefined()
    expect(overlayCodec.inkFromRow({ ...row, note_json: '{}' })).toBeUndefined()
  })
})
