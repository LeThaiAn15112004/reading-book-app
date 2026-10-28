/**
 * Annotation import / export — Main side (specs/006-annotation-import-export): the real export service, the real
 * overlay / library / TXT stores on the real migrated schema (node:sqlite), real files in a temp folder. The save
 * dialog is stubbed; no Electron window, no user data: every path is under os.tmpdir().
 *
 *   1. export   a book of each format (EPUB, PDF, TXT, Markdown): exact JSON, Vietnamese bytes, typewriter text,
 *               PDF origin (made in the app vs read from the file), TXT content fingerprint, page count, order
 *   2. refusal  empty book (no dialog), cancelled dialog (nothing written), audiobook / unknown id, forbidden folder
 *   3. safety   a failing target leaves no temp file, the book file is never read or changed, a moved / deleted book
 *               file does not stop the export
 *   (import, identity, readable copy and performance checks are added by tasks T027, T033, T037, T041)
 *
 * Run: npm run spike:annotations:main   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FILE_EXTENSION, embeddedAnnotationIdentities, parseAnnotationFile } from '@reading-book/book-reader-sdk'

const { getDatabase } = await import('../pdf-annotations/db-stub.mjs')
const { getOverlayStore } = await import('../../electron/persistence/sqlite-overlay-store.ts')
const { getTxtStore } = await import('../../electron/persistence/sqlite-txt-store.ts')
const { getLibraryStore } = await import('../../electron/persistence/sqlite-library-store.ts')
const { exportRestoreAnnotations, defaultRestoreFileName, withRestoreExtension } = await import('../../electron/annotation-transfer/export-service.ts')
const { writeFileSafely } = await import('../../electron/pdf-sync/pdf-annotation-export.ts')

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const sha = (data) => createHash('sha256').update(data).digest('hex')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-annotations-'))
const outDir = path.join(tmp, 'out')
const userData = path.join(tmp, 'userData')
fs.mkdirSync(outDir)
fs.mkdirSync(userData)

const db = getDatabase()
db.exec('PRAGMA foreign_keys = ON')
const insertBook = db.prepare(
  `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, metadata_json, added_at, updated_at)
   VALUES (?, ?, ?, ?, ?, 'reading', '{}', ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
)

/** Register a (referenced) book with a real file; returns the info needed to check the file is untouched. */
function addBook(id, title, format, bytes, metadata = {}) {
  const file = path.join(tmp, `${id}.${format}`)
  fs.writeFileSync(file, bytes)
  insertBook.run(id, title, file, format, sha(bytes), JSON.stringify(metadata))
  const stat = fs.statSync(file)
  return { id, file, hash: sha(bytes), mtimeMs: stat.mtimeMs, size: stat.size }
}

const overlays = getOverlayStore()
const txtStore = getTxtStore()
const library = getLibraryStore()
const T0 = '2026-10-20T13:01:12.000Z'

const books = {
  epub: addBook('b-epub', 'Nhà Giả Kim', 'epub', Buffer.from('epub bytes')),
  pdf: addBook('b-pdf', 'Sổ tay PDF', 'pdf', Buffer.from('%PDF-1.7 fake'), { pageCount: 120 }),
  txt: addBook('b-txt', 'Truyện Kiều', 'txt', Buffer.from('Trăm năm trong cõi người ta')),
  md: addBook('b-md', 'Từ vựng N3', 'md', Buffer.from('# Từ vựng N3\n\nCách tra cứu')),
  empty: addBook('b-empty', 'Sách trống', 'epub', Buffer.from('empty')),
  audio: addBook('b-audio', 'Audio', 'mp3', Buffer.from('mp3')),
}
const bookFiles = Object.values(books)

// ---- seed annotations through the real store ------------------------------------------------------------------
const note = (over) => overlays.writeHighlight({ createdAt: T0, colorHex: '#FFEB3B', ...over })

