/**
 * Integration checks for the TXT reader on the Main side (docs/implementation_plan/txt_reader.md):
 * the real TXT document service + codec + edited-copy store + `SqliteTxtStore` + overlay store on the
 * real migrated schema (node:sqlite, migration 025 included), real files in a temp folder, the real
 * `overlay:*` / `txt:*` IPC handlers. No Electron window, no user data: every path is under os.tmpdir().
 *
 *   1. open        encodings (UTF-8 BOM + CRLF, UTF-16, legacy), empty file, errors, size limit
 *   2. source      the user's file is never written: bytes and mtime identical after every step
 *   3. commit      edited copy on disk + revision, restart, pruning, conflicts, failures, crash leftovers
 *   4. annotations validation, atomic with the text, moved / removed rows, no orphans, isolation
 *   5. lifecycle   reading state is separate, book removal cleans rows + copy, IPC wiring,
 *                  migration 025 on a populated database
 *   6. flow        the SDK document model driving the service: edit → plan → commit → reopen
 *
 * Run: npm run spike:txt:main   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  TXT_EDIT_MAX_CHARS,
  addTxtHighlight,
  buildTxtSelectionText,
  committedTxtState,
  createTxtDocument,
  createTxtPersistedState,
  deriveTextEdit,
  editTxtDocument,
  packTxtAnnotationRef,
  packTxtHighlightLocator,
  planTxtCommit,
  splitAnnotationsByText,
  txtHighlightDtoToReaderHighlight,
  txtHighlightToWire,
  txtReadingLocation,
  resolveTxtReadingOffset,
} from '@reading-book/book-reader-sdk'
import { invoke } from '../pdf-annotations/electron-stub.mjs'
import { getDatabase } from '../pdf-annotations/db-stub.mjs'

const { OverlayChannels, TxtChannels } = await import('../../electron/ipc/channels.ts')
const { registerOverlayIpc } = await import('../../electron/ipc/overlay.ipc.ts')
const { registerTxtIpc } = await import('../../electron/ipc/txt.ipc.ts')
const { getOverlayStore } = await import('../../electron/persistence/sqlite-overlay-store.ts')
const { getTxtStore } = await import('../../electron/persistence/sqlite-txt-store.ts')
const { getLibraryStore } = await import('../../electron/persistence/sqlite-library-store.ts')
const { resolveBookFile } = await import('../../electron/files/sandbox.ts')
const { createTxtDocumentService } = await import('../../electron/txt/txt-document-service.ts')
const { createTxtWorkingCopyStore } = await import('../../electron/txt/txt-working-copy.ts')
const { decodeTxtBytes } = await import('../../electron/txt/txt-codec.ts')
const { getTxtWorkingCopies } = await import('../../electron/txt/txt-storage.ts')
const { removeTxtData } = await import('../../electron/txt/txt-runtime.ts')

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const sha = (data) => createHash('sha256').update(data).digest('hex')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-txt-'))
const copiesRoot = path.join(tmp, 'txt-edits')

const db = getDatabase()
db.exec('PRAGMA foreign_keys = ON')
const insertBook = db.prepare(
  `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at)
   VALUES (?, ?, ?, ?, ?, 'reading', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
)

/** Create a TXT fixture file in the temp folder, register it as a (referenced) book, return its info. */
function addTxtBook(id, bytes, { name = `${id}.txt`, registeredSha } = {}) {
  const file = path.join(tmp, name)
  fs.writeFileSync(file, bytes)
  insertBook.run(id, `Book ${id}`, file, 'txt', registeredSha ?? sha(bytes))
  return { id, file, bytes, sha: sha(bytes) }
}

const SAMPLE = 'Chương 1\r\n\r\nTrời hôm nay rất đẹp 🌳.\r\nLine needle here.\r\nHết. 😀\r\n'
const CANON = 'Chương 1\n\nTrời hôm nay rất đẹp 🌳.\nLine needle here.\nHết. 😀\n'
const bom8 = Buffer.from([0xef, 0xbb, 0xbf])
const sampleBytes = Buffer.concat([bom8, Buffer.from(SAMPLE, 'utf8')])

const copies = createTxtWorkingCopyStore(() => copiesRoot)
const overlays = getOverlayStore()
const txtStore = getTxtStore()
const library = getLibraryStore()
let indexInvalidations = []

function makeService(overrides = {}) {
  return createTxtDocumentService({
    findBook: async (id) => {
      const book = await library.findById(id)
      return book ? { id: book.id, filePath: book.filePath, format: book.format, sha256: book.sha256 } : undefined
    },
    resolveFile: resolveBookFile,
    store: txtStore,
    overlays,
    copies,
    invalidateIndex: (id) => indexInvalidations.push(id),
    ...overrides,
  })
}

let service = makeService()
const noteCount = (bookId) => db.prepare(`SELECT COUNT(*) AS n FROM notes WHERE book_id = ?`).get(bookId).n
const docRow = (bookId) => db.prepare(`SELECT * FROM txt_documents WHERE book_id = ?`).get(bookId)
const filesOf = (bookId) => (fs.existsSync(path.join(copiesRoot, bookId)) ? fs.readdirSync(path.join(copiesRoot, bookId)).sort() : [])

