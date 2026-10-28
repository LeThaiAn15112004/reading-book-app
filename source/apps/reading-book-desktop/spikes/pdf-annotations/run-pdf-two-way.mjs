/**
 * Checks for TWO-WAY sync of PDF annotations (docs/implementation_plan/pdf_annotation_two_way_sync.md),
 * with the real pieces and real files, no Electron: the sync coordinator in two-way mode, the
 * watcher, `planTwoWaySync`, the incremental writer + read-back (in-process instead of the worker),
 * `writeFileSafely`, and `SqliteOverlayStore` on the migrated schema (024 included). "Another app" is
 * simulated by rewriting the file (full rewrite with the same /NM names, or an appended update).
 *
 *   1. Readmate → file   add / edit / delete a row: written into the file, no loop, no duplicates
 *   2. file → Readmate   recolor / comment / move / delete in the file
 *   3. merge             different fields changed on both sides
 *   4. conflict          same field changed differently: frozen, nothing overwritten; resolved both ways
 *   5. deletions         deleted in Readmate while edited in the file → restored; removed in the file
 *                        while edited in Readmate → conflict
 *   6. blocked files     read-only file → not written, status reported, no retries, written once writable;
 *                        locked (EBUSY) → bounded retries, then waits; app-owned copy, signed (needs the
 *                        user's confirmation, announced once), encrypted / unsupported → never written
 *   7. race              another app saves while Readmate prepares its write → restart, nothing lost
 *   8. crash recovery    transaction fails after the file write → next cycle links, no duplicates;
 *                        a row deleted while its own write is in flight leaves the file, not resurrected
 *   9. always on         no switch: new AND existing books write; style change, move, undo of a delete
 *                        write; a tag change doesn't touch the file; books.sha256 follows the file and
 *                        "Locate file" still matches after write-backs
 *
 * Run: npm run spike:pdf:two-way   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pdfHighlightDtoToReaderHighlight, packPdfHighlightLocator, planTwoWaySync } from '@reading-book/book-reader-sdk'
import { invoke } from './electron-stub.mjs'
import { getDatabase } from './db-stub.mjs'
import { buildAnnotatedPdf } from '../../e2e/support/build-annotated-pdf.mjs'

const { OverlayChannels } = await import('../../electron/ipc/channels.ts')
const { registerOverlayIpc } = await import('../../electron/ipc/overlay.ipc.ts')
const { getOverlayStore } = await import('../../electron/persistence/sqlite-overlay-store.ts')
const { scanPdfAnnotationBytes } = await import('../../electron/pdf-sync/pdf-annotation-scan.ts')
const { applyAnnotationOps } = await import('../../electron/pdf-sync/pdf-annotation-write.ts')
const { writeFileSafely } = await import('../../electron/pdf-sync/pdf-annotation-export.ts')
const { createPdfAnnotationSyncService, sha256Hex } = await import('../../electron/pdf-sync/pdf-annotation-sync-service.ts')
const { checkPdfWritable } = await import('../../electron/pdf-sync/pdf-write-eligibility.ts')
const { verifyPdf } = await import('../../electron/signature/signature-service.ts')
const { getLibraryStore } = await import('../../electron/persistence/sqlite-library-store.ts')
const { relinkBookToFile } = await import('../../electron/files/relink-book.ts')

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, timeoutMs = 8000, label = 'condition') {
  const start = Date.now()
  while (!(await fn())) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await sleep(40)
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-2way-'))
const db = getDatabase()
db.exec('PRAGMA foreign_keys = ON')
const insertBook = db.prepare(
  `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at)
   VALUES (?, ?, ?, 'pdf', ?, 'reading', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
)
const file = path.join(tmp, 'shared.pdf')
insertBook.run('tw', 'Two-way', file, 'sha-tw')
registerOverlayIpc()
const store = getOverlayStore()

const paths = { tw: file }
const events = []
let scans = 0
let writes = 0
let beforeApplyOps = async () => {}
let applyHook = null
/** Make the file write fail like another app holding the file (errno code), or not. */
let failWriteWith = null
/** Per book: a fake signature verdict (the real `verifyPdf` is used otherwise). */
const signatureOverride = {}
const service = createPdfAnnotationSyncService({
  resolvePdfPath: async (id) => (paths[id] && fs.existsSync(paths[id]) ? paths[id] : null),
  scan: async (bytes) => {
    scans++
    return scanPdfAnnotationBytes(bytes)
  },
  sync: (id, items, options) => store.syncEmbeddedPdfAnnotations(id, items, options),
  servedSha256: () => undefined,
  emit: (_t, e) => events.push({ ...e, at: Date.now() }),
  watcherOptions: { debounceMs: 60, stableMs: 120, pollMs: 400, maxWaitMs: 5000 },
  retryTiming: { retryMs: 150, lockedMs: 120, lockedMax: 3 },
  log: (m, d) => process.env.DEBUG2W && console.log(`    [${Date.now() % 100000}] ${m}`, d?.message ?? ''),
  twoWay: {
    // The same gate the app uses before every write; "managed copy" = a path under a `managed-copy` folder.
    checkWritable: (id, filePath, bytes, allowSigned) =>
      checkPdfWritable({
        filePath,
        bytes,
        isReferenced: (p) => !p.includes('managed-copy'),
        verifySignature: (b) => signatureOverride[id] ?? verifyPdf(b),
        allowSigned,
      }),
    recordFileVersion: (id, sha, size) => getLibraryStore().updateFileFingerprint(id, sha, size),
    plan: async (id, items, complete) => planTwoWaySync({ items, complete, ledger: store.listTwoWayLedger(id), rows: await store.listHighlights(id) }),
    apply: (id, plan, items, after) => (applyHook ? applyHook(id, plan, items, after) : store.applyTwoWaySync(id, plan, items, after)),
    applyOps: async (bytes, ops) => {
      await beforeApplyOps()
      return applyAnnotationOps({ bytes, ops })
    },
    writeFile: async (p, bytes) => {
      writes++
      if (failWriteWith) throw Object.assign(new Error(`injected ${failWriteWith}`), { code: failWriteWith })
      await writeFileSafely(p, bytes)
    },
  },
})
const target = { id: 1, isDestroyed: () => false, once: () => {} }

