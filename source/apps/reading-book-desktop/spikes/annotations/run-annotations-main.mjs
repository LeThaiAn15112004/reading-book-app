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
 *   4. import   round trip per format (restore, second import adds nothing, created time kept), a failure mid-write rolls back,
 *               stale preview, source ids of other books, refused files, a missing book file, the target choice, PDF sync
 *               duplicates, a PDF that cannot be scanned, a PDF whose bytes changed
 *   (identity by title and different editions, the readable copy and performance checks come with tasks T033, T037, T041)
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
  locator: { kind: 'page-rect', page: 1 }, pdfAnnotation: { pageIndex: 0, rects: [{ x: 0.2, y: 0.4, width: 0.3, height: 0.1 }], shape: { strokeWidth: 0.004 } },
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
  locator: { kind: 'text-offset', offset: 0, blockId: 'md', chapterIndex: 4 }, mdAnnotation: mdAnchor,
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

// =================================================================================================================
// 4. import — the real import service on the same stores, the dialog / file read / PDF scan stubbed
// =================================================================================================================
const { createImportService } = await import('../../electron/annotation-transfer/import-service.ts')
const { planTwoWaySync } = await import('@reading-book/book-reader-sdk')

const events = []
let nextImportFile = null
let scanKeys = new Set()
let scanThrows = false
let failOnWrite = 0
let writes = 0
let newIdCounter = 0

function importDeps(over = {}) {
  return {
    pickFilePath: async () => nextImportFile,
    readText: async (p) => fs.readFileSync(p, 'utf8'),
    library,
    findBook: async (id) => {
      const b = await library.findById(id)
      return b ? { id: b.id, title: b.title, author: b.authorNames() || undefined, format: b.format, sha256: b.sha256, pageCount: b.pageCount } : null
    },
    bookFileAvailable: async (id) => {
      const b = await library.findById(id)
      return !!b && fs.existsSync(b.filePath)
    },
    scanPdfKeys: async () => {
      if (scanThrows) throw new Error('encrypted')
      return scanKeys
    },
    listRows: (id) => overlays.listAnnotationsForTransfer(id),
    existingNoteIds: (ids) => overlays.existingNoteIds(ids),
    bookSha256: (id) => db.prepare('SELECT sha256 FROM books WHERE id = ?').get(id)?.sha256,
    txtState: (id) => {
      const d = txtStore.getDocument(id)
      return { revision: d?.revision ?? 0, contentSha256: d?.contentSha256 }
    },
    writeRow: (input) => {
      writes += 1
      if (failOnWrite && writes >= failOnWrite) throw new Error('disk full (injected)')
      overlays.writeHighlight(input)
    },
    db,
    newId: () => `new-${++newIdCounter}`,
    progress: (e) => events.push(e),
    ...over,
  }
}
const service = () => createImportService(importDeps())

/** Content of a book's annotation rows in a comparable form (ids and times left out). */
function contentOf(bookId) {
  return overlays
    .listAnnotationsForTransfer(bookId)
    .map((r) => JSON.stringify({ t: r.note.type, l: r.note.locatorExtended?.locator, q: r.note.locatorExtended?.text, n: r.note.note ?? null, c: r.note.style?.colorHex, p: r.note.pdfAnnotation ?? null, x: r.note.txtAnnotation ?? null, m: r.note.mdAnnotation ?? null }))
    .sort()
}
const noteRows = (bookId) => db.prepare('SELECT id, note_json FROM notes WHERE book_id = ? ORDER BY id').all(bookId).map((r) => `${r.id}:${r.note_json}`)
function wipe(bookId) {
  db.prepare(`DELETE FROM notes WHERE book_id = ? AND json_extract(note_json, '$.type') NOT IN ('bookmark', 'ink')`).run(bookId)
  db.prepare('DELETE FROM pdf_embedded_annotations WHERE book_id = ?').run(bookId)
}
async function exportTo(bookId, name) {
  pick = outFile(name)
  const r = await run(bookId)
  assert.equal(r.ok, true, `export ${bookId}`)
  return pick
}
const writeFile = (name, text) => {
  const p = outFile(name)
  fs.writeFileSync(p, text)
  return p
}
async function preview(file, bookId) {
  nextImportFile = file
  return service().pickFile({ bookId })
}

// the Markdown book's file was deleted in section 3: put it back (same bytes, same hash)
fs.writeFileSync(books.md.file, Buffer.from('# Từ vựng N3\n\nCách tra cứu'))
books.md.gone = false