function row(text, needle, extra = {}) {
  const at = text.indexOf(needle)
  assert.ok(at >= 0, `needle ${needle} not in text`)
  return annotationRow(text, at, at + needle.length, extra)
}
let rowCounter = 0
function annotationRow(text, startOffset, endOffset, extra = {}) {
  rowCounter += 1
  return {
    id: extra.id ?? `ann${rowCounter}`,
    locatorRef: packTxtHighlightLocator({ startOffset, endOffset }),
    styleKind: extra.styleKind ?? 'highlight',
    colorHex: '#ffeb3b',
    tags: [],
    note: extra.note,
    selectionTextRef: JSON.stringify(buildTxtSelectionText(text, startOffset, endOffset)),
    txtAnnotationRef: packTxtAnnotationRef({ startOffset, endOffset }),
    createdAt: `2026-10-18T00:00:${String(rowCounter % 60).padStart(2, '0')}.000Z`,
    ...extra,
  }
}

console.log('TXT reader (Main: codec + edited copy + SQLite + IPC)')

// ------------------------------------------------------------------------------------------------
console.log('1. open')
const main = addTxtBook('txt-main', sampleBytes)
const mainSourceSha = main.sha
const mainStat = fs.statSync(main.file)

await check('UTF-8 BOM + CRLF → canonical text (no BOM, LF), revision 0, original file', async () => {
  const opened = await service.open('txt-main')
  assert.equal(opened.ok, true)
  assert.equal(opened.text, CANON)
  assert.equal(opened.revision, 0)
  assert.equal(opened.edited, false)
  assert.equal(opened.editable, true)
  assert.equal(opened.encoding, 'utf-8')
  assert.deepEqual(opened.notices, [])
  assert.deepEqual(opened.highlights, [])
  assert.equal(opened.text.includes('\r'), false)
  assert.equal(opened.text.charCodeAt(0) === 0xfeff, false)
})

await check('Vietnamese, emoji and blank lines come through byte-exact (UTF-8 without BOM, LF)', async () => {
  const text = 'Tiếng Việt: ắ ằ ẳ ẵ ặ — 😀👨‍👩‍👧\n\n\n  spaces  \n'
  addTxtBook('txt-lf', Buffer.from(text, 'utf8'))
  const opened = await service.open('txt-lf')
  assert.equal(opened.text, text)
})

await check('UTF-16 LE / BE with BOM, and BOM-less UTF-16, decode to the same text', async () => {
  const text = 'Xin chào\r\nthế giới 😀'
  const canon = 'Xin chào\nthế giới 😀'
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
  const be = Buffer.from(le)
  for (let i = 2; i + 1 < be.length; i += 2) [be[i], be[i + 1]] = [be[i + 1], be[i]]
  be.set([0xfe, 0xff], 0)
  assert.equal(decodeTxtBytes(le).text, canon)
  assert.equal(decodeTxtBytes(be).text, canon)
  assert.equal(decodeTxtBytes(Buffer.from('plain ascii text, long enough to sample', 'utf16le')).text, 'plain ascii text, long enough to sample')
  assert.equal(decodeTxtBytes(le).encoding, 'utf-16le')
  addTxtBook('txt-16', le)
  assert.equal((await service.open('txt-16')).text, canon)
})

await check('invalid UTF-8 is read as Windows-1252 and says so', async () => {
  addTxtBook('txt-legacy', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])) // "café\n" in 1252
  const opened = await service.open('txt-legacy')
  assert.equal(opened.ok, true)
  assert.equal(opened.text, 'café\n')
  assert.equal(opened.encoding, 'windows-1252')
  assert.deepEqual(opened.notices, ['legacy_encoding'])
})

await check('an empty file opens as empty text', async () => {
  addTxtBook('txt-empty', Buffer.alloc(0))
  const opened = await service.open('txt-empty')
  assert.equal(opened.ok, true)
  assert.equal(opened.text, '')
  assert.equal(opened.revision, 0)
})

await check('HTML / script in the file is plain text (never interpreted by Main either)', async () => {
  const hostile = '<script>alert(1)</script><img src=x onerror=alert(2)>\n&amp; &lt;b&gt;'
  addTxtBook('txt-html', Buffer.from(hostile, 'utf8'))
  assert.equal((await service.open('txt-html')).text, hostile)
})

await check('errors: unknown id, wrong format, missing file, denied path, oversize', async () => {
  assert.equal((await service.open('nope')).errorCode, 'not_found')
  assert.equal((await service.open('')).errorCode, 'not_found')
  assert.equal((await service.open(42)).errorCode, 'not_found')
  insertBook.run('pdf-x', 'Pdf', path.join(tmp, 'x.pdf'), 'pdf', 'sha-pdf-x')
  assert.equal((await service.open('pdf-x')).errorCode, 'not_found')
  const gone = addTxtBook('txt-gone', Buffer.from('bye'))
  fs.rmSync(gone.file)
  assert.equal((await service.open('txt-gone')).errorCode, 'missing_file')
  insertBook.run('txt-denied', 'Denied', path.join(tmp, 'evil.exe'), 'txt', 'sha-denied')
  assert.equal((await service.open('txt-denied')).errorCode, 'path_denied')
  const big = addTxtBook('txt-big', Buffer.alloc(16 * 1024 * 1024 + 1, 0x61))
  const tooBig = await service.open('txt-big')
  assert.equal(tooBig.ok, false)
  assert.equal(tooBig.errorCode, 'too_large')
  assert.equal(tooBig.text, undefined)
  fs.rmSync(big.file)
})

