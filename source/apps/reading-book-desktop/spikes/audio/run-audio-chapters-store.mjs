/**
 * Multi-chapter audiobook storage (A1) — the REAL `SqliteLibraryStore.persistImportedAudiobook` / `listAudioChapters`
 * on a migrated schema (every numbered migration, incl. 028), no Electron window, nothing outside memory.
 * The database is node:sqlite (the shared test stand-in for better-sqlite3), with a BEGIN/COMMIT/ROLLBACK shim for
 * `db.transaction`; the same SQL also runs on the real better-sqlite3 in `spike:audio:migration`.
 *
 *   1. persist    parent row + authors + ordered chapters; mixed formats; NULL duration; duplicate archive basenames
 *   2. identity   parent sha = ordered track hashes; findBySha256; single-file books have no chapters
 *   3. atomicity  duplicate parent sha, or a failing chapter insert, leaves NOTHING behind (book, authors, chapters)
 *   4. validation bad chapter lists / parent rows are refused before any write
 *   5. lifecycle  deleting the book removes its chapters; single-file persistence is unchanged
 *
 * Run: npm run spike:audio:chapters   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Book, audiobookParentSha256, chapterFileName } from '@reading-book/book-reader-sdk'
import { createMigratedDatabase } from '../pdf-annotations/db-stub.mjs'

const { SqliteLibraryStore } = await import('../../electron/persistence/sqlite-library-store.ts')

const db = createMigratedDatabase()
// better-sqlite3's `db.transaction(fn)` for node:sqlite: BEGIN / COMMIT, ROLLBACK on throw.
db.transaction = (fn) => (...args) => {
  db.exec('BEGIN')
  try {
    const result = fn(...args)
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
const store = new SqliteLibraryStore(db)

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}
const sha = (s) => createHash('sha256').update(s).digest('hex')
const count = (table, where = '1=1') => db.prepare(`SELECT count(*) n FROM ${table} WHERE ${where}`).get().n
const NOW = '2026-01-01T00:00:00.000Z'

let seq = 0
const uuid = () => `${(++seq).toString(16).padStart(8, '0')}-0000-4000-8000-${seq.toString(16).padStart(12, '0')}`

/** A valid 3-chapter audiobook: mixed formats, one unknown duration, the SAME archive basename in two folders. */
function makeAudiobook(overrides = {}) {
  const bookId = overrides.bookId ?? uuid()
  const specs = overrides.specs ?? [
    { format: 'mp3', source: 'CD1/01.mp3', duration: 61.5 },
    { format: 'm4b', source: 'CD2/01.mp3', duration: null },
    { format: 'flac', source: 'bonus.flac', duration: 12 },
  ]
  const chapters = specs.map((s, i) => {
    const id = uuid()
    return {
      id,
      bookId,
      position: i,
      title: `Chapter ${i + 1}`,
      fileName: chapterFileName(i, id, s.format),
      sourcePath: s.source,
      fileFormat: s.format,
      sizeBytes: 1000 + i,
      sha256: sha(`${bookId}-track-${i}`),
      durationSeconds: s.duration,
    }
  })
  const first = chapters[0]
  const book = new Book({
    id: bookId,
    title: overrides.title ?? 'My Audiobook',
    filePath: overrides.filePath ?? `/userData/books/${bookId}/${first.fileName}`,
    format: overrides.format ?? first.fileFormat,
    sha256: overrides.sha256 ?? audiobookParentSha256(chapters.map((c) => c.sha256)),
    fileSizeBytes: chapters.reduce((n, c) => n + c.sizeBytes, 0),
    addedAt: NOW,
    updatedAt: NOW,
  })
  return { book, chapters }
}

console.log('1. persist')
const main = makeAudiobook()
await check('parent row, authors and every chapter are stored; chapters come back in playback order with exact values', () => {
  store.persistImportedAudiobook(main.book, main.chapters, ['Ann Author', 'Bob'], ['Classics'])
  const row = db.prepare('SELECT * FROM books WHERE id = ?').get(main.book.id)
  assert.equal(row.file_format, 'mp3') // the first chapter's format: a routing marker only
  assert.equal(row.file_path, main.book.filePath)
  assert.equal(row.sha256, main.book.sha256)
  assert.equal(JSON.parse(row.metadata_json).fileSizeBytes, 3003)
  assert.deepEqual(JSON.parse(row.genres_json), ['Classics'])
  assert.equal(count('book_authors', `book_id='${main.book.id}'`), 2)
  assert.deepEqual(store.listAudioChapters(main.book.id), main.chapters)
})
await check('mixed formats, a NULL duration and identical archive basenames in different folders all survive', () => {
  const list = store.listAudioChapters(main.book.id)
  assert.deepEqual(list.map((c) => c.fileFormat), ['mp3', 'm4b', 'flac'])
  assert.equal(list[1].durationSeconds, null)
  assert.equal(list[0].sourcePath.endsWith('01.mp3') && list[1].sourcePath.endsWith('01.mp3'), true)
  assert.equal(new Set(list.map((c) => c.fileName)).size, 3)
  assert.ok(list.every((c) => !c.fileName.includes('/') && !c.fileName.includes('\\')))
})
await check('the parent book is a normal library entry (lookup by id works)', async () => {
  assert.equal((await store.findById(main.book.id))?.title, 'My Audiobook')
})