console.log('4. import — restore')
for (const [name, bookId, expected] of [['EPUB', books.epub.id, 2], ['PDF', books.pdf.id, 4], ['TXT', books.txt.id, 1], ['Markdown', books.md.id, 1]]) {
  await check(`${name}: export, wipe, import restores the same annotations; a second import adds nothing`, async () => {
    const file = await exportTo(bookId, `rt-${name}.readmate-notes.json`)
    const before = contentOf(bookId)
    const beforeIds = overlays.listAnnotationsForTransfer(bookId).map((r) => r.id).sort()
    wipe(bookId)
    assert.deepEqual(contentOf(bookId), [])
    scanKeys = new Set()
    const svc = service()
    nextImportFile = file
    const pre = await svc.pickFile({ bookId })
    assert.equal(pre.ok, true, JSON.stringify(pre))
    assert.equal(pre.preview.toAdd, expected, JSON.stringify(pre.preview.notPlaced))
    assert.equal(pre.preview.present, 0)
    assert.equal(pre.preview.notPlaced.length, 0)
    assert.equal(pre.preview.requiresChoice, false)
    assert.equal(pre.preview.target.bookId, bookId)
    assert.equal(pre.preview.target.matchedBy, 'sha256')
    assert.equal(pre.preview.startedFrom.bookId, bookId)
    const done = await svc.confirm(pre.preview.sessionId)
    assert.deepEqual(done, { ok: true, added: expected, present: 0, notPlaced: 0 })
    assert.deepEqual(contentOf(bookId), before, 'same type, location, quote, comment, colour and payload')
    assert.deepEqual(overlays.listAnnotationsForTransfer(bookId).map((r) => r.id).sort(), beforeIds, 'free source ids are reused')
    // second import: nothing new (SC-003)
    const rowsAfter = noteRows(bookId)
    const svc2 = service()
    nextImportFile = file
    const p2 = await svc2.pickFile({ bookId })
    assert.equal(p2.preview.toAdd, 0)
    assert.equal(p2.preview.present, expected)
    assert.deepEqual(await svc2.confirm(p2.preview.sessionId), { ok: true, added: 0, present: expected, notPlaced: 0 })
    assert.deepEqual(noteRows(bookId), rowsAfter, 'the second import changed no row')
  })
}

await check('created time is restored, the modified time is the import time', async () => {
  const rows = overlays.listAnnotationsForTransfer(books.epub.id)
  assert.ok(rows.every((r) => r.createdAt === T0), 'created time restored')
  assert.ok(rows.every((r) => r.updatedAt > T0), 'modified = import time')
})

await check('PDF typewriter text, shape colour and Vietnamese survive the round trip byte for byte', () => {
  const byId = Object.fromEntries(overlays.listAnnotationsForTransfer(books.pdf.id).map((r) => [r.id, r.note]))
  assert.equal(byId['pdf-tw'].note, typewriterText)
  assert.equal(byId['pdf-shape'].style.colorHex, '#1E88E5CC')
  assert.equal(byId['pdf-app'].locatorExtended.text.highlight, 'đoạn trong PDF')
  const epubQuote = overlays.listAnnotationsForTransfer(books.epub.id).find((r) => r.id === 'e1').note
  assert.equal(epubQuote.note, 'Câu chủ đề của cuốn sách — “ế, ộ, ữ”')
})

console.log('5. import — safety')
await check('an injected failure in the middle of the write rolls everything back', async () => {
  const file = await exportTo(books.epub.id, 'fail.readmate-notes.json')
  wipe(books.epub.id)
  const before = noteRows(books.epub.id)
  const svc = createImportService(importDeps())
  nextImportFile = file
  const pre = await svc.pickFile({ bookId: books.epub.id })
  assert.equal(pre.preview.toAdd, 2)
  writes = 0
  failOnWrite = 2
  const result = await svc.confirm(pre.preview.sessionId)
  failOnWrite = 0
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'write_failed')
  assert.deepEqual(noteRows(books.epub.id), before, 'the first row written was rolled back too')
  // the connection is not left inside a transaction, and the session survives for a retry
  db.exec('BEGIN IMMEDIATE')
  db.exec('ROLLBACK')
  const retry = await svc.confirm(pre.preview.sessionId)
  assert.deepEqual(retry, { ok: true, added: 2, present: 0, notPlaced: 0 })
})