await check('the edit limit: 400 000 characters is editable, one more is read-only', async () => {
  addTxtBook('txt-limit', Buffer.from('x'.repeat(TXT_EDIT_MAX_CHARS)))
  assert.equal((await service.open('txt-limit')).editable, true)
  addTxtBook('txt-long', Buffer.from('y'.repeat(TXT_EDIT_MAX_CHARS + 1)))
  const opened = await service.open('txt-long')
  assert.equal(opened.ok, true)
  assert.equal(opened.editable, false)
  assert.equal(opened.text.length, TXT_EDIT_MAX_CHARS + 1)
})

await check('the source changing behind the app is reported (original file only)', async () => {
  const changed = addTxtBook('txt-changed', Buffer.from('v1'), { registeredSha: sha(Buffer.from('v0')) })
  assert.ok((await service.open('txt-changed')).notices.includes('source_changed'))
  void changed
})

// ------------------------------------------------------------------------------------------------
console.log('2/3. commit — the edited copy, never the original')

await check('first text commit → revision 1, UTF-8/LF copy under txt-edits, SQLite row, source untouched', async () => {
  await service.open('txt-main')
  const edited = CANON.replace('needle', 'NEEDLE!!')
  const result = await service.commit({ bookId: 'txt-main', baseRevision: 0, text: edited, upserts: [], deletedIds: [] })
  assert.deepEqual(result, { ok: true, revision: 1 })
  assert.deepEqual(filesOf('txt-main'), ['r1.txt'])
  assert.equal(fs.readFileSync(path.join(copiesRoot, 'txt-main', 'r1.txt'), 'utf8'), edited)
  const r = docRow('txt-main')
  assert.equal(r.revision, 1)
  assert.equal(r.content_sha256, sha(edited))
  assert.equal(r.char_count, edited.length)
  assert.equal(r.source_sha256, mainSourceSha)
  // The user's own file: same bytes, same mtime.
  assert.equal(sha(fs.readFileSync(main.file)), mainSourceSha)
  assert.equal(fs.statSync(main.file).mtimeMs, mainStat.mtimeMs)
  assert.deepEqual(indexInvalidations, ['txt-main'])
})

await check('"restart": a fresh service on the same DB + folder opens the edited text', async () => {
  service = makeService()
  const opened = await service.open('txt-main')
  assert.equal(opened.edited, true)
  assert.equal(opened.revision, 1)
  assert.equal(opened.text, CANON.replace('needle', 'NEEDLE!!'))
  assert.deepEqual(opened.notices, [])
})

await check('second commit → revision 2, the old revision file is pruned', async () => {
  const result = await service.commit({
    bookId: 'txt-main',
    baseRevision: 1,
    text: CANON.replace('needle', 'NEEDLE!!') + 'tail\n',
    upserts: [],
    deletedIds: [],
  })
  assert.deepEqual(result, { ok: true, revision: 2 })
  assert.deepEqual(filesOf('txt-main'), ['r2.txt'])
})

await check('an identical text is not a new revision', async () => {
  const same = fs.readFileSync(path.join(copiesRoot, 'txt-main', 'r2.txt'), 'utf8')
  const result = await service.commit({ bookId: 'txt-main', baseRevision: 2, text: same, upserts: [], deletedIds: [] })
  assert.deepEqual(result, { ok: true, revision: 2 })
  assert.deepEqual(filesOf('txt-main'), ['r2.txt'])
})

await check('stale base revision, never-opened book, bad input → refused, nothing changes', async () => {
  const before = docRow('txt-main')
  assert.equal((await service.commit({ bookId: 'txt-main', baseRevision: 1, text: 'x', upserts: [], deletedIds: [] })).errorCode, 'conflict')
  assert.equal((await service.commit({ bookId: 'txt-lf', baseRevision: 0, text: 'x', upserts: [], deletedIds: [] })).errorCode, 'conflict')
  assert.equal((await service.commit(null)).errorCode, 'invalid')
  assert.equal((await service.commit({ bookId: 'txt-main', baseRevision: -1, upserts: [], deletedIds: [] })).errorCode, 'invalid')
  assert.equal((await service.commit({ bookId: 'txt-main', baseRevision: 2, text: 5, upserts: [], deletedIds: [] })).errorCode, 'invalid')
  assert.equal((await service.commit({ bookId: 'txt-main', baseRevision: 2, upserts: 'x', deletedIds: [] })).errorCode, 'invalid')
  assert.equal((await service.commit({ bookId: 'txt-main', baseRevision: 2, upserts: [], deletedIds: [7] })).errorCode, 'invalid')
  assert.equal((await service.commit({ bookId: 'nope', baseRevision: 0, upserts: [], deletedIds: [] })).errorCode, 'not_found')
  assert.deepEqual(docRow('txt-main'), before)
  assert.deepEqual(filesOf('txt-main'), ['r2.txt'])
})

