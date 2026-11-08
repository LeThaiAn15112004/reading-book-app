// Spec 010 T049 — isNewerSchema (FR-014a) and verifyCounts.
import { describe, expect, it } from 'vitest'
import { COUNTED_TABLES, isNewerSchema, verifyCounts } from '../../src/store-import/index.js'

const KNOWN = ['001_init.sql', '002_genres.sql', '030_audio_transcript_scope.sql']

describe('isNewerSchema', () => {
  it('is false when the source applied a subset of the known migrations', () => {
    expect(isNewerSchema(['001_init.sql', '002_genres.sql'], KNOWN)).toBe(false)
    expect(isNewerSchema(KNOWN, KNOWN)).toBe(false)
    expect(isNewerSchema([], KNOWN)).toBe(false)
  })
  it('is true when the source has a migration this build does not know', () => {
    expect(isNewerSchema([...KNOWN, '031_future.sql'], KNOWN)).toBe(true)
  })
})

describe('verifyCounts', () => {
  const counts = Object.fromEntries(COUNTED_TABLES.map((t, i) => [t, i * 3]))
  it('passes equal counts', () => {
    expect(verifyCounts(counts, { ...counts })).toEqual({ ok: true })
  })
  it('refuses integrity naming the first table that differs', () => {
    expect(verifyCounts(counts, { ...counts, notes: (counts.notes ?? 0) + 1 })).toEqual({ ok: false, refuse: 'integrity', table: 'notes' })
  })
  it('a table missing on one side is a difference', () => {
    const { books: _books, ...withoutBooks } = counts
    expect(verifyCounts(counts, withoutBooks)).toEqual({ ok: false, refuse: 'integrity', table: 'books' })
  })
  it('counts the six contract tables', () => {
    expect([...COUNTED_TABLES]).toEqual(['books', 'notes', 'collections', 'book_audio_chapters', 'txt_documents', 'audio_transcripts'])
  })
})