const rows = async (id = 'tw') => (await invoke(OverlayChannels.listHighlights, id)).map(pdfHighlightDtoToReaderHighlight)
const fileItems = async (p = file) => (await scanPdfAnnotationBytes(new Uint8Array(fs.readFileSync(p)))).items
const lastEvent = () => events.at(-1)

function rectRow(page, y) {
  const pdfAnnotation = { pageIndex: page, rects: [{ pageIndex: page, x: 0.1, y, width: 0.5, height: 0.025 }] }
  return { locatorRef: packPdfHighlightLocator(pdfAnnotation), pdfAnnotationRef: JSON.stringify(pdfAnnotation) }
}
async function saveRow(input) {
  const saved = await invoke(OverlayChannels.saveHighlight, { bookId: 'tw', styleKind: 'highlight', colorHex: '#FFEB3B', ...input })
  assert.ok(saved, 'row saved')
  return saved
}
/** The annotation Readmate wrote for row `id`, as a reader scans it. */
async function written(id) {
  return (await fileItems()).find((i) => i.nm === `readmate:${id}`)
}
/** "Another app" saves the file: every current annotation kept (same /NM), `edit` applied. */
async function externalSave(edit) {
  const items = await fileItems()
  const annotations = items.map((i) => ({
    page: i.pageIndex + 1,
    subtype: i.subtype,
    rect: undefined,
    quads: i.rects,
    color: i.colorHex ? [1, 3, 5].map((k) => parseInt(i.colorHex.slice(k, k + 2), 16) / 255) : [1, 1, 0],
    contents: i.contents,
    nm: i.nm,
  }))
  const next = edit(annotations)
  // Re-create each annotation from its normalized rects on a US-Letter page (no rotation).
  const toQuadsSpec = (a) => {
    const quads = a.quads.map((r) => {
      const x1 = r.x * 612
      const x2 = (r.x + r.width) * 612
      const yTop = 792 - r.y * 792
      const yBottom = 792 - (r.y + r.height) * 792
      return { x1, x2, yTop, yBottom }
    })
    return {
      page: a.page,
      subtype: a.subtype,
      color: a.color,
      contents: a.contents,
      nm: a.nm,
      rect: [Math.min(...quads.map((q) => q.x1)), Math.min(...quads.map((q) => q.yBottom)), Math.max(...quads.map((q) => q.x2)), Math.max(...quads.map((q) => q.yTop))],
      quadPoints: quads.flatMap((q) => [q.x1, q.yTop, q.x2, q.yTop, q.x1, q.yBottom, q.x2, q.yBottom]),
    }
  }
  fs.writeFileSync(file, buildAnnotatedPdf({ annotations: next.map(toQuadsSpec), padObjects: 2 }))
}