await check('an oversized text is refused', async () => {
  const result = await service.commit({
    bookId: 'txt-main',
    baseRevision: 2,
    text: 'x'.repeat(16 * 1024 * 1024 + 1),
    upserts: [],
    deletedIds: [],
  })
  assert.equal(result.errorCode, 'too_large')
  assert.deepEqual(filesOf('txt-main'), ['r2.txt'])
})

await check('disk write fails → write_failed, revision and the previous copy intact', async () => {
  const failing = makeService({ copies: { ...copies, write: async () => { throw new Error('ENOSPC') } } })
  await failing.open('txt-main')
  const result = await failing.commit({ bookId: 'txt-main', baseRevision: 2, text: 'will not be saved', upserts: [], deletedIds: [] })
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, 'write_failed')
  assert.equal(docRow('txt-main').revision, 2)
  assert.deepEqual(filesOf('txt-main'), ['r2.txt'])
  service = makeService()
})

await check('database commit fails → db_failed, the new file is removed, the committed copy untouched', async () => {
  const failing = makeService({
    store: { getDocument: (id) => txtStore.getDocument(id), commit: () => { throw new Error('SQLITE_BUSY') } },
  })
  await failing.open('txt-main')
  const result = await failing.commit({ bookId: 'txt-main', baseRevision: 2, text: 'x'.repeat(10), upserts: [], deletedIds: [] })
  assert.equal(result.errorCode, 'db_failed')
  assert.equal(docRow('txt-main').revision, 2)
  assert.deepEqual(filesOf('txt-main'), ['r2.txt'])
  assert.equal((await service.open('txt-main')).text.endsWith('tail\n'), true)
})

await check('crash leftovers: a stray newer file is ignored on open and cleaned by the next commit', async () => {
  fs.writeFileSync(path.join(copiesRoot, 'txt-main', 'r3.txt'), 'written but never committed')
  fs.writeFileSync(path.join(copiesRoot, 'txt-main', 'r2.txt.dead-beef.tmp'), 'half')
  service = makeService()
  const opened = await service.open('txt-main')
  assert.equal(opened.revision, 2)
  assert.equal(opened.text.endsWith('tail\n'), true)
  const result = await service.commit({ bookId: 'txt-main', baseRevision: 2, text: opened.text + 'more\n', upserts: [], deletedIds: [] })
  assert.deepEqual(result, { ok: true, revision: 3 })
  assert.deepEqual(filesOf('txt-main'), ['r3.txt'])
  assert.equal(fs.readFileSync(path.join(copiesRoot, 'txt-main', 'r3.txt'), 'utf8').endsWith('more\n'), true)
})

await check('corrupted or deleted edited copy → original shown, notice, and saving still works', async () => {
  fs.writeFileSync(path.join(copiesRoot, 'txt-main', 'r3.txt'), 'tampered')
  service = makeService()
  const opened = await service.open('txt-main')
  assert.equal(opened.text, CANON)
  assert.equal(opened.edited, false)
  assert.equal(opened.revision, 3)
  assert.ok(opened.notices.includes('working_copy_lost'))
  const saved = await service.commit({ bookId: 'txt-main', baseRevision: 3, text: CANON + 'recovered\n', upserts: [], deletedIds: [] })
  assert.deepEqual(saved, { ok: true, revision: 4 })

  fs.rmSync(path.join(copiesRoot, 'txt-main', 'r4.txt'))
  service = makeService()
  const lost = await service.open('txt-main')
  assert.ok(lost.notices.includes('working_copy_lost'))
  assert.equal(lost.text, CANON)
})

await check('two overlapping commits for one book run one after the other', async () => {
  addTxtBook('txt-race', Buffer.from('a'))
  const svc = makeService()
  await svc.open('txt-race')
  const first = svc.commit({ bookId: 'txt-race', baseRevision: 0, text: 'ab', upserts: [], deletedIds: [] })
  const second = svc.commit({ bookId: 'txt-race', baseRevision: 0, text: 'ac', upserts: [], deletedIds: [] })
  const [a, b] = await Promise.all([first, second])
  assert.deepEqual(a, { ok: true, revision: 1 })
  assert.equal(b.errorCode, 'conflict')
  assert.equal(fs.readFileSync(path.join(copiesRoot, 'txt-race', 'r1.txt'), 'utf8'), 'ab')
})

assert.equal(sha(fs.readFileSync(main.file)), mainSourceSha, 'source file changed!')
assert.equal(fs.statSync(main.file).mtimeMs, mainStat.mtimeMs, 'source mtime changed!')
await check('after all of that the original file is byte-identical with the same mtime', async () => {})

// ------------------------------------------------------------------------------------------------
console.log('4. annotations')
const annBook = addTxtBook('txt-ann', Buffer.from(SAMPLE, 'utf8'))
service = makeService()
await service.open('txt-ann')