console.log('2. identity')
await check('findBySha256 finds the book by its ordered-track hash', async () => {
  assert.equal((await store.findBySha256(main.book.sha256))?.id, main.book.id)
})
await check('the same tracks in another order produce a different parent hash (so a different book)', () => {
  const reversed = [...main.chapters].reverse().map((c) => c.sha256)
  assert.notEqual(audiobookParentSha256(reversed), main.book.sha256)
})
await check('single-file books (and unknown ids) have no chapters', () => {
  assert.deepEqual(store.listAudioChapters('no-such-book'), [])
})

console.log('3. atomicity')
await check('duplicate parent sha ⇒ throws and NOTHING of the second book exists (book, authors, chapters)', () => {
  const dup = makeAudiobook({ sha256: main.book.sha256 })
  const before = { books: count('books'), chapters: count('book_audio_chapters'), links: count('book_authors'), authors: count('authors') }
  assert.throws(() => store.persistImportedAudiobook(dup.book, dup.chapters, ['Brand New Author']), /UNIQUE/)
  assert.deepEqual({ books: count('books'), chapters: count('book_audio_chapters'), links: count('book_authors'), authors: count('authors') }, before)
  assert.equal(count('books', `id='${dup.book.id}'`), 0)
})
await check('a chapter insert failing half-way (id already used by another book) rolls back the book, authors and earlier chapters', () => {
  const victim = makeAudiobook()
  const clash = main.chapters[0].id // valid for validation (name derived from it), but a PRIMARY KEY clash in the DB on the LAST chapter
  victim.chapters[2] = { ...victim.chapters[2], id: clash, fileName: chapterFileName(2, clash, 'flac') }
  const before = { books: count('books'), chapters: count('book_audio_chapters'), links: count('book_authors'), authors: count('authors') }
  assert.throws(() => store.persistImportedAudiobook(victim.book, victim.chapters, ['Another New Author']), /UNIQUE|PRIMARY/)
  assert.deepEqual({ books: count('books'), chapters: count('book_audio_chapters'), links: count('book_authors'), authors: count('authors') }, before)
  assert.equal(count('book_audio_chapters', `book_id='${victim.book.id}'`), 0)
})
await check('other books are untouched by the failures', () => {
  assert.deepEqual(store.listAudioChapters(main.book.id), main.chapters)
})

console.log('4. validation')
await check('refused before any write: <2 chapters, wrong parent format / path / format, bad names, gaps, other book', () => {
  const before = { books: count('books'), chapters: count('book_audio_chapters') }
  const refuse = (mutate, re) => {
    const x = makeAudiobook()
    const r = mutate(x) ?? x
    assert.throws(() => store.persistImportedAudiobook(r.book, r.chapters), re)
  }
  refuse((x) => ({ book: x.book, chapters: x.chapters.slice(0, 1) }), /at least 2/)
  refuse((x) => ({ book: x.book, chapters: [] }), /at least 2/)
  refuse((x) => ({ book: new Book({ ...x.book, format: 'epub' }), chapters: x.chapters }), /not an audio format/)
  refuse((x) => ({ book: new Book({ ...x.book, filePath: `/userData/books/${x.book.id}/other.mp3` }), chapters: x.chapters }), /first chapter file/)
  refuse((x) => ({ book: new Book({ ...x.book, format: 'wav' }), chapters: x.chapters }), /first chapter format/)
  refuse((x) => { x.chapters[1] = { ...x.chapters[1], fileName: '../evil.mp3' } }, /file name/)
  refuse((x) => { x.chapters[1] = { ...x.chapters[1], position: 4 } }, /positions/)
  refuse((x) => { x.chapters[1] = { ...x.chapters[1], bookId: 'other' } }, /another book/)
  refuse((x) => { x.chapters[1] = { ...x.chapters[1], fileFormat: 'aiff' } }, /unsupported format/)
  refuse((x) => { x.chapters[1] = { ...x.chapters[1], durationSeconds: 0 } }, /duration/)
  assert.deepEqual({ books: count('books'), chapters: count('book_audio_chapters') }, before)
})

console.log('5. lifecycle')
await check('deleting the book cascades its chapters (and only its chapters)', async () => {
  const other = makeAudiobook()
  store.persistImportedAudiobook(other.book, other.chapters)
  await store.deleteCascade(main.book.id)
  assert.deepEqual(store.listAudioChapters(main.book.id), [])
  assert.equal(count('book_audio_chapters', `book_id='${main.book.id}'`), 0)
  assert.deepEqual(store.listAudioChapters(other.book.id), other.chapters)
})
await check('single-file persistImportedBook is unchanged (book + authors, no chapters)', () => {
  const id = uuid()
  const single = new Book({ id, title: 'Plain', filePath: `/userData/books/${id}/plain.mp3`, format: 'mp3', sha256: sha('plain'), fileSizeBytes: 5, addedAt: NOW, updatedAt: NOW })
  store.persistImportedBook(single, ['Solo Author'], ['Fiction'])
  assert.equal(count('books', `id='${id}'`), 1)
  assert.equal(count('book_authors', `book_id='${id}'`), 1)
  assert.deepEqual(store.listAudioChapters(id), [])
  assert.throws(() => store.persistImportedBook(new Book({ id: uuid(), title: 'Dup', filePath: '/x/dup.mp3', format: 'mp3', sha256: sha('plain'), addedAt: NOW, updatedAt: NOW })), /UNIQUE/)
})

console.log(`\n${passed} checks passed`)