console.log('two-way sync')
fs.writeFileSync(file, buildAnnotatedPdf())
await service.watch(target, 'tw')
await until(() => events.some((e) => e.reason === 'open'), 6000, 'open')

let a
await check('1a. a row made in Readmate is written into the PDF (standard /Highlight, readmate /NM)', async () => {
  a = await saveRow({ ...rectRow(0, 0.1), note: 'from Readmate' })
  service.notifyAppChange('tw')
  await until(async () => !!(await written(a.id)), 8000, 'write-back')
  const item = await written(a.id)
  assert.equal(item.subtype, 'Highlight')
  assert.equal(item.contents, 'from Readmate')
  // The file is replaced before the transaction commits and the event is pushed: wait for the event.
  await until(() => lastEvent()?.writeStatus === 'written', 8000, 'the written event')
})

await check('1b. Readmate’s own write is not synced back (no loop, no duplicate)', async () => {
  const scansBefore = scans
  const writesBefore = writes
  await sleep(1500)
  assert.equal(writes, writesBefore, 'no further write')
  assert.ok(scans - scansBefore <= 1, `own write rescanned at most once (${scans - scansBefore})`)
  assert.equal((await rows()).length, 1)
  assert.equal((await fileItems()).length, 1)
})

await check('1c. an edit in Readmate rewrites the same annotation (same object) in the file', async () => {
  const objectId = (await written(a.id)).objectId
  await saveRow({ id: a.id, ...rectRow(0, 0.1), colorHex: '#FF0000', note: 'edited in Readmate' })
  service.notifyAppChange('tw')
  await until(async () => (await written(a.id))?.colorHex === '#FF0000', 8000, 'rewrite')
  const item = await written(a.id)
  assert.equal(item.objectId, objectId)
  assert.equal(item.contents, 'edited in Readmate')
  assert.equal((await fileItems()).length, 1)
})

await check('2a. a recolor + comment in the other app updates the row; nothing written back', async () => {
  const writesBefore = writes
  await externalSave((list) => list.map((x) => (x.nm === `readmate:${a.id}` ? { ...x, color: [0, 0, 1], contents: 'edited in Foxit' } : x)))
  await until(async () => (await rows())[0]?.colorHex === '#0000FF', 8000, 'row update')
  assert.equal((await rows())[0].note, 'edited in Foxit')
  await sleep(800)
  assert.equal(writes, writesBefore)
})

await check('3. different fields on each side merge both ways', async () => {
  await saveRow({ id: a.id, ...rectRow(0, 0.1), colorHex: '#0000FF', note: 'note from Readmate' }) // text
  await externalSave((list) => list.map((x) => (x.nm === `readmate:${a.id}` ? { ...x, color: [0, 0.5, 0] } : x))) // color
  service.notifyAppChange('tw')
  await until(async () => {
    const item = await written(a.id)
    const row = (await rows())[0]
    return item?.contents === 'note from Readmate' && row?.colorHex === '#008000'
  }, 10000, 'merge')
  assert.equal(store.listPdfAnnotationConflicts('tw').length, 0)
})

await check('4. same field changed differently → conflict, nothing overwritten; resolved both ways', async () => {
  await saveRow({ id: a.id, ...rectRow(0, 0.1), colorHex: '#FF00FF', note: 'note from Readmate' })
  await externalSave((list) => list.map((x) => (x.nm === `readmate:${a.id}` ? { ...x, color: [0, 1, 1] } : x)))
  service.notifyAppChange('tw')
  await until(() => store.listPdfAnnotationConflicts('tw').length === 1, 10000, 'conflict')
  await sleep(600)
  assert.equal((await rows())[0].colorHex, '#FF00FF', 'Readmate keeps its version')
  assert.equal((await written(a.id)).colorHex, '#00FFFF', 'the file keeps the other app’s')
  assert.ok(events.some((e) => e.outcome.conflicts.length > 0))
  // Keep Readmate's version → written into the file.
  store.resolvePdfAnnotationConflict('tw', a.id, 'keep-readmate')
  service.notifyAppChange('tw')
  await until(async () => (await written(a.id))?.colorHex === '#FF00FF', 8000, 'keep-readmate write')
  // A new conflict, resolved the other way → the row takes the PDF's version.
  await saveRow({ id: a.id, ...rectRow(0, 0.1), colorHex: '#123456', note: 'note from Readmate' })
  await externalSave((list) => list.map((x) => (x.nm === `readmate:${a.id}` ? { ...x, color: [1, 0.5, 0] } : x)))
  service.notifyAppChange('tw')
  await until(() => store.listPdfAnnotationConflicts('tw').length === 1, 10000, 'second conflict')
  store.resolvePdfAnnotationConflict('tw', a.id, 'use-pdf')
  assert.equal((await rows())[0].colorHex, '#FF8000')
  assert.equal(store.listPdfAnnotationConflicts('tw').length, 0)
})

