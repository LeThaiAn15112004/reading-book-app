/**
 * Annotation import / export — the REAL renderer store (`annotationTransferStore`, the one behind the import dialog and
 * the Reader's reload) against the REAL Main import service on the real migrated schema (specs/006-annotation-import-export).
 * Only the native dialog, the file read and the PDF scan are stubbed: no Electron window, nothing outside os.tmpdir().
 *
 *   1. flow      preview → confirm → result toast; the dialog state at every step; progress events reach the store
 *   2. refusal   cancelled picker, a file that cannot be imported, a failed confirm: what the dialog shows, nothing written
 *   3. choice    a file from another book: `requiresChoice`, no import before the choice, a refused choice keeps the preview
 *   4. stale     the book changed after the preview: a fresh preview for the same book, then the import goes through
 *   5. reload    the open book's annotations are reloaded exactly once after a committed import — never after a rollback,
 *                a stale preview, a refused confirm or a cancel; never for another book; the per-format reloaders
 *
 * Run: npm run spike:annotations:store   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { getDatabase } = await import('../pdf-annotations/db-stub.mjs')
const { getOverlayStore } = await import('../../electron/persistence/sqlite-overlay-store.ts')
const { getTxtStore } = await import('../../electron/persistence/sqlite-txt-store.ts')
const { getLibraryStore } = await import('../../electron/persistence/sqlite-library-store.ts')
const { exportRestoreAnnotations } = await import('../../electron/annotation-transfer/export-service.ts')
const { createImportService } = await import('../../electron/annotation-transfer/import-service.ts')
const { writeFileSafely } = await import('../../electron/pdf-sync/pdf-annotation-export.ts')

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}
const sha = (data) => createHash('sha256').update(data).digest('hex')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-annotations-store-'))

// ---- real Main side ---------------------------------------------------------------------------------------------
const db = getDatabase()
db.exec('PRAGMA foreign_keys = ON')
const insertBook = db.prepare(
  `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, metadata_json, added_at, updated_at)
   VALUES (?, ?, ?, ?, ?, 'reading', '{}', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
)
function addBook(id, title, format) {
  const bytes = Buffer.from(`${format} bytes of ${id}`)
  const file = path.join(tmp, `${id}.${format}`)
  fs.writeFileSync(file, bytes)
  insertBook.run(id, title, file, format, sha(bytes))
  return { id, file }
}
const bookA = addBook('book-a', 'Sách A', 'epub')
const bookB = addBook('book-b', 'Sách B', 'epub')
const bookT = addBook('book-t', 'Văn bản T', 'txt')

const overlays = getOverlayStore()
const txtStore = getTxtStore()
const library = getLibraryStore()
const T0 = '2026-10-20T13:01:12.000Z'
const note = (over) => overlays.writeHighlight({ createdAt: T0, colorHex: '#FFEB3B', styleKind: 'highlight', ...over })
const cfi = (n) => ({ kind: 'cfi', cfi: `epubcfi(/6/${n})`, chapterIndex: n })
note({ id: 'a1', bookId: bookA.id, locator: cfi(2), selectionText: { highlight: 'câu một' }, note: 'ghi chú 1' })
note({ id: 'a2', bookId: bookA.id, locator: cfi(4), selectionText: { highlight: 'câu hai' } })

let pickedFile = null
let scanKeys = new Set()
let failOnWrite = false
const progressHandlers = new Set()
const calls = { discard: [], pick: 0 }

function importDeps() {
  return {
    pickFilePath: async () => {
      calls.pick += 1
      return pickedFile
    },
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
    scanPdfKeys: async () => ({ keys: scanKeys }),
    listRows: (id) => overlays.listAnnotationsForTransfer(id),
    annotationStamp: (id) => overlays.annotationStamp(id),
    existingNoteIds: (ids) => overlays.existingNoteIds(ids),
    bookSha256: (id) => db.prepare('SELECT sha256 FROM books WHERE id = ?').get(id)?.sha256,
    txtState: (id) => {
      const d = txtStore.getDocument(id)
      return { revision: d?.revision ?? 0, contentSha256: d?.contentSha256 }
    },
    writeRow: (input) => {
      if (failOnWrite) throw new Error('disk full (injected)')
      overlays.writeHighlight(input)
    },
    db,
    newId: (() => {
      let n = 0
      return () => `gen-${++n}`
    })(),
    progress: (e) => {
      for (const h of progressHandlers) h(e)
    },
  }
}
const service = createImportService(importDeps())
const exportDeps = {
  findBook: async (id) => {
    const b = await library.findById(id)
    return b ? { id: b.id, title: b.title, author: undefined, format: b.format, sha256: b.sha256, pageCount: b.pageCount } : null
  },
  listRows: (id) => overlays.listAnnotationsForTransfer(id),
  ledger: (id) => overlays.listEmbeddedLedger(id),
  txtContentSha256: (id) => txtStore.getDocument(id)?.contentSha256,
  chooseTarget: async () => null,
  isForbiddenTarget: () => false,
  write: writeFileSafely,
  appVersion: '9.9.9',
}
async function exportFile(bookId, name) {
  const file = path.join(tmp, name)
  const r = await exportRestoreAnnotations(bookId, { ...exportDeps, chooseTarget: async () => file })
  assert.equal(r.ok, true)
  return file
}
const wipe = (bookId) => db.prepare(`DELETE FROM notes WHERE book_id = ?`).run(bookId)
const rowsOf = (bookId) => db.prepare('SELECT id, note_json FROM notes WHERE book_id = ? ORDER BY id').all(bookId).map((r) => `${r.id}:${r.note_json}`)

// ---- the window.api the store talks to: the real services behind it ---------------------------------------------
globalThis.window = {
  api: {
    annotationTransfer: {
      count: async (id) => ({ count: overlays.countAnnotationsForTransfer(id) }),
      exportRestore: async (id) => exportRestoreAnnotations(id, exportDeps),
      exportReadable: async () => ({ ok: false, errorCode: 'not_found' }),
      pickFile: (input) => service.pickFile(input),
      setTarget: (sessionId, bookId) => service.setTarget(sessionId, bookId),
      confirm: (sessionId) => service.confirm(sessionId),
      discard: async (sessionId) => {
        calls.discard.push(sessionId)
        return service.discard(sessionId)
      },
      cancel: async (sessionId) => service.cancel(sessionId),
      onProgress: (handler) => {
        progressHandlers.add(handler)
        return () => progressHandlers.delete(handler)
      },
    },
  },
}

const { useAnnotationTransferStore, registerAnnotationReloader, supportsAnnotationTransfer } = await import('../../src/screens/Reader/logic/annotationTransferStore.ts')
const store = useAnnotationTransferStore
const toasts = []
const onToast = (m) => toasts.push(m)
const reset = () => {
  store.getState().closeImport()
  store.setState({ importFailure: null, preview: null, picking: false, importing: false, progress: null })
  toasts.length = 0
}

console.log('1. flow')
await check('supportsAnnotationTransfer: the four text formats only', () => {
  for (const f of ['epub', 'pdf', 'txt', 'md']) assert.equal(supportsAnnotationTransfer(f), true)
  for (const f of ['mp3', 'm4b', 'docx', '', null, undefined]) assert.equal(supportsAnnotationTransfer(f), false)
})

await check('count asks Main; export goes through the real export service', async () => {
  await store.getState().refreshCount(bookA.id)
  assert.equal(store.getState().count, 2)
  assert.equal(store.getState().countBookId, bookA.id)
})

await check('preview → confirm: dialog state at every step, progress reaches the store, result toast', async () => {
  reset()
  const file = await exportFile(bookA.id, 'a.readmate-notes.json')
  const before = rowsOf(bookA.id)
  wipe(bookA.id)
  pickedFile = file
  const states = []
  const unsub = store.subscribe((s) => states.push([s.picking, s.importing, s.preview ? 'preview' : 'none']))
  await store.getState().startImport(bookA.id)
  let s = store.getState()
  assert.equal(s.preview.toAdd, 2)
  assert.equal(s.preview.present, 0)
  assert.equal(s.preview.requiresChoice, false)
  assert.equal(s.preview.target.bookId, bookA.id)
  assert.equal(s.picking, false)
  assert.equal(s.importFailure, null)
  assert.ok(states.some(([picking]) => picking === true), 'picking was on while waiting for the dialog')
  assert.ok(s.progress && ['reading', 'planning'].includes(s.progress.phase), 'a progress event arrived')
  assert.deepEqual(rowsOf(bookA.id), [], 'nothing is written by the preview')
  await store.getState().confirmImport(onToast)
  unsub()
  s = store.getState()
  assert.equal(s.preview, null)
  assert.equal(s.importing, false)
  assert.equal(s.progress.phase, 'committing')
  assert.equal(toasts.length, 1)
  assert.match(toasts[0], /2 added, 0 already there, 0 could not be placed/)
  assert.ok(states.some(([, importing]) => importing === true), 'importing was on during the write')
  assert.deepEqual(rowsOf(bookA.id).map((r) => r.split(':')[0]), before.map((r) => r.split(':')[0]))
})

console.log('2. refusal')
await check('a cancelled picker changes nothing and shows nothing', async () => {
  reset()
  pickedFile = null
  await store.getState().startImport(bookA.id)
  const s = store.getState()
  assert.equal(s.preview, null)
  assert.equal(s.importFailure, null)
  assert.equal(s.picking, false)
})

await check('a file that cannot be imported shows why and writes nothing', async () => {
  reset()
  const before = rowsOf(bookA.id)
  const bad = path.join(tmp, 'readable.md')
  fs.writeFileSync(bad, '# Sách A\n> câu một\n')
  pickedFile = bad
  await store.getState().startImport(bookA.id)
  let s = store.getState()
  assert.equal(s.preview, null)
  assert.equal(s.importFailure.errorCode, 'not_annotation_file')
  assert.match(s.importFailure.message, /readable copy/i)
  s.closeImport()
  assert.equal(store.getState().importFailure, null)
  const trunc = path.join(tmp, 'trunc.readmate-notes.json')
  const good = fs.readFileSync(await exportFile(bookA.id, 'good.readmate-notes.json'), 'utf8')
  fs.writeFileSync(trunc, good.slice(0, good.length - 25))
  pickedFile = trunc
  await store.getState().startImport(bookA.id)
  assert.equal(store.getState().importFailure.errorCode, 'damaged')
  assert.deepEqual(rowsOf(bookA.id), before)
})

await check('a failed write (rolled back) leaves the preview, shows the error and writes nothing', async () => {
  reset()
  const file = await exportFile(bookA.id, 'rb.readmate-notes.json')
  wipe(bookA.id)
  pickedFile = file
  await store.getState().startImport(bookA.id)
  failOnWrite = true
  await store.getState().confirmImport(onToast)
  failOnWrite = false
  const s = store.getState()
  assert.equal(s.importFailure.errorCode, 'write_failed')
  assert.equal(s.importing, false)
  assert.ok(s.preview, 'the preview stays so the user can retry')
  assert.deepEqual(rowsOf(bookA.id), [])
  assert.deepEqual(toasts, [], 'no success toast')
  await store.getState().confirmImport(onToast)
  assert.equal(store.getState().preview, null, 'the retry works')
  assert.equal(overlays.countAnnotationsForTransfer(bookA.id), 2)
})

console.log('3. choice')
await check('a file from another book needs a deliberate choice; a refused choice keeps the preview', async () => {
  reset()
  note({ id: 'b1', bookId: bookB.id, locator: cfi(8), selectionText: { highlight: 'câu của B' } })
  const fileB = await exportFile(bookB.id, 'b.readmate-notes.json')
  const beforeA = rowsOf(bookA.id)
  pickedFile = fileB
  await store.getState().startImport(bookA.id)
  let s = store.getState()
  assert.equal(s.preview.requiresChoice, true)
  assert.equal(s.preview.startedFrom.bookId, bookA.id)
  assert.equal(s.preview.target.bookId, bookB.id)
  await store.getState().confirmImport(onToast)
  s = store.getState()
  assert.equal(s.importFailure.errorCode, 'target_not_confirmed')
  assert.ok(s.preview, 'still previewing')
  assert.deepEqual(rowsOf(bookA.id), beforeA)
  // a txt book is a different format: choosing it is refused and the preview stays
  await store.getState().chooseTarget(bookT.id)
  s = store.getState()
  assert.equal(s.importFailure.errorCode, 'format_mismatch')
  assert.equal(s.preview.requiresChoice, true)
  // choosing the proposed book (it already holds the annotation)
  await store.getState().chooseTarget(bookB.id)
  s = store.getState()
  assert.equal(s.importFailure, null)
  assert.equal(s.preview.requiresChoice, false)
  assert.equal(s.preview.target.matchedBy, 'chosen')
  assert.equal(s.preview.present, 1)
  // or deliberately importing into the book it was started from: a different edition, nothing can be placed
  await store.getState().chooseTarget(bookA.id)
  s = store.getState()
  assert.equal(s.preview.target.bookId, bookA.id)
  assert.equal(s.preview.toAdd, 0)
  assert.equal(s.preview.notPlaced.length, 1)
})

console.log('4. stale')
await check('a book that changed after the preview gets a fresh preview for the same book, then the import goes through', async () => {
  reset()
  const file = await exportFile(bookA.id, 'stale.readmate-notes.json')
  wipe(bookA.id)
  pickedFile = file
  await store.getState().startImport(bookA.id)
  note({ id: 'late', bookId: bookA.id, locator: cfi(30), selectionText: { highlight: 'đến muộn' } })
  const before = rowsOf(bookA.id)
  await store.getState().confirmImport(onToast)
  let s = store.getState()
  assert.equal(s.importFailure.errorCode, 'stale_preview')
  assert.equal(s.preview.toAdd, 2, 'a fresh preview for the same book')
  assert.deepEqual(rowsOf(bookA.id), before)
  assert.deepEqual(toasts, [])
  await store.getState().confirmImport(onToast)
  s = store.getState()
  assert.equal(s.preview, null)
  assert.equal(overlays.countAnnotationsForTransfer(bookA.id), 3)
})

console.log('5. reload of the open book')
await check('exactly one reload after a committed import into the open book', async () => {
  reset()
  const file = await exportFile(bookA.id, 'rl.readmate-notes.json')
  wipe(bookA.id)
  let reloads = 0
  const off = registerAnnotationReloader(bookA.id, async () => {
    reloads += 1
    return true
  })
  pickedFile = file
  await store.getState().startImport(bookA.id)
  assert.equal(reloads, 0, 'the preview reloads nothing')
  await store.getState().confirmImport(onToast)
  assert.equal(reloads, 1)
  assert.ok(!/reopen/.test(toasts[0]))
  off()
})

await check('no reload after a rollback, a stale preview, a refused confirm or a cancel', async () => {
  const file = await exportFile(bookA.id, 'rl2.readmate-notes.json')
  let reloads = 0
  const off = registerAnnotationReloader(bookA.id, async () => {
    reloads += 1
    return true
  })
  // rollback
  reset()
  wipe(bookA.id)
  pickedFile = file
  await store.getState().startImport(bookA.id)
  failOnWrite = true
  await store.getState().confirmImport(onToast)
  failOnWrite = false
  // stale
  note({ id: 'late2', bookId: bookA.id, locator: cfi(31), selectionText: { highlight: 'trễ' } })
  await store.getState().confirmImport(onToast)
  assert.equal(store.getState().importFailure.errorCode, 'stale_preview')
  // cancel
  store.getState().closeImport()
  // refused confirm (file from another book, no choice made)
  const fileB = await exportFile(bookB.id, 'rl-b.readmate-notes.json')
  pickedFile = fileB
  await store.getState().startImport(bookA.id)
  await store.getState().confirmImport(onToast)
  assert.equal(store.getState().importFailure.errorCode, 'target_not_confirmed')
  store.getState().closeImport()
  assert.equal(reloads, 0)
  off()
})

await check('importing into a book that is not open reloads nothing; a reloader that cannot reload tells the user', async () => {
  reset()
  const file = await exportFile(bookB.id, 'rl-other.readmate-notes.json')
  db.prepare('DELETE FROM notes WHERE book_id = ?').run(bookB.id)
  let reloadsA = 0
  const offA = registerAnnotationReloader(bookA.id, async () => {
    reloadsA += 1
    return true
  })
  pickedFile = file
  await store.getState().startImport(bookB.id)
  await store.getState().confirmImport(onToast)
  assert.equal(reloadsA, 0)
  offA()
  // the open book's reloader says it could not reload
  const fileA = await exportFile(bookA.id, 'rl-fail.readmate-notes.json')
  wipe(bookA.id)
  const offB = registerAnnotationReloader(bookA.id, async () => false)
  pickedFile = fileA
  await store.getState().startImport(bookA.id)
  toasts.length = 0
  await store.getState().confirmImport(onToast)
  assert.match(toasts[0], /show after you reopen the book/)
  offB()
})

const { createAnnotationReloader } = await import('../../src/screens/Reader/logic/annotationReload.ts')
const { useHighlightsStore } = await import('../../src/screens/Reader/logic/highlights/highlightsStore.ts')
const { usePdfHighlightsStore } = await import('../../src/screens/Reader/logic/pdfHighlights/pdfHighlightsStore.ts')
const { useMdHighlightsStore } = await import('../../src/screens/Reader/logic/mdHighlights/mdHighlightsStore.ts')
const { useTxtDocumentStore } = await import('../../src/screens/Reader/logic/txtDocument/txtDocumentStore.ts')

await check('each format reloads through its own store (EPUB, PDF, Markdown: loadHighlights; TXT: flush, then load)', async () => {
  const log = []
  const original = {
    epub: useHighlightsStore.getState().loadHighlights,
    pdf: usePdfHighlightsStore.getState().loadHighlights,
    md: useMdHighlightsStore.getState().loadHighlights,
    flush: useTxtDocumentStore.getState().flush,
    load: useTxtDocumentStore.getState().load,
  }
  try {
    useHighlightsStore.setState({ loadHighlights: async () => void log.push('epub') })
    usePdfHighlightsStore.setState({ loadHighlights: async () => void log.push('pdf') })
    useMdHighlightsStore.setState({ loadHighlights: async () => void log.push('md') })
    useTxtDocumentStore.setState({ flush: async () => (log.push('txt-flush'), true), load: async (id) => void log.push(`txt-load:${id}`) })
    for (const f of ['epub', 'pdf', 'md', 'txt']) assert.equal(await createAnnotationReloader('book-x', f)(), true)
    assert.deepEqual(log, ['epub', 'pdf', 'md', 'txt-flush', 'txt-load:book-x'], 'TXT saves before it loads')
    // TXT with an unsaved edit that cannot be saved: nothing is reloaded, the caller is told
    log.length = 0
    useTxtDocumentStore.setState({ flush: async () => (log.push('txt-flush'), false) })
    assert.equal(await createAnnotationReloader('book-x', 'txt')(), false)
    assert.deepEqual(log, ['txt-flush'], 'no load after a failed save: the edit is not overwritten')
    assert.equal(await createAnnotationReloader('book-x', 'mp3')(), true)
  } finally {
    useHighlightsStore.setState({ loadHighlights: original.epub })
    usePdfHighlightsStore.setState({ loadHighlights: original.pdf })
    useMdHighlightsStore.setState({ loadHighlights: original.md })
    useTxtDocumentStore.setState({ flush: original.flush, load: original.load })
  }
})

console.log('6. housekeeping')
await check('closing the dialog drops the Main session; the files of the books are untouched', async () => {
  reset()
  const file = await exportFile(bookA.id, 'close.readmate-notes.json')
  pickedFile = file
  await store.getState().startImport(bookA.id)
  const id = store.getState().preview.sessionId
  store.getState().closeImport()
  await new Promise((r) => setTimeout(r, 0))
  assert.ok(calls.discard.includes(id))
  assert.equal((await service.confirm(id)).errorCode, 'not_found', 'the session is gone in Main')
  for (const b of [bookA, bookB, bookT]) assert.ok(fs.existsSync(b.file))
})

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`annotations store spike: ${passed} checks passed`)