await check('an annotation commits with its text revision; the row is a notes row with txtAnnotation', async () => {
  const a = row(CANON, 'needle', { id: 'a-needle', note: 'remember' })
  const result = await service.commit({ bookId: 'txt-ann', baseRevision: 0, upserts: [a], deletedIds: [] })
  assert.deepEqual(result, { ok: true, revision: 0 })
  assert.equal(docRow('txt-ann'), undefined) // text unchanged → no copy, no revision row
  const json = JSON.parse(db.prepare(`SELECT note_json FROM notes WHERE id = 'a-needle'`).get().note_json)
  assert.equal(json.group, 'annotation')
  assert.equal(json.type, 'highlight')
  assert.deepEqual(json.txtAnnotation, { startOffset: CANON.indexOf('needle'), endOffset: CANON.indexOf('needle') + 6 })
  assert.equal(json.locatorExtended.locator.kind, 'text-offset')
  assert.equal(json.locatorExtended.locator.offset, CANON.indexOf('needle'))
  assert.equal(json.locatorExtended.locator.chapterIndex, 0)
  assert.equal(json.textualValue, 'needle')
  assert.equal(json.note, 'remember')
  assert.equal(json.pdfAnnotation, undefined)
})

await check('reopening returns the row; the SDK maps it back to the same offsets and quote', async () => {
  const opened = await service.open('txt-ann')
  assert.equal(opened.highlights.length, 1)
  const mapped = txtHighlightDtoToReaderHighlight(opened.highlights[0])
  assert.equal(mapped.startOffset, CANON.indexOf('needle'))
  assert.equal(opened.text.slice(mapped.startOffset, mapped.endOffset), 'needle')
  assert.equal(mapped.note, 'remember')
  assert.deepEqual(splitAnnotationsByText([mapped], opened.text).stale, [])
})

await check('all four kinds save; textbox keeps its note', async () => {
  for (const [id, styleKind, needle] of [
    ['k-ul', 'underline', 'Chương'],
    ['k-st', 'strikethrough', 'Trời'],
    ['k-tb', 'textbox', 'Hết'],
  ]) {
    const result = await service.commit({
      bookId: 'txt-ann',
      baseRevision: 0,
      upserts: [row(CANON, needle, { id, styleKind, note: styleKind === 'textbox' ? 'a note' : undefined })],
      deletedIds: [],
    })
    assert.equal(result.ok, true, `${id}: ${JSON.stringify(result)}`)
  }
  const kinds = (await service.open('txt-ann')).highlights.map((h) => h.styleKind).sort()
  assert.deepEqual(kinds, ['highlight', 'strikethrough', 'textbox', 'underline'])
})

await check('an invalid row refuses the WHOLE commit — text revision and other rows unchanged', async () => {
  const before = db.prepare(`SELECT id, note_json FROM notes WHERE book_id = 'txt-ann' ORDER BY id`).all()
  const good = row(CANON, 'rất đẹp', { id: 'good' })
  const cases = {
    'range past the end': annotationRow(CANON, 0, 5, { id: 'bad1', txtAnnotationRef: packTxtAnnotationRef({ startOffset: 0, endOffset: CANON.length + 9 }) }),
    'empty range': { ...row(CANON, 'needle', { id: 'bad2' }), txtAnnotationRef: packTxtAnnotationRef({ startOffset: 4, endOffset: 4 }) },
    'splits an emoji': { ...row(CANON, '🌳', { id: 'bad3' }), txtAnnotationRef: packTxtAnnotationRef({ startOffset: CANON.indexOf('🌳') + 1, endOffset: CANON.indexOf('🌳') + 2 }) },
    'quote not at the offsets': { ...row(CANON, 'needle', { id: 'bad4' }), selectionTextRef: JSON.stringify({ highlight: 'other' }) },
    'locator at another offset': { ...row(CANON, 'needle', { id: 'bad5' }), locatorRef: packTxtHighlightLocator({ startOffset: 0, endOffset: 3 }) },
    'unparseable locator': { ...row(CANON, 'needle', { id: 'bad6' }), locatorRef: '{nope' },
    'unknown style': { ...row(CANON, 'needle', { id: 'bad7' }), styleKind: 'freehand' },
    'missing txtAnnotationRef': { ...row(CANON, 'needle', { id: 'bad8' }), txtAnnotationRef: undefined },
    'oversized note': { ...row(CANON, 'needle', { id: 'bad9' }), note: 'n'.repeat(10_001) },
    'odd id': { ...row(CANON, 'needle', { id: 'x' }), id: '../../etc' },
    'blank color': { ...row(CANON, 'needle', { id: 'bad10' }), colorHex: ' ' },
  }
  for (const [label, bad] of Object.entries(cases)) {
    const result = await service.commit({ bookId: 'txt-ann', baseRevision: 0, text: CANON + 'X', upserts: [good, bad], deletedIds: [] })
    assert.equal(result.ok, false, label)
    assert.equal(result.errorCode, 'invalid', label)
  }
  assert.equal(docRow('txt-ann'), undefined, 'a refused commit must not create a revision')
  assert.deepEqual(filesOf('txt-ann'), [])
  assert.deepEqual(db.prepare(`SELECT id, note_json FROM notes WHERE book_id = 'txt-ann' ORDER BY id`).all(), before)
})

await check('an id that already belongs to another book is refused (nothing overwritten)', async () => {
  const other = addTxtBook('txt-other', Buffer.from(SAMPLE, 'utf8'), { registeredSha: sha('txt-other') })
  const svcOther = makeService()
  await svcOther.open('txt-other')
  await svcOther.commit({ bookId: 'txt-other', baseRevision: 0, upserts: [row(CANON, 'needle', { id: 'other-owned' })], deletedIds: [] })
  const stolen = row(CANON, 'Chương', { id: 'other-owned', note: 'hijack' })
  const result = await service.commit({ bookId: 'txt-ann', baseRevision: 0, upserts: [stolen], deletedIds: [] })
  assert.equal(result.errorCode, 'invalid')
  const owned = db.prepare(`SELECT book_id, note_json FROM notes WHERE id = 'other-owned'`).get()
  assert.equal(owned.book_id, 'txt-other')
  assert.equal(JSON.parse(owned.note_json).note, null)
  void other
})