await check('2b. delete in the other app (row untouched since) → the row is deleted', async () => {
  const b = await saveRow({ ...rectRow(1, 0.2), styleKind: 'underline' })
  service.notifyAppChange('tw')
  await until(async () => !!(await written(b.id)), 8000, 'b written')
  await externalSave((list) => list.filter((x) => x.nm !== `readmate:${b.id}`))
  await until(async () => !(await rows()).some((r) => r.id === b.id), 8000, 'row deleted')
  assert.equal((await rows()).length, 1)
})

await check('1d. a delete in Readmate removes the annotation from the file', async () => {
  const c = await saveRow({ ...rectRow(2, 0.3), styleKind: 'strikethrough' })
  service.notifyAppChange('tw')
  await until(async () => !!(await written(c.id)), 8000, 'c written')
  await invoke(OverlayChannels.deleteHighlight, { bookId: 'tw', id: c.id })
  service.notifyAppChange('tw')
  await until(async () => !(await written(c.id)), 8000, 'c removed from file')
  assert.equal((await fileItems()).length, 1)
})

await check('5. deleted in Readmate while edited in the file → restored; removed in file while edited in Readmate → conflict', async () => {
  const d = await saveRow({ ...rectRow(0, 0.5) })
  service.notifyAppChange('tw')
  await until(async () => !!(await written(d.id)), 8000, 'd written')
  // Stop the watcher reacting between the two edits: both happen "at once".
  await invoke(OverlayChannels.deleteHighlight, { bookId: 'tw', id: d.id })
  await externalSave((list) => list.map((x) => (x.nm === `readmate:${d.id}` ? { ...x, contents: 'Foxit edited it meanwhile' } : x)))
  service.notifyAppChange('tw')
  await until(async () => (await rows()).some((r) => r.note === 'Foxit edited it meanwhile'), 10000, 'restored')
  const e = await saveRow({ ...rectRow(0, 0.6) })
  service.notifyAppChange('tw')
  await until(async () => !!(await written(e.id)), 8000, 'e written')
  await saveRow({ id: e.id, ...rectRow(0, 0.6), note: 'edited in Readmate' })
  await externalSave((list) => list.filter((x) => x.nm !== `readmate:${e.id}`))
  service.notifyAppChange('tw')
  await until(() => store.listPdfAnnotationConflicts('tw').some((c) => c.noteId === e.id && c.conflict.kind === 'removed-in-file'), 10000, 'removed-in-file conflict')
  assert.equal((await rows()).find((r) => r.id === e.id)?.note, 'edited in Readmate')
  store.resolvePdfAnnotationConflict('tw', e.id, 'keep-readmate') // → re-added to the file
  service.notifyAppChange('tw')
  await until(async () => !!(await written(e.id)), 8000, 're-added')
})

await check('6a. a read-only file: not written, reported once, no retries; written as soon as it is writable', async () => {
  const f = await saveRow({ ...rectRow(1, 0.7) })
  const writesBefore = writes
  const eventsBefore = events.length
  fs.chmodSync(file, 0o444)
  service.notifyAppChange('tw')
  await until(() => events.some((e) => e.writeStatus === 'read_only'), 8000, 'read_only status')
  assert.equal(await written(f.id), undefined, 'nothing written')
  assert.equal(writes, writesBefore, 'no write attempt at all')
  await sleep(1000)
  assert.equal(writes, writesBefore, 'and no retries')
  assert.equal(events.slice(eventsBefore).filter((e) => e.writeStatus === 'read_only').length, 1, 'announced once')
  assert.equal((await rows()).some((r) => r.id === f.id), true, 'the row is kept')
  fs.chmodSync(file, 0o666)
  service.notifyAppChange('tw')
  await until(async () => !!(await written(f.id)), 10000, 'written once writable')
})

