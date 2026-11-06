import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { txtCodec, txtStatements as q, type SqlValue, type Statement } from '../../src/index.js'

const db = new DatabaseSync(':memory:')
db.exec(`CREATE TABLE txt_documents (
  book_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, content_sha256 TEXT NOT NULL,
  char_count INTEGER NOT NULL, source_sha256 TEXT, updated_at TEXT NOT NULL
)`)
const run = (s: Statement) => db.prepare(s.sql).run(...(s.params as SqlValue[]))
const get = (s: Statement) => db.prepare(s.sql).get(...(s.params as SqlValue[])) as txtCodec.TxtDocumentSqlRow | undefined

describe('txt statements', () => {
  it('binds as many parameters as placeholders', () => {
    for (const s of [q.selectTxtDocument('b'), q.selectNoteOwner('n'), q.upsertTxtDocument('b', { revision: 1, contentSha256: 'h', charCount: 3 }, 't')]) {
      expect(s.params.length, s.sql).toBe((s.sql.match(/\?/g) ?? []).length)
    }
  })

  it('the first revision stores the source hash; later revisions move on but keep it', () => {
    expect(get(q.selectTxtDocument('b1'))).toBeUndefined()
    run(q.upsertTxtDocument('b1', { revision: 1, contentSha256: 'c1', charCount: 10, sourceSha256: 'orig' }, 't1'))
    run(q.upsertTxtDocument('b1', { revision: 2, contentSha256: 'c2', charCount: 12, sourceSha256: 'other' }, 't2'))
    const row = get(q.selectTxtDocument('b1'))!
    expect(txtCodec.txtDocumentFromRow(row)).toEqual({
      bookId: 'b1', revision: 2, contentSha256: 'c2', charCount: 12, sourceSha256: 'orig', updatedAt: 't2',
    })
  })

  it('a revision without a source hash reads back as undefined', () => {
    run(q.upsertTxtDocument('b2', { revision: 1, contentSha256: 'c', charCount: 1 }, 't'))
    expect(txtCodec.txtDocumentFromRow(get(q.selectTxtDocument('b2'))!).sourceSha256).toBeUndefined()
  })
})