await check('a book that changed between preview and confirm gives stale_preview and writes nothing; a new preview then works', async () => {
  const file = await exportTo(books.epub.id, 'stale.readmate-notes.json')
  wipe(books.epub.id)
  const svc = service()
  nextImportFile = file
  const pre = await svc.pickFile({ bookId: books.epub.id })
  // (a) an annotation appears in the book after the preview
  overlays.writeHighlight({ bookId: books.epub.id, id: 'late', styleKind: 'highlight', colorHex: '#FFEB3B', locator: { kind: 'cfi', cfi: 'epubcfi(/6/99)', chapterIndex: 1 }, selectionText: { highlight: 'late' } })
  const before = noteRows(books.epub.id)
  const stale = await svc.confirm(pre.preview.sessionId)
  assert.equal(stale.errorCode, 'stale_preview')
  assert.deepEqual(noteRows(books.epub.id), before)
  const fresh = await svc.setTarget(pre.preview.sessionId, books.epub.id)
  assert.equal(fresh.ok, true)
  assert.equal(fresh.preview.toAdd, 2)
  assert.deepEqual(await svc.confirm(pre.preview.sessionId), { ok: true, added: 2, present: 0, notPlaced: 0 })
  // (b) the book's fingerprint changes after the preview
  overlays.deleteHighlightRow(books.epub.id, 'late')
  wipe(books.epub.id)
  nextImportFile = file
  const pre2 = await svc.pickFile({ bookId: books.epub.id })
  db.prepare('UPDATE books SET sha256 = ? WHERE id = ?').run('f'.repeat(64), books.epub.id)
  const stale2 = await svc.confirm(pre2.preview.sessionId)
  assert.equal(stale2.errorCode, 'stale_preview')
  assert.deepEqual(contentOf(books.epub.id), [])
  db.prepare('UPDATE books SET sha256 = ? WHERE id = ?').run(books.epub.hash, books.epub.id)
  const back = await svc.setTarget(pre2.preview.sessionId, books.epub.id)
  assert.equal(back.preview.toAdd, 2)
  assert.equal((await svc.confirm(pre2.preview.sessionId)).ok, true)
})

await check('a source id that exists in another book is never overwritten', async () => {
  const before = db.prepare(`SELECT note_json FROM notes WHERE id = 'pdf-app'`).get().note_json
  const sample = JSON.parse(fs.readFileSync(await exportTo(books.epub.id, 'clash-src.readmate-notes.json'), 'utf8'))
  const clash = { ...sample, annotations: [{ ...sample.annotations[0], sourceId: 'pdf-app', note: 'khác hẳn', selectionText: { highlight: 'clash quote' } }] }
  const file = writeFile('clash.readmate-notes.json', JSON.stringify(clash))
  const svc = service()
  nextImportFile = file
  const pre = await svc.pickFile({ bookId: books.epub.id })
  assert.equal(pre.preview.toAdd, 1)
  assert.deepEqual(await svc.confirm(pre.preview.sessionId), { ok: true, added: 1, present: 0, notPlaced: 0 })
  assert.equal(db.prepare(`SELECT note_json FROM notes WHERE id = 'pdf-app'`).get().note_json, before, 'the PDF row is untouched')
  const row = overlays.listAnnotationsForTransfer(books.epub.id).find((r) => r.note.locatorExtended?.text?.highlight === 'clash quote')
  assert.ok(row && row.id.startsWith('new-'), 'stored under a new id')
  db.prepare('DELETE FROM notes WHERE id = ?').run(row.id)
})

await check('refused files change nothing: damaged, not ours, readable copy, newer version', async () => {
  const good = fs.readFileSync(await exportTo(books.epub.id, 'good.readmate-notes.json'), 'utf8')
  const rowsBefore = noteRows(books.epub.id)
  const cases = [
    ['truncated', writeFile('t.readmate-notes.json', good.slice(0, good.length - 30)), 'damaged'],
    ['not JSON', writeFile('notes.txt', 'just some words'), 'not_annotation_file'],
    ['other JSON', writeFile('other.json', '{"a":1}'), 'not_annotation_file'],
    ['readable copy', writeFile('Nhà Giả Kim.md', '# Nhà Giả Kim — Paulo Coelho\n\n## Chương 3\n> quote\n'), 'not_annotation_file'],
    ['newer version', writeFile('v2.readmate-notes.json', JSON.stringify({ ...JSON.parse(good), fileVersion: 2 })), 'newer_version'],
  ]
  for (const [label, file, code] of cases) {
    const r = await preview(file, books.epub.id)
    assert.equal(r.ok, false, label)
    assert.equal(r.errorCode, code, label)
  }
  const md = await preview(outFile('Nhà Giả Kim.md'), books.epub.id)
  assert.match(md.message, /readable copy/i, 'the .md answer says it cannot be imported')
  assert.deepEqual(noteRows(books.epub.id), rowsBefore)
  nextImportFile = null
  assert.deepEqual(await service().pickFile({ bookId: books.epub.id }), { ok: false, errorCode: 'cancelled', message: undefined })
})