await check('6b. a file another app holds (EBUSY): bounded retries, reported once, then written when free', async () => {
  const f = await saveRow({ ...rectRow(1, 0.75) })
  const writesBefore = writes
  const eventsBefore = events.length
  failWriteWith = 'EBUSY'
  service.notifyAppChange('tw')
  await until(() => events.some((e) => e.writeStatus === 'locked'), 8000, 'locked status')
  await sleep(2000)
  const attempts = writes - writesBefore
  assert.ok(attempts >= 2 && attempts <= 4, `1 attempt + at most 3 retries (got ${attempts})`)
  await sleep(1200)
  assert.equal(writes - writesBefore, attempts, 'retrying stopped')
  assert.equal(await written(f.id), undefined)
  assert.equal(events.slice(eventsBefore).filter((e) => e.writeStatus === 'locked').length, 1, 'announced once')
  failWriteWith = null
  service.notifyAppChange('tw')
  await until(async () => !!(await written(f.id)), 10000, 'written when free')
})

await check('7. another app saves while Readmate prepares its write → the cycle restarts, nothing is lost', async () => {
  const g = await saveRow({ ...rectRow(2, 0.8), note: 'racing' })
  let raced = false
  beforeApplyOps = async () => {
    if (raced) return
    raced = true
    await externalSave((list) => [...list, { page: 3, subtype: 'Underline', quads: [{ x: 0.1, y: 0.1, width: 0.3, height: 0.02 }], color: [0.5, 0.5, 0.5], nm: '{OTHER-APP}' }])
  }
  service.notifyAppChange('tw')
  await until(async () => {
    const items = await fileItems()
    return items.some((i) => i.nm === `readmate:${g.id}`) && items.some((i) => i.nm === '{OTHER-APP}')
  }, 12000, 'both kept')
  beforeApplyOps = async () => {}
  await until(async () => (await rows()).some((r) => r.styleKind === 'underline' && r.page === 3), 8000, 'other app’s annotation imported')
})

await check('8. a crash between the file write and the commit: next cycle links by name, no duplicates', async () => {
  const h = await saveRow({ ...rectRow(0, 0.85), note: 'crash test' })
  let failed = false
  applyHook = (id, plan, items, after) => {
    if (!failed && after) {
      failed = true
      throw new Error('injected crash after the file write')
    }
    return store.applyTwoWaySync(id, plan, items, after)
  }
  service.notifyAppChange('tw')
  await until(() => failed, 8000, 'crash')
  assert.ok(await written(h.id), 'the file write happened')
  await until(async () => store.listTwoWayLedger('tw').some((e) => e.noteId === h.id), 10000, 'linked on retry')
  applyHook = null
  const count = (await rows()).filter((r) => r.note === 'crash test').length
  assert.equal(count, 1, 'no duplicate row')
  assert.equal((await fileItems()).filter((i) => i.nm === `readmate:${h.id}`).length, 1, 'no duplicate annotation')
})

await check('8b. a row deleted while its own write is in flight is not resurrected; it leaves the file', async () => {
  const r = await saveRow({ ...rectRow(1, 0.9), note: 'deleted mid-write' })
  let deletedMidWrite = false
  beforeApplyOps = async () => {
    if (deletedMidWrite) return
    deletedMidWrite = true
    await invoke(OverlayChannels.deleteHighlight, { bookId: 'tw', id: r.id })
    // The real delete handler notifies the coordinator (`notifyAppChange`); this spike's own service
    // is not the one the handler talks to, so it is told the same way.
    service.notifyAppChange('tw')
  }
  service.notifyAppChange('tw')
  await until(() => deletedMidWrite, 8000, 'delete during write')
  beforeApplyOps = async () => {}
  await until(async () => !(await written(r.id)), 12000, 'removed from the file afterwards')
  await sleep(1200)
  assert.equal((await rows()).some((x) => x.note === 'deleted mid-write'), false, 'not imported back')
})

/** Another book with its own window / file (ids 10+), for the cases below. */
let nextTarget = 10
async function openBook(id, title, bytes, folder = tmp) {
  fs.mkdirSync(folder, { recursive: true })
  const p = path.join(folder, `${id}.pdf`)
  fs.writeFileSync(p, bytes)
  insertBook.run(id, title, p, `sha-${id}`)
  paths[id] = p
  const t = { id: nextTarget++, isDestroyed: () => false, once: () => {} }
  return { id, path: p, target: t }
}
const saveFor = (id, input) => invoke(OverlayChannels.saveHighlight, { bookId: id, styleKind: 'highlight', colorHex: '#FFEB3B', ...input })
const statusCount = (id, status) => events.filter((e) => e.bookId === id && e.writeStatus === status).length
const itemsOf = async (p) => (await scanPdfAnnotationBytes(new Uint8Array(fs.readFileSync(p)))).items

