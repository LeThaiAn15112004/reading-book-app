/**
 * PDF file attachment (specs/007-pdf-file-attachment), renderer side: the REAL zustand stores
 * (`pageAttachmentsStore` + `pdfHighlightsStore` with its undo history) against the REAL Main operations
 * (`createPdfAttachment` / `changePdfAttachment`: write check, staging, streamed write, pdf.js read-back, SQLite
 * on the migrated schema) on real temp PDFs, and the REAL overlay IPC handlers for the annotation list. Only the
 * IPC hop is a direct call, the file picker is a stub, and the live sync's file-operation slot is a minimal one
 * (it carries the "signed PDF confirmed" flag). No window, no Electron.
 *
 *   1. create     the row appears in the list at once (no reload), selected, toast with name + size; SQLite and
 *                 the PDF hold it; one attach at a time
 *   2. cancel     a cancelled picker changes nothing and says nothing
 *   3. refusals   an over-limit file → the size message, nothing added; a read-only PDF → refused, the tool knows
 *                 it (`writeBlocked`) and the next click never reaches Main
 *   4. signed     a signed PDF asks first (picker not opened); decline writes nothing; confirm → Main is told once
 *                 and the attach is repeated (picker opens only then)
 *   5. move       one history entry; undo / redo move it in the PDF and SQLite; a refused undo keeps the entry
 *   6. delete     confirmation → gone from the list, SQLite and the PDF; not in the history
 *   7. book       switching books clears other readers' attachments, the selection and pending dialogs; a late
 *                 sync event of the old book is ignored
 *
 * Run: npm run spike:pdf:attachment-store   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { invoke } from '../pdf-annotations/electron-stub.mjs'
import { getDatabase } from '../pdf-annotations/db-stub.mjs'
import { buildPdf } from './pdf-fixtures.mjs'

const { OverlayChannels } = await import('../../electron/ipc/channels.ts')
const { registerOverlayIpc, toHighlightDto } = await import('../../electron/ipc/overlay.ipc.ts')
const { getOverlayStore } = await import('../../electron/persistence/sqlite-overlay-store.ts')
const { scanPdfAnnotationBytes, verifyPdfAttachmentBytes } = await import('../../electron/pdf-sync/pdf-annotation-scan.ts')
const { planAttachmentAppend, appendAttachmentChange } = await import('../../electron/pdf-sync/pdf-incremental-writer.ts')
const { checkPdfWritable } = await import('../../electron/pdf-sync/pdf-write-eligibility.ts')
const { createPdfAttachment, changePdfAttachment } = await import('../../electron/pdf-sync/pdf-attachment-operations.ts')
const { ATTACHMENT_MAX_BYTES } = await import('@reading-book/book-reader-sdk')

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}
const sha = (b) => createHash('sha256').update(b).digest('hex')
/** Wait until `cond()` holds (the stores' async work has settled). */
async function until(cond, what) {
  for (let i = 0; i < 400; i++) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-attach-store-'))
const db = getDatabase()
db.exec('PRAGMA foreign_keys = ON')
const insertBook = db.prepare(
  `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at)
   VALUES (?, ?, ?, 'pdf', ?, 'reading', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
)
const paths = {}
function addBook(id) {
  const file = path.join(tmp, `${id}.pdf`)
  fs.writeFileSync(file, buildPdf({ pages: 2 }))
  insertBook.run(id, id, file, `sha-${id}`)
  paths[id] = file
  return file
}
registerOverlayIpc()
const store = getOverlayStore()

// ---- Main side, wired as attachments.ipc.ts does (picker, slot and signature are the stubs) --------------------
const main = { picked: null, pickerCalls: 0, createCalls: 0, changeCalls: 0, confirmCalls: 0, allowSigned: false, signed: new Set(), readOnly: new Set() }
const checkWritable = (filePath, bytes, allowSigned) => {
  const bookId = Object.keys(paths).find((id) => paths[id] === filePath)
  if (main.readOnly.has(bookId)) return Promise.resolve({ ok: false, reason: 'read_only' })
  return checkPdfWritable({
    filePath,
    bytes,
    isReferenced: () => true,
    verifySignature: () => (main.signed.has(bookId) ? { status: 'valid', signerName: 'Dr. Signer' } : { status: 'unsigned' }),
    allowSigned,
  })
}
const deps = {
  resolvePdfPath: async (id) => paths[id] ?? null,
  runFileOperation: async (_bookId, op) => (await op({ allowSigned: main.allowSigned })).result,
  checkWritable,
  chooseFile: async () => {
    main.pickerCalls++
    return main.picked
  },
  scan: scanPdfAnnotationBytes,
  plan: async (bytes, page, annotation, file) => planAttachmentAppend(bytes, page, annotation, file),
  verify: verifyPdfAttachmentBytes,
  saveRow: (input) => store.writeHighlight(input),
  stagingRoot: path.join(tmp, 'staging'),
}
const changeDeps = {
  ...deps,
  change: async (bytes, page, change) => appendAttachmentChange(bytes, page, change),
  getRow: (bookId, rowId) => store.getAttachmentRow(bookId, rowId),
  isOtherRow: (bookId, rowId) => store.getAttachmentRow(bookId, rowId) === undefined && store.hasAnnotationRow(bookId, rowId),
  commit: (bookId, rowId, change) => store.commitAttachmentChange(bookId, rowId, change),
}
const asDto = (result) => (result.ok ? (result.highlight ? { ok: true, highlight: toHighlightDto(result.highlight) } : { ok: true }) : result)

const localStore = new Map()
globalThis.localStorage = { getItem: (k) => localStore.get(k) ?? null, setItem: (k, v) => localStore.set(k, String(v)), removeItem: (k) => localStore.delete(k) }
globalThis.crypto ??= (await import('node:crypto')).webcrypto
globalThis.window = {
  api: {
    overlay: {
      listHighlights: (id) => invoke(OverlayChannels.listHighlights, id),
      saveHighlight: (input) => invoke(OverlayChannels.saveHighlight, input),
      deleteHighlight: (input) => invoke(OverlayChannels.deleteHighlight, input),
      confirmSignedPdfWrite: async () => {
        main.confirmCalls++
        main.allowSigned = true
        return { ok: true }
      },
      onPdfEmbeddedAnnotationsChanged: () => () => {},
    },
    attachments: {
      create: async (input) => {
        main.createCalls++
        return asDto(await createPdfAttachment(deps, input))
      },
      change: async (input) => {
        main.changeCalls++
        return asDto(await changePdfAttachment(changeDeps, input))
      },
      open: async () => ({ ok: false, errorCode: 'invalid_request', errorMessage: 'not used here' }),
      saveAs: async () => ({ ok: false, errorCode: 'invalid_request', errorMessage: 'not used here' }),
      list: async () => ({ ok: true, items: [], truncated: false }),
    },
  },
}

const { usePdfHighlightsStore } = await import('../../src/screens/Reader/logic/pdfHighlights/pdfHighlightsStore.ts')
const { usePageAttachmentsStore } = await import('../../src/screens/Reader/logic/attachments/pageAttachmentsStore.ts')

const H = () => usePdfHighlightsStore.getState()
const A = () => usePageAttachmentsStore.getState()
const toasts = []
const lastToast = () => toasts.at(-1)

async function openBook(bookId) {
  H().setContext({ bookId, onToast: (m) => toasts.push(m), pdfApiRef: { current: null }, onChromeHidden: () => {} })
  H().resetForNewBook()
  A().setBook(bookId)
  await H().loadHighlights()
}
function sourceFile(name, size) {
  const dir = path.join(tmp, 'src', randomBytes(4).toString('hex'))
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, name)
  fs.writeFileSync(file, randomBytes(size))
  return file
}
/** A file of `size` bytes without writing them. */
function sizedFile(name, size) {
  const dir = path.join(tmp, 'src', randomBytes(4).toString('hex'))
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, name)
  fs.closeSync(fs.openSync(file, 'w'))
  fs.truncateSync(file, size)
  return file
}
const rowsInDb = (bookId) => db.prepare(`SELECT id FROM notes WHERE book_id = ? AND json_extract(note_json, '$.type') = 'attachment'`).all(bookId).map((r) => r.id)
const inFile = async (bookId) => (await scanPdfAnnotationBytes(new Uint8Array(fs.readFileSync(paths[bookId])))).items.filter((i) => i.subtype === 'FileAttachment')
const listedAttachments = () => H().highlights.filter((h) => h.styleKind === 'attachment')
const pinOf = (row) => ({ id: row.id, pageIndex: row.page - 1, box: { ...row.rects[0] }, name: row.attachment.name, sizeBytes: row.attachment.sizeBytes, editable: true })

console.log('PDF file attachment — renderer stores + Main operations + SQLite + real PDFs')
addBook('pdf-a')
addBook('pdf-b')
await openBook('pdf-a')
const ids = {}

console.log('1. create')
await check('an attach adds the row to the list at once (no reload), selects it, says name + size; SQLite and the PDF hold it', async () => {
  main.picked = sourceFile('notes.txt', 1536)
  const before = main.pickerCalls
  const running = A().create('pdf-a', 0, { x: 0.3, y: 0.4 })
  assert.equal(A().creating, true, 'shown as attaching while it runs')
  await A().create('pdf-a', 0, { x: 0.5, y: 0.5 }) // a second click meanwhile starts nothing
  await running
  assert.equal(A().creating, false)
  assert.equal(main.pickerCalls, before + 1, 'one attach at a time')
  const listed = listedAttachments()
  assert.equal(listed.length, 1)
  ids.first = listed[0].id
  assert.equal(listed[0].attachment.name, 'notes.txt')
  assert.equal(A().selectedId, ids.first)
  assert.equal(lastToast(), 'Attached notes.txt (1.5 KB).')
  assert.deepEqual(rowsInDb('pdf-a'), [ids.first])
  assert.deepEqual((await inFile('pdf-a')).map((i) => i.nm), [`readmate:${ids.first}`])
  // Reopening shows the same row, once.
  await openBook('pdf-a')
  assert.deepEqual(listedAttachments().map((h) => h.id), [ids.first])
})

console.log('2. cancel')
await check('a cancelled picker changes nothing and says nothing', async () => {
  const before = { file: sha(fs.readFileSync(paths['pdf-a'])), toasts: toasts.length }
  main.picked = null
  await A().create('pdf-a', 0, { x: 0.6, y: 0.6 })
  assert.equal(listedAttachments().length, 1)
  assert.equal(toasts.length, before.toasts, 'no message for a cancel')
  assert.equal(sha(fs.readFileSync(paths['pdf-a'])), before.file)
})

console.log('3. refusals')
await check('an over-limit file: the message gives its size and the limit; nothing added', async () => {
  const before = sha(fs.readFileSync(paths['pdf-a']))
  main.picked = sizedFile('big.iso', ATTACHMENT_MAX_BYTES + 1)
  await A().create('pdf-a', 1, { x: 0.2, y: 0.2 })
  assert.equal(lastToast(), '“big.iso” is 100.0 MB — the limit is 100 MB. Nothing was attached.')
  assert.equal(listedAttachments().length, 1)
  assert.equal(sha(fs.readFileSync(paths['pdf-a'])), before)
})
await check('a read-only PDF: refused before the picker; the tool then knows and the next click never reaches Main', async () => {
  main.readOnly.add('pdf-a')
  const before = { picker: main.pickerCalls, create: main.createCalls }
  await A().create('pdf-a', 0, { x: 0.2, y: 0.7 })
  assert.equal(main.pickerCalls, before.picker, 'no picker')
  assert.match(lastToast(), /read-only/)
  assert.match(A().writeBlocked ?? '', /read-only/)
  await A().create('pdf-a', 0, { x: 0.2, y: 0.7 })
  assert.equal(main.createCalls, before.create + 1, 'the second click was answered by the renderer')
  main.readOnly.delete('pdf-a')
  // The sync reporting a successful write clears it.
  A().applySync({ bookId: 'pdf-a', inserted: [], updated: [], deletedIds: [], hiddenObjectIds: [], complete: true, conflicts: [], writeStatus: 'written' })
  assert.equal(A().writeBlocked, null)
})

console.log('4. signed')
await check('a signed PDF asks first; decline writes nothing; confirm tells Main once and repeats the attach', async () => {
  main.signed.add('pdf-a')
  const before = { picker: main.pickerCalls, file: sha(fs.readFileSync(paths['pdf-a'])) }
  main.picked = sourceFile('signed-ok.txt', 100)
  await A().create('pdf-a', 1, { x: 0.4, y: 0.4 })
  assert.equal(A().signed?.signerName, 'Dr. Signer', 'the confirmation is shown')
  assert.equal(main.pickerCalls, before.picker, 'no picker before the user agrees')
  A().declineSigned()
  assert.equal(A().signed, null)
  assert.equal(sha(fs.readFileSync(paths['pdf-a'])), before.file)
  assert.equal(listedAttachments().length, 1)

  await A().create('pdf-a', 1, { x: 0.4, y: 0.4 })
  assert.ok(A().signed)
  await A().confirmSigned()
  await until(() => !A().creating && listedAttachments().length === 2, 'the repeated attach')
  assert.equal(main.confirmCalls, 1)
  assert.equal(main.pickerCalls, before.picker + 1, 'the picker opened only after the confirmation')
  ids.signed = listedAttachments().find((h) => h.attachment.name === 'signed-ok.txt').id
  main.signed.delete('pdf-a')
  main.allowSigned = false
})

console.log('5. move')
await check('a move is ONE history entry; undo / redo move it in the PDF and SQLite', async () => {
  const row = listedAttachments().find((h) => h.id === ids.first)
  const from = { ...row.rects[0] }
  const to = { x: 0.6, y: 0.7, width: from.width, height: from.height }
  await A().move(ids.first, to)
  assert.equal(A().moving, null)
  const stored = () => store.getAttachmentRow('pdf-a', ids.first).pdfAnnotation.rects[0]
  const listedBox = () => listedAttachments().find((h) => h.id === ids.first).rects[0]
  assert.equal(listedBox().x, 0.6)
  assert.equal(stored().x, 0.6)
  assert.equal(H().history.canUndo(), true)

  H().undo()
  await until(() => !A().changing && Math.abs(listedBox().x - from.x) < 1e-9, 'undo')
  assert.ok(Math.abs(stored().x - from.x) < 1e-9, 'undo reached SQLite')
  const nm = `readmate:${ids.first}`
  const fileBox = async () => (await inFile('pdf-a')).find((i) => i.nm === nm).rects[0]
  assert.ok(Math.abs((await fileBox()).x - from.x) < 0.002, 'undo reached the PDF')

  H().redo()
  await until(() => !A().changing && listedBox().x === 0.6, 'redo')
  assert.ok(Math.abs((await fileBox()).x - 0.6) < 0.002, 'redo reached the PDF')
  assert.equal(H().history.canRedo(), false)
})
await check('a refused undo (PDF became read-only) says why and keeps the entry; it works once writable again', async () => {
  const listedBox = () => listedAttachments().find((h) => h.id === ids.first).rects[0]
  main.readOnly.add('pdf-a')
  H().undo()
  await until(() => !A().changing, 'the refused undo')
  assert.match(lastToast(), /can’t move this attachment: the PDF file or its folder is read-only/)
  assert.equal(listedBox().x, 0.6, 'not moved')
  assert.equal(H().history.canUndo(), true, 'the entry is still there to undo')
  assert.equal(H().history.canRedo(), false)
  main.readOnly.delete('pdf-a')
  H().undo()
  await until(() => !A().changing && listedBox().x !== 0.6, 'the retried undo')
  assert.equal(H().history.canRedo(), true)
})

console.log('6. delete')
await check('delete asks first, then removes the row from the list, SQLite and the PDF; it is not in the history', async () => {
  const row = listedAttachments().find((h) => h.id === ids.signed)
  const undoBefore = H().history.canUndo()
  A().requestDelete(pinOf(row))
  assert.equal(A().deleting?.id, ids.signed, 'the confirmation is shown')
  A().cancelDelete()
  assert.ok(listedAttachments().some((h) => h.id === ids.signed), 'Cancel does nothing')
  A().requestDelete(pinOf(row))
  await A().confirmDelete()
  assert.ok(!listedAttachments().some((h) => h.id === ids.signed))
  assert.ok(!rowsInDb('pdf-a').includes(ids.signed))
  assert.ok(!(await inFile('pdf-a')).some((i) => i.nm === `readmate:${ids.signed}`))
  assert.equal(lastToast(), 'Removed “signed-ok.txt” from the PDF.')
  assert.equal(H().history.canUndo(), undoBefore, 'no history entry for a delete')
  // Another reader's attachment can never be deleted from the renderer.
  A().requestDelete({ ...pinOf(listedAttachments()[0]), id: 'page-1-0-0123456789ab', editable: false })
  assert.equal(A().deleting, null)
})

console.log('7. book switch')
await check('switching books clears other readers’ attachments, the selection and dialogs; a late event of the old book is ignored', async () => {
  const foreign = { attachmentId: 'page-1-0-0123456789ab', pageIndex: 0, rect: { x: 0.1, y: 0.1, width: 0.03, height: 0.03 }, name: 'theirs.txt', sizeBytes: 9, objectId: '99R' }
  const event = (bookId) => ({ bookId, inserted: [], updated: [], deletedIds: [], hiddenObjectIds: [], complete: true, conflicts: [], pageAttachments: [foreign] })
  A().applySync(event('pdf-a'))
  assert.deepEqual(A().foreign.map((f) => f.name), ['theirs.txt'])
  A().select(foreign.attachmentId)
  A().requestDelete(pinOf(listedAttachments()[0]))
  await openBook('pdf-b')
  assert.deepEqual(A().foreign, [])
  assert.equal(A().selectedId, null)
  assert.equal(A().deleting, null)
  assert.equal(A().writeBlocked, null)
  A().applySync(event('pdf-a'))
  assert.deepEqual(A().foreign, [], 'the old book’s event is ignored')
  assert.equal(listedAttachments().length, 0)
})

// Retried: on Windows a virus scanner may hold a just-written temp file for a moment.
fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
console.log(`\n${passed} attachment store checks passed`)