await check('a target whose book file is missing gives file_unavailable and writes nothing; after relinking it imports', async () => {
  const file = await exportTo(books.epub.id, 'moved.readmate-notes.json')
  wipe(books.epub.id)
  fs.renameSync(books.epub.file, `${books.epub.file}.moved`)
  const r = await preview(file, books.epub.id)
  assert.equal(r.ok, false)
  assert.equal(r.errorCode, 'file_unavailable')
  assert.match(r.message, /relink/i)
  assert.deepEqual(contentOf(books.epub.id), [])
  fs.renameSync(`${books.epub.file}.moved`, books.epub.file)
  const svc = service()
  nextImportFile = file
  const ok = await svc.pickFile({ bookId: books.epub.id })
  assert.equal(ok.ok, true)
  assert.deepEqual(await svc.confirm(ok.preview.sessionId), { ok: true, added: 2, present: 0, notPlaced: 0 })
})

await check('a file from another book needs a deliberate target choice; confirm before the choice writes nothing', async () => {
  // restore the EPUB rows removed above, then use the TXT book's file from the EPUB book's menu
  const txtFile = await exportTo(books.txt.id, 'txt-from-epub.readmate-notes.json')
  const rowsBefore = noteRows(books.epub.id)
  const svc = service()
  nextImportFile = txtFile
  const pre = await svc.pickFile({ bookId: books.epub.id })
  assert.equal(pre.ok, true)
  assert.equal(pre.preview.requiresChoice, true)
  assert.equal(pre.preview.startedFrom.bookId, books.epub.id)
  assert.equal(pre.preview.target.bookId, books.txt.id, 'the file\'s own book is proposed')
  assert.equal((await svc.confirm(pre.preview.sessionId)).errorCode, 'target_not_confirmed')
  assert.deepEqual(noteRows(books.epub.id), rowsBefore)
  // choosing the EPUB book (a different format) is refused
  const mismatch = await svc.setTarget(pre.preview.sessionId, books.epub.id)
  assert.equal(mismatch.ok, false)
  assert.equal(mismatch.errorCode, 'format_mismatch')
  assert.equal((await svc.confirm(pre.preview.sessionId)).errorCode, 'target_not_confirmed', 'still not chosen')
  // choosing the proposed book works and is explicit
  const chosen = await svc.setTarget(pre.preview.sessionId, books.txt.id)
  assert.equal(chosen.ok, true)
  assert.equal(chosen.preview.requiresChoice, false)
  assert.equal(chosen.preview.target.matchedBy, 'chosen')
  assert.equal(chosen.preview.present, 1, 'the TXT book already holds that annotation')
})

await check('a file whose book is not in the library names it and cannot be imported until a book is chosen', async () => {
  const sample = JSON.parse(fs.readFileSync(outFile('rt-EPUB.readmate-notes.json'), 'utf8'))
  const missing = { ...sample, book: { ...sample.book, title: 'Sách không có', sha256: 'a'.repeat(64) } }
  const file = writeFile('missing.readmate-notes.json', JSON.stringify(missing))
  const svc = service()
  nextImportFile = file
  const pre = await svc.pickFile({ bookId: books.epub.id })
  assert.equal(pre.ok, true)
  assert.equal(pre.preview.target, null)
  assert.equal(pre.preview.requiresChoice, true)
  assert.deepEqual(pre.preview.fileBookMissing, { title: 'Sách không có', author: undefined })
  assert.equal((await svc.confirm(pre.preview.sessionId)).errorCode, 'book_missing')
  // a deliberate choice of the EPUB book works: a different edition, so nothing can be placed
  const chosen = await svc.setTarget(pre.preview.sessionId, books.epub.id)
  assert.equal(chosen.ok, true)
  assert.equal(chosen.preview.toAdd, 0)
  assert.equal(chosen.preview.notPlaced.length, 2)
  assert.equal(chosen.preview.notPlaced[0].reason, 'different edition of the book')
})