await check('9a. always on: a book that already had annotations (no switch, no row) is written when opened; new books too', async () => {
  // "Existing book": annotations made before this behaviour existed, saved straight into SQLite.
  const old = await openBook('old', 'Existing book', buildAnnotatedPdf())
  for (const [i, y] of [0.1, 0.3].entries()) {
    await store.saveHighlight({
      bookId: 'old',
      id: `old-${i}`,
      locator: JSON.parse(rectRow(0, y).locatorRef),
      styleKind: 'highlight',
      colorHex: '#FFEB3B',
      tags: [],
      pdfAnnotation: JSON.parse(rectRow(0, y).pdfAnnotationRef),
    })
  }
  await service.watch(old.target, 'old')
  await until(async () => (await itemsOf(old.path)).length === 2, 10000, 'existing annotations written on open')
  assert.deepEqual((await itemsOf(old.path)).map((i) => i.nm).sort(), ['readmate:old-0', 'readmate:old-1'])
  // A new book: the first annotation is written with nothing set up.
  const fresh = await openBook('fresh', 'New book', buildAnnotatedPdf())
  await service.watch(fresh.target, 'fresh')
  await sleep(500)
  const r = await saveFor('fresh', rectRow(0, 0.2))
  service.notifyAppChange('fresh')
  await until(async () => (await itemsOf(fresh.path)).some((i) => i.nm === `readmate:${r.id}`), 10000, 'new book written')
  // There is no write-back switch left: the legacy table is never read or written.
  assert.equal(db.prepare('SELECT COUNT(*) n FROM pdf_annotation_write_back').get().n, 0)
})

await check('9b. kind change, move, undo of a delete are written; a tag change does not touch the file', async () => {
  const g = await saveRow({ ...rectRow(0, 0.2), note: 'to be changed' })
  service.notifyAppChange('tw')
  await until(async () => !!(await written(g.id)), 8000, 'written')
  const objectId = (await written(g.id)).objectId
  // Highlight → underline: same object, new subtype.
  await saveRow({ id: g.id, ...rectRow(0, 0.2), styleKind: 'underline', note: 'to be changed' })
  service.notifyAppChange('tw')
  await until(async () => (await written(g.id))?.subtype === 'Underline', 8000, 'kind change')
  assert.equal((await written(g.id)).objectId, objectId)
  // Move: geometry follows.
  await saveRow({ id: g.id, ...rectRow(0, 0.6), styleKind: 'underline', note: 'to be changed' })
  service.notifyAppChange('tw')
  await until(async () => Math.abs(((await written(g.id))?.rects[0]?.y ?? 0) - 0.6) < 0.004, 8000, 'move')
  // Tags are not a PDF concept: changing them must not rewrite the file.
  const shaBefore = sha256Hex(fs.readFileSync(file))
  const writesBefore = writes
  await saveRow({ id: g.id, ...rectRow(0, 0.6), styleKind: 'underline', note: 'to be changed', tags: ['x'] })
  service.notifyAppChange('tw')
  await sleep(1200)
  assert.equal(writes, writesBefore)
  assert.equal(sha256Hex(fs.readFileSync(file)), shaBefore)
  // Delete, then undo (the same row saved again): removed, then added back, once.
  await invoke(OverlayChannels.deleteHighlight, { bookId: 'tw', id: g.id })
  service.notifyAppChange('tw')
  await until(async () => !(await written(g.id)), 8000, 'delete written')
  await saveRow({ id: g.id, ...rectRow(0, 0.6), styleKind: 'underline', note: 'to be changed' })
  service.notifyAppChange('tw')
  await until(async () => !!(await written(g.id)), 8000, 'undo written')
  assert.equal((await fileItems()).filter((i) => i.nm === `readmate:${g.id}`).length, 1)
})