note({
  id: 'e2', bookId: books.epub.id, styleKind: 'strikethrough', colorHex: '#F44336',
  locator: { kind: 'cfi', cfi: 'epubcfi(/6/20!/4/2/10,/1:12,/1:23)', chapterIndex: 9 },
  selectionText: { highlight: 'đã quá muộn' },
})
note({
  id: 'e1', bookId: books.epub.id, styleKind: 'highlight',
  locator: { kind: 'cfi', cfi: 'epubcfi(/6/14!/4/2/6,/1:0,/1:63)', chapterIndex: 6 },
  selectionText: { before: 'Ông lão nói: ', highlight: 'Khi bạn muốn một điều gì, cả vũ trụ sẽ hợp lực giúp bạn đạt được.', after: ' Rồi im lặng.' },
  note: 'Câu chủ đề của cuốn sách — “ế, ộ, ữ”',
})

const pdfRect = { x: 0.12, y: 0.31, width: 0.55, height: 0.02 }
note({
  id: 'pdf-app', bookId: books.pdf.id, styleKind: 'highlight',
  locator: { kind: 'page-rect', page: 12 }, pdfAnnotation: { pageIndex: 11, rects: [pdfRect] },
  selectionText: { highlight: 'đoạn trong PDF' }, note: 'ghi chú PDF',
})
note({
  id: 'pdf-file', bookId: books.pdf.id, styleKind: 'underline', colorHex: '#00E676',
  locator: { kind: 'page-rect', page: 3 }, pdfAnnotation: { pageIndex: 2, rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.02 }] },
  selectionText: { highlight: 'markup from Foxit' },
})
note({
  id: 'pdf-shape', bookId: books.pdf.id, styleKind: 'rectangle', colorHex: '#1E88E5CC',
  locator: { kind: 'page-rect', page: 1 }, pdfAnnotation: { pageIndex: 0, rects: [{ x: 0.2, y: 0.4, width: 0.3, height: 0.1 }], shape: { kind: 'rectangle' } },
})
const typewriterText = '  Dòng đầu\n   dòng hai  '
note({
  id: 'pdf-tw', bookId: books.pdf.id, styleKind: 'typewriter',
  locator: { kind: 'page-rect', page: 5 }, pdfAnnotation: { pageIndex: 4, rects: [{ x: 0.1, y: 0.5, width: 0.5, height: 0.2 }] },
  note: typewriterText,
})
// PDF sync ledger: 'pdf-app' was written into the file by Readmate (`readmate:pdf-app`), 'pdf-file' was read from it.
const ledger = db.prepare(
  `INSERT INTO pdf_embedded_annotations (book_id, source_key, note_id, source_hash, note_hash, imported_at, synced_at)
   VALUES (?, ?, ?, 'h', 'h', ?, ?)`,
)
const keyOf = (pageIndex, nm) => embeddedAnnotationIdentities([{ subtype: 'Highlight', pageIndex, rects: [], nm }])[0].key
const appKey = keyOf(11, 'readmate:pdf-app')
const fileKey = keyOf(2, 'Foxit-1234')
ledger.run(books.pdf.id, appKey, 'pdf-app', T0, T0)
ledger.run(books.pdf.id, fileKey, 'pdf-file', T0, T0)