await check('text + moved rows + removed rows commit atomically; offsets and quotes agree with the new text', async () => {
  let doc = createTxtDocument(CANON, (await service.open('txt-ann')).highlights.map(txtHighlightDtoToReaderHighlight))
  let persisted = createTxtPersistedState(CANON, 0, doc.highlights)
  // Insert before everything (moves all), then type INSIDE "needle" (removes only that one).
  const ctx = (n) => ({ now: n * 10_000, selectionBefore: { start: 0, end: 0 }, selectionAfter: { start: 0, end: 0 } })
  doc = editTxtDocument(doc, { start: 0, deleteLength: 0, insert: '>>> ' }, ctx(1)).doc
  const inside = doc.highlights.find((h) => h.id === 'a-needle')
  doc = editTxtDocument(doc, { start: inside.startOffset + 2, deleteLength: 0, insert: 'ZZ' }, ctx(2)).doc
  assert.equal(doc.highlights.some((h) => h.id === 'a-needle'), false)

  const plan = planTxtCommit(persisted, doc)
  assert.equal(plan.textChanged, true)
  assert.deepEqual(plan.deletedIds, ['a-needle'])
  const result = await service.commit({
    bookId: 'txt-ann',
    baseRevision: 0,
    text: doc.text,
    upserts: plan.upserts.map((h) => ({ bookId: 'txt-ann', ...txtHighlightToWire(h) })),
    deletedIds: plan.deletedIds,
  })
  assert.deepEqual(result, { ok: true, revision: 1 })
  persisted = committedTxtState(doc, 1)

  const reopened = await makeService().open('txt-ann')
  assert.equal(reopened.text, doc.text)
  assert.equal(reopened.revision, 1)
  const rows = reopened.highlights.map(txtHighlightDtoToReaderHighlight)
  assert.deepEqual(rows.map((r) => r.id).sort(), doc.highlights.map((h) => h.id).sort())
  assert.equal(rows.some((r) => r.id === 'a-needle'), false)
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM notes WHERE id = 'a-needle'`).get().n, 0)
  const split = splitAnnotationsByText(rows, reopened.text)
  assert.equal(split.stale.length, 0, 'every stored row must still sit on its quote')
  for (const r of rows) {
    assert.equal(JSON.parse(db.prepare(`SELECT note_json FROM notes WHERE id = ?`).get(r.id).note_json).txtAnnotation.startOffset, r.startOffset)
  }
  assert.equal(planTxtCommit(persisted, { text: reopened.text, highlights: rows }).empty, true)
})

await check('deleting rows leaves no orphans (notes count follows the live rows)', async () => {
  const live = (await service.open('txt-ann')).highlights.map((h) => h.id)
  const result = await service.commit({ bookId: 'txt-ann', baseRevision: 1, upserts: [], deletedIds: live })
  assert.equal(result.ok, true)
  assert.equal(noteCount('txt-ann'), 0)
  assert.equal((await service.open('txt-ann')).highlights.length, 0)
})

await check('a hidden stale row (source changed outside) is left alone — not shifted, not deleted', async () => {
  const text = (await service.open('txt-ann')).text
  const stale = row(text, 'Chương', { id: 'stale-1' })
  assert.equal((await service.commit({ bookId: 'txt-ann', baseRevision: 1, upserts: [stale], deletedIds: [] })).ok, true)
  // Simulate a row whose quote no longer matches (hand-edited DB).
  db.prepare(`UPDATE notes SET note_json = json_set(note_json, '$.locatorExtended.text.highlight', 'something else') WHERE id = 'stale-1'`).run()
  const opened = await service.open('txt-ann')
  const rows = opened.highlights.map(txtHighlightDtoToReaderHighlight)
  const split = splitAnnotationsByText(rows, opened.text)
  assert.deepEqual(split.stale.map((r) => r.id), ['stale-1'])
  assert.equal(noteCount('txt-ann'), 1)
  db.prepare(`DELETE FROM notes WHERE id = 'stale-1'`).run()
})

await check('overlay:saveHighlight refuses TXT rows; overlay:listHighlights still lists them', async () => {
  registerOverlayIpc()
  const a = row(CANON, 'needle', { id: 'viaoverlay' })
  const refused = await invoke(OverlayChannels.saveHighlight, { bookId: 'txt-ann', ...a })
  assert.equal(refused, null)
  assert.equal(noteCount('txt-ann'), 0)
  const text = (await service.open('txt-ann')).text
  assert.equal((await service.commit({ bookId: 'txt-ann', baseRevision: 1, upserts: [row(text, 'Hết', { id: 'listed' })], deletedIds: [] })).ok, true)
  const listed = await invoke(OverlayChannels.listHighlights, 'txt-ann')
  assert.equal(listed.length, 1)
  assert.deepEqual(JSON.parse(listed[0].txtAnnotationRef), { startOffset: text.indexOf('Hết'), endOffset: text.indexOf('Hết') + 3 })
  const deleted = await invoke(OverlayChannels.deleteHighlight, { bookId: 'txt-ann', id: 'listed' })
  assert.equal(deleted.ok, true)
})

await check('books are isolated: committing one book never touches another book rows or revision', async () => {
  const otherRows = db.prepare(`SELECT id, note_json FROM notes WHERE book_id = 'txt-other'`).all()
  const otherRev = docRow('txt-other')
  await service.commit({ bookId: 'txt-ann', baseRevision: 1, text: 'brand new', upserts: [], deletedIds: [] })
  assert.deepEqual(db.prepare(`SELECT id, note_json FROM notes WHERE book_id = 'txt-other'`).all(), otherRows)
  assert.equal(docRow('txt-other'), otherRev)
})

// ------------------------------------------------------------------------------------------------
console.log('5. lifecycle')

await check('reading position is stored beside, not over, the text and annotations', async () => {
  const opened = await makeService().open('txt-main')
  const location = txtReadingLocation(40, opened.text.length).toString()
  const saved = await invoke(OverlayChannels.saveSessionState, { bookId: 'txt-main', lastReadLocation: location, percent: 12 })
  assert.equal(saved.ok, true)
  const state = await invoke(OverlayChannels.getSessionState, 'txt-main')
  assert.equal(resolveTxtReadingOffset(state.lastReadLocation, opened.text.length), 40)
  const again = await makeService().open('txt-main')
  assert.equal(again.text, opened.text)
  assert.equal(again.revision, opened.revision)
  // An offset past the (now shorter) text clamps.
  assert.equal(resolveTxtReadingOffset(location, 10), 10)
})

await check('removing a book: SQLite rows cascade, the edited copy folder is deleted, the original stays', async () => {
  const victim = addTxtBook('txt-victim', Buffer.from('victim text'))
  const svc = makeService()
  await svc.open('txt-victim')
  await svc.commit({ bookId: 'txt-victim', baseRevision: 0, text: 'victim text edited', upserts: [row('victim text edited', 'edited', { id: 'v1' })], deletedIds: [] })
  assert.equal(noteCount('txt-victim'), 1)
  assert.ok(docRow('txt-victim'))
  assert.deepEqual(filesOf('txt-victim'), ['r1.txt'])
  const rowsBefore = noteCount('txt-main')
  await library.deleteCascade('txt-victim')
  assert.equal(noteCount('txt-victim'), 0)
  assert.equal(docRow('txt-victim'), undefined)
  // The real wiring: uses {userData}/txt-edits; here only prove it is safe on a missing folder…
  await removeTxtData('txt-victim')
  // …and with the folder API this spike controls:
  await copies.remove('txt-victim')
  assert.deepEqual(filesOf('txt-victim'), [])
  assert.equal(fs.existsSync(victim.file), true, 'the original file must stay')
  assert.equal(noteCount('txt-main'), rowsBefore)
})

await check('the edited-copy store refuses ids that could leave its folder', async () => {
  for (const bad of ['..', '../x', 'a/b', 'a\\b', '', ' ', 'x'.repeat(200), 'a.b']) {
    await assert.rejects(() => copies.remove(bad), undefined, `id ${JSON.stringify(bad)}`)
    await assert.rejects(() => copies.write(bad, 1, 'x'))
  }
  await assert.rejects(() => copies.write('ok', 0, 'x'))
  await assert.rejects(() => copies.write('ok', 1.5, 'x'))
  assert.equal(fs.existsSync(path.join(tmp, 'x')), false)
})

await check('txt:open / txt:commit are registered and validate their arguments', async () => {
  registerTxtIpc()
  const bad = await invoke(TxtChannels.open, { not: 'a string' })
  assert.equal(bad.ok, false)
  assert.equal(bad.errorCode, 'not_found')
  const refused = await invoke(TxtChannels.commit, 'nonsense')
  assert.equal(refused.ok, false)
  assert.equal(refused.errorCode, 'invalid')
  // Real wiring end to end on a throw-away book (copies go to the stub userData folder).
  addTxtBook('txt-ipc', Buffer.from(SAMPLE, 'utf8'), { registeredSha: sha('txt-ipc') })
  const opened = await invoke(TxtChannels.open, 'txt-ipc')
  assert.equal(opened.ok, true)
  assert.equal(opened.text, CANON)
  const saved = await invoke(TxtChannels.commit, { bookId: 'txt-ipc', baseRevision: 0, text: CANON + 'ipc\n', upserts: [], deletedIds: [] })
  assert.deepEqual(saved, { ok: true, revision: 1 })
  assert.equal((await invoke(TxtChannels.open, 'txt-ipc')).text, CANON + 'ipc\n')
  await removeTxtData('txt-ipc')
  assert.equal(await getTxtWorkingCopies().read('txt-ipc', 1), null)
})

// ------------------------------------------------------------------------------------------------
await check('migration 025 on a database that already holds books and notes: nothing changes, one table appears', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const dir = new URL('../../electron/persistence/migrations/', import.meta.url)
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.startsWith('021_')).sort()
  const old = new DatabaseSync(':memory:')
  for (const f of files.filter((f) => f < '025')) old.exec(fs.readFileSync(new URL(f, dir), 'utf8'))
  assert.equal(old.prepare(`SELECT name FROM sqlite_master WHERE name = 'txt_documents'`).get(), undefined)
  old
    .prepare(
      `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at)
       VALUES ('b1', 'Old', '/old.epub', 'epub', 'old-sha', 'reading', '{"percent":42}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    )
    .run()
  old.prepare(`INSERT INTO notes (id, book_id, note_json, created_at, updated_at) VALUES ('n1', 'b1', '{"type":"highlight"}', 't', 't')`).run()
  const snapshot = (db) => JSON.stringify([db.prepare('SELECT * FROM books').all(), db.prepare('SELECT * FROM notes').all()])
  const before = snapshot(old)
  old.exec(fs.readFileSync(new URL('025_txt_documents.sql', dir), 'utf8'))
  assert.equal(snapshot(old), before, 'existing rows must be untouched')
  assert.ok(old.prepare(`SELECT name FROM sqlite_master WHERE name = 'txt_documents'`).get())
  // Re-running is harmless (IF NOT EXISTS) and the cascade is wired.
  old.exec(fs.readFileSync(new URL('025_txt_documents.sql', dir), 'utf8'))
  old.exec('PRAGMA foreign_keys = ON')
  old.prepare(`INSERT INTO txt_documents (book_id, revision, content_sha256, char_count, updated_at) VALUES ('b1', 1, 'x', 3, 't')`).run()
  old.prepare(`DELETE FROM books WHERE id = 'b1'`).run()
  assert.equal(old.prepare('SELECT COUNT(*) AS n FROM txt_documents').get().n, 0)
})