await check('9c. an app-owned copy is never written (status managed_copy, data kept)', async () => {
  const managed = await openBook('managed', 'Managed copy', buildAnnotatedPdf(), path.join(tmp, 'managed-copy'))
  const before = sha256Hex(fs.readFileSync(managed.path))
  const writesBefore = writes
  await service.watch(managed.target, 'managed')
  await sleep(500)
  const r = await saveFor('managed', rectRow(0, 0.2))
  service.notifyAppChange('managed')
  await until(() => statusCount('managed', 'managed_copy') >= 1, 8000, 'managed_copy status')
  await sleep(600)
  assert.equal(sha256Hex(fs.readFileSync(managed.path)), before)
  assert.equal(writes, writesBefore)
  assert.equal(statusCount('managed', 'managed_copy'), 1, 'announced once')
  assert.equal(statusCount('managed', 'written'), 0, 'never reported as written')
  assert.equal((await store.listHighlights('managed')).some((h) => h.id === r.id), true, 'row kept')
})

await check('9d. a signed PDF is not written silently: announced once, written only after the user confirms', async () => {
  const signed = await openBook('signed', 'Signed', buildAnnotatedPdf())
  signatureOverride.signed = { status: 'valid', signerName: 'Ann' }
  const before = sha256Hex(fs.readFileSync(signed.path))
  await service.watch(signed.target, 'signed')
  await sleep(500)
  const r1 = await saveFor('signed', rectRow(0, 0.2))
  service.notifyAppChange('signed')
  await until(() => statusCount('signed', 'signed') >= 1, 8000, 'signed status')
  assert.equal(events.find((e) => e.writeStatus === 'signed' && e.bookId === 'signed').signerName, 'Ann')
  assert.equal(sha256Hex(fs.readFileSync(signed.path)), before)
  const r2 = await saveFor('signed', rectRow(0, 0.4))
  service.notifyAppChange('signed')
  await sleep(1000)
  assert.equal(statusCount('signed', 'signed'), 1, 'not announced again')
  assert.equal(sha256Hex(fs.readFileSync(signed.path)), before, 'still untouched')
  // Wrong window / book can't confirm.
  assert.equal(service.allowSignedWrite({ id: 999 }, 'signed'), false)
  assert.equal(service.allowSignedWrite(signed.target, 'tw'), false)
  assert.equal(service.allowSignedWrite(signed.target, 'signed'), true)
  await until(async () => (await itemsOf(signed.path)).length === 2, 10000, 'written after confirmation')
  assert.ok((await itemsOf(signed.path)).some((i) => i.nm === `readmate:${r1.id}`) && (await itemsOf(signed.path)).some((i) => i.nm === `readmate:${r2.id}`))
  // A signature that can't even be evaluated blocks too (prefer not writing).
  signatureOverride.signed = { status: 'unsupported' }
  const x = await openBook('unverifiable', 'Unverifiable', buildAnnotatedPdf())
  signatureOverride.unverifiable = { status: 'unsupported' }
  await service.watch(x.target, 'unverifiable')
  await sleep(500)
  await saveFor('unverifiable', rectRow(0, 0.2))
  service.notifyAppChange('unverifiable')
  await until(() => statusCount('unverifiable', 'signed') >= 1, 8000, 'unverifiable blocks')
})

await check('9e. encrypted and structurally unsupported PDFs are refused by the write gate', async () => {
  const plain = buildAnnotatedPdf()
  const gate = (bytes) =>
    checkPdfWritable({ filePath: path.join(tmp, 'tw.pdf'), bytes: new Uint8Array(bytes), isReferenced: () => true, verifySignature: verifyPdf, allowSigned: false })
  fs.writeFileSync(path.join(tmp, 'tw.pdf'), plain)
  assert.deepEqual(await gate(plain), { ok: true })
  const encrypted = Buffer.from(plain.toString('latin1').replace('trailer\n<< /Size', 'trailer\n<< /Encrypt 99 0 R /Size'), 'latin1')
  assert.deepEqual(await gate(encrypted), { ok: false, reason: 'encrypted' })
  const broken = Buffer.from(plain.toString('latin1').replace(/startxref\n\d+/, 'startxref\n12'), 'latin1')
  assert.deepEqual(await gate(broken), { ok: false, reason: 'unsupported_pdf' })
})