console.log('6. import — PDF')
await check('a PDF that still holds an annotation read from the file does not get a duplicate row or a duplicate in the sync plan', async () => {
  const file = outFile('rt-PDF.readmate-notes.json')
  wipe(books.pdf.id)
  // what a scan of the target PDF finds: the Foxit-style markup and the one Readmate wrote earlier
  const foxit = { objectId: '7R', subtype: 'Underline', pageIndex: 2, rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.02 }], colorHex: '#00E676', nm: 'Foxit-1234', text: 'markup from Foxit' }
  const ours = { objectId: '9R', subtype: 'Highlight', pageIndex: 11, rects: [pdfRect], colorHex: '#FFEB3B', nm: 'readmate:pdf-app', text: 'đoạn trong PDF', contents: 'ghi chú PDF' }
  scanKeys = new Set([...embeddedAnnotationIdentities([foxit, ours]).flatMap((i) => [i.key, i.legacyKey])])
  const svc = service()
  nextImportFile = file
  const pre = await svc.pickFile({ bookId: books.pdf.id })
  assert.equal(pre.ok, true)
  assert.equal(pre.preview.present, 1, 'the Foxit annotation is still in the file')
  assert.equal(pre.preview.toAdd, 3)
  assert.equal((await svc.confirm(pre.preview.sessionId)).ok, true)
  assert.ok(!overlays.listAnnotationsForTransfer(books.pdf.id).some((r) => r.id === 'pdf-file'), 'no row for the annotation the file already carries')
  // the two-way plan on the same scan: our own annotation is linked to the imported row (same id), the Foxit one is imported once
  const rows = (await overlays.listHighlights(books.pdf.id)).map((h) => ({ ...h, createdAt: h.createdAt, updatedAt: h.updatedAt }))
  const plan = planTwoWaySync({ items: [foxit, ours], complete: true, ledger: [], rows })
  assert.deepEqual(plan.links.map((l) => l.noteId), ['pdf-app'], 'readmate:<id> finds the row under its reused id')
  assert.equal(plan.inserts.length, 1, 'only the Foxit annotation becomes a new row')
  assert.equal(plan.inserts[0].item.nm, 'Foxit-1234')
  assert.ok(!plan.writtenRows.some((w) => w.noteId === 'pdf-app'), 'the imported row is not written into the file a second time')
  assert.deepEqual(plan.writtenRows.map((w) => w.noteId).sort(), ['pdf-shape', 'pdf-tw'], 'only rows the file does not hold yet are written')
})

await check('a PDF that cannot be scanned (encrypted, broken) still stores the annotations in the app', async () => {
  const file = outFile('rt-PDF.readmate-notes.json')
  wipe(books.pdf.id)
  scanThrows = true
  const svc = service()
  nextImportFile = file
  const pre = await svc.pickFile({ bookId: books.pdf.id })
  scanThrows = false
  assert.equal(pre.ok, true)
  assert.equal(pre.preview.toAdd, 4)
  assert.equal((await svc.confirm(pre.preview.sessionId)).ok, true)
  assert.equal(overlays.countAnnotationsForTransfer(books.pdf.id), 4)
})

await check('a PDF whose bytes changed after the export still imports when title, author and page count match', async () => {
  const file = outFile('rt-PDF.readmate-notes.json')
  wipe(books.pdf.id)
  db.prepare('UPDATE books SET sha256 = ? WHERE id = ?').run('9'.repeat(64), books.pdf.id)
  scanKeys = new Set()
  const pre = await preview(file, books.pdf.id)
  assert.equal(pre.ok, true)
  assert.equal(pre.preview.target.matchedBy, 'title')
  assert.equal(pre.preview.toAdd, 4, 'same document, 120 pages on both sides')
  db.prepare('UPDATE books SET sha256 = ? WHERE id = ?').run(books.pdf.hash, books.pdf.id)
})

await check('import never touches a book file', () => {
  for (const b of bookFiles) {
    if (b.gone) continue
    assert.equal(sha(fs.readFileSync(b.file)), b.hash, `${b.id} content`)
    assert.equal(fs.statSync(b.file).size, b.size, `${b.id} size`)
  }
  assert.ok(events.some((e) => e.phase === 'reading') && events.some((e) => e.phase === 'planning') && events.some((e) => e.phase === 'committing'), 'progress events were sent')
})

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`annotations main spike: ${passed} checks passed`)