const txtHash = sha('Trăm năm trong cõi người ta\n')
db.prepare(`INSERT INTO txt_documents (book_id, revision, content_sha256, char_count, source_sha256, updated_at) VALUES (?, 2, ?, 29, ?, ?)`).run(
  books.txt.id, txtHash, books.txt.hash, T0,
)
note({
  id: 'txt1', bookId: books.txt.id, styleKind: 'highlight',
  locator: { kind: 'text-offset', offset: 0, blockId: 'txt' }, txtAnnotation: { startOffset: 0, endOffset: 9 },
  selectionText: { highlight: 'Trăm năm ' }, note: 'câu mở đầu',
})
const mdAnchor = { startSegment: 4, startOffset: 0, endSegment: 4, endOffset: 38 }
note({
  id: 'md1', bookId: books.md.id, styleKind: 'highlight',
  locator: { kind: 'text-offset', offset: 0, blockId: 'md' }, mdAnnotation: mdAnchor,
  selectionText: { highlight: 'Cách tra cứu (Ctrl + click):' },
})
// Rows that are NOT annotations: a bookmark and a freehand ink stroke must never be exported or counted.
const rawNote = db.prepare(`INSERT INTO notes (id, book_id, note_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
rawNote.run('bm1', books.epub.id, JSON.stringify({ schemaVersion: 1, type: 'bookmark', group: 'bookmark', locatorExtended: { locator: { kind: 'cfi', cfi: 'epubcfi(/6/2)' } } }), T0, T0)
rawNote.run('ink1', books.pdf.id, JSON.stringify({ schemaVersion: 1, type: 'ink', group: 'annotation', locatorExtended: { locator: { kind: 'page-rect', page: 2 } } }), T0, T0)

// ---- the service under test, with a stubbed dialog ------------------------------------------------------------
const dialogCalls = []
let pick = null
function deps(over = {}) {
  return {
    findBook: async (id) => {
      const b = await library.findById(id)
      return b ? { id: b.id, title: b.title, author: b.authorNames() || undefined, format: b.format, sha256: b.sha256, pageCount: b.pageCount } : null
    },
    listRows: (id) => overlays.listAnnotationsForTransfer(id),
    ledger: (id) => overlays.listEmbeddedLedger(id),
    txtContentSha256: (id) => txtStore.getDocument(id)?.contentSha256,
    chooseTarget: async (name) => {
      dialogCalls.push(name)
      return pick
    },
    isForbiddenTarget: (target) => path.resolve(target).startsWith(userData),
    write: writeFileSafely,
    appVersion: '9.9.9',
    now: () => new Date('2026-10-28T02:15:00.000Z'),
    ...over,
  }
}
const run = (bookId, over) => exportRestoreAnnotations(bookId, deps(over))
const readParsed = (file) => {
  const parsed = parseAnnotationFile(fs.readFileSync(file, 'utf8'))
  assert.equal(parsed.ok, true, 'the exported file parses')
  assert.deepEqual(parsed.rejected, [])
  return parsed.file
}
const outFile = (name) => path.join(outDir, name)

console.log('1. export')
await check('names: the default file name and the extension rule', () => {
  assert.equal(defaultRestoreFileName('Nhà Giả Kim'), 'Nhà Giả Kim.readmate-notes.json')
  assert.equal(defaultRestoreFileName('a:b*c?d'), 'a b c d.readmate-notes.json')
  assert.equal(withRestoreExtension('x.json'), 'x.readmate-notes.json')
  assert.equal(withRestoreExtension('x'), 'x.readmate-notes.json')
  assert.equal(withRestoreExtension('x.readmate-notes.json'), 'x.readmate-notes.json')
  assert.equal(withRestoreExtension('X.READMATE-NOTES.JSON'), 'X.READMATE-NOTES.JSON')
  assert.equal(FILE_EXTENSION, '.readmate-notes.json')
})

await check('the count and the export leave bookmarks and ink out', () => {
  assert.equal(overlays.countAnnotationsForTransfer(books.epub.id), 2)
  assert.equal(overlays.countAnnotationsForTransfer(books.pdf.id), 4)
  assert.equal(overlays.countAnnotationsForTransfer(books.empty.id), 0)
  assert.equal(overlays.countAnnotationsForTransfer('missing'), 0)
})

await check('EPUB: quote, comment, colour, times, CFI, Vietnamese bytes, reading order', async () => {
  const target = outFile('epub.readmate-notes.json')
  pick = target
  dialogCalls.length = 0
  const result = await run(books.epub.id)
  assert.deepEqual(result, { ok: true, exported: 2 })
  assert.deepEqual(dialogCalls, ['Nhà Giả Kim.readmate-notes.json'])
  const text = fs.readFileSync(target, 'utf8')
  assert.ok(text.includes('Khi bạn muốn một điều gì, cả vũ trụ sẽ hợp lực giúp bạn đạt được.'), 'quote is written as plain Unicode')
  assert.ok(text.includes('Câu chủ đề của cuốn sách — “ế, ộ, ữ”'), 'comment is written as plain Unicode')
  const file = readParsed(target)
  assert.equal(file.fileVersion, 1)
  assert.equal(file.exportedBy, 'Readmate 9.9.9')
  assert.equal(file.exportedAt, '2026-10-28T02:15:00.000Z')
  assert.deepEqual(file.book, { title: 'Nhà Giả Kim', format: 'epub', sha256: books.epub.hash })
  assert.deepEqual(file.annotations.map((a) => a.sourceId), ['e1', 'e2'], 'chapter 6 before chapter 9')
  const a = file.annotations[0]
  assert.equal(a.type, 'highlight')
  assert.equal(a.colorHex, '#FFEB3B')
  assert.equal(a.note, 'Câu chủ đề của cuốn sách — “ế, ộ, ữ”')
  assert.equal(a.createdAt, T0)
  assert.equal(a.origin, 'app')
  assert.deepEqual(a.locator, { kind: 'cfi', cfi: 'epubcfi(/6/14!/4/2/6,/1:0,/1:63)', chapterIndex: 6 })
  assert.deepEqual(a.selectionText, { before: 'Ông lão nói: ', highlight: 'Khi bạn muốn một điều gì, cả vũ trụ sẽ hợp lực giúp bạn đạt được.', after: ' Rồi im lặng.' })
  assert.equal(file.annotations[1].type, 'strikethrough')
  assert.equal(file.annotations[1].colorHex, '#F44336')
  assert.equal(file.txt, undefined)
})

await check('PDF: page count, rects, shape colour with alpha, typewriter text, origin app vs file', async () => {
  const target = outFile('pdf.readmate-notes.json')
  pick = target
  assert.deepEqual(await run(books.pdf.id), { ok: true, exported: 4 })
  const file = readParsed(target)
  assert.equal(file.book.pageCount, 120)
  const byId = Object.fromEntries(file.annotations.map((a) => [a.sourceId, a]))
  assert.deepEqual(Object.keys(byId).sort(), ['pdf-app', 'pdf-file', 'pdf-shape', 'pdf-tw'])
  assert.deepEqual(byId['pdf-app'].pdfAnnotation, { pageIndex: 11, rects: [pdfRect] })
  assert.deepEqual(byId['pdf-app'].locator, { kind: 'page-rect', page: 12 })
  assert.equal(byId['pdf-app'].origin, 'app', 'written into the file by Readmate itself')
  assert.equal(byId['pdf-app'].sourceKeys, undefined)
  assert.equal(byId['pdf-file'].origin, 'file', 'read from the PDF (another reader made it)')
  assert.deepEqual(byId['pdf-file'].sourceKeys, [fileKey])
  assert.equal(byId['pdf-shape'].colorHex, '#1E88E5CC')
  assert.equal(byId['pdf-shape'].selectionText, undefined)
  assert.equal(byId['pdf-tw'].note, typewriterText, 'typewriter text keeps its spaces and line breaks')
  assert.deepEqual(file.annotations.map((a) => a.sourceId), ['pdf-shape', 'pdf-file', 'pdf-tw', 'pdf-app'], 'page order 1, 3, 5, 12')
})

await check('TXT: offsets and the content fingerprint of the edited copy', async () => {
  const target = outFile('txt.readmate-notes.json')
  pick = target
  assert.deepEqual(await run(books.txt.id), { ok: true, exported: 1 })
  const file = readParsed(target)
  assert.deepEqual(file.txt, { contentSha256: txtHash })
  assert.deepEqual(file.annotations[0].txtAnnotation, { startOffset: 0, endOffset: 9 })
  assert.equal(file.annotations[0].note, 'câu mở đầu')
})

await check('Markdown: the anchor, no txt header', async () => {
  const target = outFile('md.readmate-notes.json')
  pick = target
  assert.deepEqual(await run(books.md.id), { ok: true, exported: 1 })
  const file = readParsed(target)
  assert.equal(file.txt, undefined)
  assert.deepEqual(file.annotations[0].mdAnnotation, mdAnchor)
  assert.equal(file.annotations[0].selectionText.highlight, 'Cách tra cứu (Ctrl + click):')
})

await check('a plain .json choice is saved with the .readmate-notes.json extension', async () => {
  pick = outFile('chosen.json')
  assert.equal((await run(books.md.id)).ok, true)
  assert.ok(fs.existsSync(outFile('chosen.readmate-notes.json')))
  assert.ok(!fs.existsSync(outFile('chosen.json')))
})

console.log('2. refusal')
await check('an empty book answers `empty` before any dialog and writes nothing', async () => {
  dialogCalls.length = 0
  pick = outFile('empty.readmate-notes.json')
  const result = await run(books.empty.id)
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'empty')
  assert.deepEqual(dialogCalls, [])
  assert.ok(!fs.existsSync(pick))
})

await check('a cancelled dialog writes nothing', async () => {
  const before = fs.readdirSync(outDir).sort()
  pick = null
  assert.deepEqual(await run(books.epub.id), { ok: false, errorCode: 'cancelled' })
  assert.deepEqual(fs.readdirSync(outDir).sort(), before)
})

await check('an audiobook and an unknown id answer `not_found`', async () => {
  dialogCalls.length = 0
  pick = outFile('nope.readmate-notes.json')
  assert.deepEqual(await run(books.audio.id), { ok: false, errorCode: 'not_found' })
  assert.deepEqual(await run('missing'), { ok: false, errorCode: 'not_found' })
  assert.deepEqual(dialogCalls, [])
  assert.ok(!fs.existsSync(pick))
})

await check('a target inside the app data folder is refused and nothing is written', async () => {
  pick = path.join(userData, 'x.readmate-notes.json')
  const result = await run(books.epub.id)
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'write_failed')
  assert.deepEqual(fs.readdirSync(userData), [])
})

console.log('3. safety')
await check('a target that cannot be written leaves no partial or temp file', async () => {
  // (a) the parent is a file: the temp file cannot even be created
  pick = path.join(books.epub.file, 'x.readmate-notes.json')
  let result = await run(books.epub.id)
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'write_failed')
  // (b) the target is an existing folder: the temp file is written, the rename fails, the temp file must be removed
  const blocker = outFile('blocked.readmate-notes.json')
  fs.mkdirSync(blocker)
  pick = blocker
  const before = fs.readdirSync(outDir).sort()
  result = await run(books.epub.id)
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'write_failed')
  assert.deepEqual(fs.readdirSync(outDir).sort(), before, 'no temp file left next to the target')
  assert.ok(fs.statSync(blocker).isDirectory(), 'the existing folder is untouched')
})

await check('export still works after the book file was moved, and after it was deleted', async () => {
  const moved = `${books.md.file}.moved`
  fs.renameSync(books.md.file, moved)
  pick = outFile('md-moved.readmate-notes.json')
  assert.deepEqual(await run(books.md.id), { ok: true, exported: 1 })
  fs.rmSync(moved)
  pick = outFile('md-deleted.readmate-notes.json')
  assert.deepEqual(await run(books.md.id), { ok: true, exported: 1 })
  books.md.gone = true
})

await check('book files are never changed (hash, size and modification time)', () => {
  for (const b of bookFiles) {
    if (b.gone) continue
    const stat = fs.statSync(b.file)
    assert.equal(sha(fs.readFileSync(b.file)), b.hash, `${b.id} content`)
    assert.equal(stat.size, b.size, `${b.id} size`)
    assert.equal(stat.mtimeMs, b.mtimeMs, `${b.id} mtime`)
  }
  assert.deepEqual(fs.readdirSync(tmp).filter((f) => f.endsWith('.tmp') || f.includes('.readmate-')), [], 'no temp file next to a book')
})

await check('the database rows are unchanged by exports', () => {
  assert.equal(overlays.countAnnotationsForTransfer(books.epub.id), 2)
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM notes`).get().n, 10, "2 EPUB + bookmark + 4 PDF + ink + TXT + Markdown")
})

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`annotations main spike: ${passed} checks passed`)