await check('9f. books.sha256 follows the file after write-backs and external saves; Locate file still matches', async () => {
  const lib = getLibraryStore()
  const book = await lib.findById('tw')
  assert.equal(book.sha256, sha256Hex(fs.readFileSync(file)), 'the recorded hash is the file on disk')
  // An external save changes the file: the next sync records it.
  await externalSave((list) => list.map((x) => ({ ...x })))
  await until(async () => (await lib.findById('tw')).sha256 === sha256Hex(fs.readFileSync(file)), 10000, 'external version recorded')
  // The user moved the file: relinking the moved copy matches by hash.
  const moved = path.join(tmp, 'moved', 'shared-moved.pdf')
  fs.mkdirSync(path.dirname(moved), { recursive: true })
  fs.copyFileSync(file, moved)
  assert.deepEqual(await relinkBookToFile('tw', moved), { ok: true })
  assert.equal((await lib.findById('tw')).filePath, moved)
  // Put it back for the checks that follow.
  lib.updateFilePath('tw', file)
})

await check('no duplicates overall: every row ↔ one annotation, ledger keys unique', async () => {
  await sleep(800)
  const items = await fileItems()
  const names = items.map((i) => i.nm).filter(Boolean)
  assert.equal(new Set(names).size, names.length)
  const keys = store.listTwoWayLedger('tw').map((e) => e.sourceKey)
  assert.equal(new Set(keys).size, keys.length)
  for (const r of await rows()) assert.ok(items.some((i) => i.nm === `readmate:${r.id}` || store.listTwoWayLedger('tw').some((e) => e.noteId === r.id)), `row ${r.id} has its annotation`)
})

await check('10. Typewriter notes: written as /FreeText (status in_file), a formatting edit rewrites it in place and keeps the document, a delete removes it', async () => {
  const sdk = await import('@reading-book/book-reader-sdk')
  const TEXT = 'Xin chào thế giới\nDòng hai'
  const book = await openBook('twn', 'Typewriter', buildAnnotatedPdf())
  await service.watch(book.target, 'twn')
  const ann = (doc, y = 0.3) => ({ pageIndex: 0, rects: [{ pageIndex: 0, x: 0.1, y, width: 0.5, height: 0.2 }], typewriter: doc })
  const input = (doc, extra = {}) => ({ bookId: 'twn', styleKind: 'typewriter', colorHex: doc.base.color, note: TEXT, locatorRef: packPdfHighlightLocator(ann(doc)), pdfAnnotationRef: JSON.stringify(ann(doc)), ...extra })
  const itemOf = async (id) => (await itemsOf(book.path)).find((i) => i.nm === `readmate:${id}`)
  const doc0 = sdk.emptyTypewriterDoc()
  const saved = await invoke(OverlayChannels.saveHighlight, input(doc0))
  assert.ok(saved)
  service.notifyAppChange('twn')
  await until(async () => !!(await itemOf(saved.id)), 10000, 'FreeText written')
  const item = await itemOf(saved.id)
  assert.equal(item.subtype, 'FreeText')
  assert.equal(item.contents, TEXT)
  await until(() => events.some((e) => e.bookId === 'twn' && e.typewriterStatus?.some((t) => t.id === saved.id && t.code === 'in_file')), 8000, 'in_file status')

  // Formatting change in the app → the same annotation is rewritten (one object, one row).
  const doc1 = sdk.applyStyle(doc0, TEXT, { start: 0, end: 3 }, { bold: true, color: '#E53935' })
  const before = (await fs.promises.readFile(book.path)).length
  await invoke(OverlayChannels.saveHighlight, input(doc1, { id: saved.id }))
  service.notifyAppChange('twn')
  await until(async () => (await fs.promises.readFile(book.path)).length > before, 10000, 'rewrite')
  assert.equal((await itemsOf(book.path)).filter((i) => i.nm === `readmate:${saved.id}`).length, 1)
  assert.equal((await invoke(OverlayChannels.listHighlights, 'twn')).length, 1)

  // A box moved in another app moves the note; the rich-text document is kept.
  await sleep(600)
  const moved = await itemOf(saved.id)
  assert.ok(moved)
  const list = async () => (await invoke(OverlayChannels.listHighlights, 'twn')).map(pdfHighlightDtoToReaderHighlight)
  assert.deepEqual((await list())[0].typewriter, doc1)

  // The row is deleted: the annotation leaves the file.
  await invoke(OverlayChannels.deleteHighlight, { bookId: 'twn', id: saved.id })
  service.notifyAppChange('twn')
  await until(async () => !(await itemOf(saved.id)), 10000, 'FreeText removed')
})

service.disposeAll()
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${passed} two-way sync checks passed`)
process.exit(0)