console.log('6. flow')

await check('SDK document → keystrokes → commit plan → service → reopen gives the same document', async () => {
  const file = addTxtBook('txt-flow', Buffer.from(SAMPLE, 'utf8'), { registeredSha: sha('txt-flow') })
  const svc = makeService()
  const first = await svc.open('txt-flow')
  let revision = first.revision
  let doc = createTxtDocument(first.text)
  let persisted = createTxtPersistedState(first.text, revision, [])

  const send = async () => {
    const plan = planTxtCommit(persisted, doc)
    if (plan.empty) return
    const result = await svc.commit({
      bookId: 'txt-flow',
      baseRevision: revision,
      text: plan.textChanged ? doc.text : undefined,
      upserts: plan.upserts.map((h) => ({ bookId: 'txt-flow', ...txtHighlightToWire(h) })),
      deletedIds: plan.deletedIds,
    })
    assert.equal(result.ok, true, JSON.stringify(result))
    revision = result.revision
    persisted = committedTxtState(doc, revision)
  }
  const type = (caret, ch, n) => {
    const after = doc.text.slice(0, caret) + ch + doc.text.slice(caret)
    const edit = deriveTextEdit(doc.text, after, { selectionStart: caret, selectionEnd: caret, inputType: 'insertText' })
    doc = editTxtDocument(doc, edit, { now: n * 10_000, selectionBefore: { start: caret, end: caret }, selectionAfter: { start: caret + 1, end: caret + 1 } }).doc
  }

  const at = doc.text.indexOf('needle')
  const mk = (needle, extra) => {
    const s = doc.text.indexOf(needle)
    return { id: extra.id, locatorRef: packTxtHighlightLocator({ startOffset: s, endOffset: s + needle.length }), startOffset: s, endOffset: s + needle.length, chapterIndex: 0, styleKind: extra.styleKind ?? 'highlight', colorHex: '#ffeb3b', tags: [], selectionText: buildTxtSelectionText(doc.text, s, s + needle.length), createdAt: extra.createdAt, updatedAt: extra.createdAt }
  }
  doc = addTxtHighlight(doc, mk('needle', { id: 'f-needle', createdAt: '2026-10-18T01:00:00.000Z' }))
  doc = addTxtHighlight(doc, mk('Trời hôm nay', { id: 'f-troi', createdAt: '2026-10-18T01:00:01.000Z', styleKind: 'underline' }))
  await send()
  type(0, 'A', 1) // before everything → both move
  type(doc.text.indexOf('Hết') + 1, 'é', 2) // after both → untouched
  type(doc.highlights.find((h) => h.id === 'f-needle').startOffset + 2, 'x', 3) // inside → removed
  await send()

  const reopened = await makeService().open('txt-flow')
  assert.equal(reopened.text, doc.text)
  assert.equal(reopened.revision, revision)
  const rows = reopened.highlights.map(txtHighlightDtoToReaderHighlight)
  assert.deepEqual(rows.map((r) => [r.id, r.startOffset, r.endOffset, r.styleKind]).sort(), doc.highlights.map((h) => [h.id, h.startOffset, h.endOffset, h.styleKind]).sort())
  assert.deepEqual(rows.map((r) => r.id), ['f-troi'])
  assert.equal(reopened.text.slice(rows[0].startOffset, rows[0].endOffset), 'Trời hôm nay')
  assert.equal(sha(fs.readFileSync(file.file)), file.sha, 'the original must be untouched')
  void at
})

fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 })
fs.rmSync(path.join(os.tmpdir(), 'readmate-spike-userdata'), { recursive: true, force: true, maxRetries: 3 })
console.log(`\n${passed} checks passed`)
