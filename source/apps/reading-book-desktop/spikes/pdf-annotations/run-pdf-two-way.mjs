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
 *   6. locked file       write fails (read-only file) → pending, retried, then written
 *   7. race              another app saves while Readmate prepares its write → restart, nothing lost
 *   8. crash recovery    transaction fails after the file write → next cycle links, no duplicates;
 *                        a row deleted while its own write is in flight leaves the file, not resurrected
 *   9. write-back off    Readmate edits never touch the file
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
const fileOff = path.join(tmp, 'off.pdf')
insertBook.run('tw', 'Two-way', file, 'sha-tw')
insertBook.run('off', 'Write-back off', fileOff, 'sha-off')
registerOverlayIpc()
const store = getOverlayStore()
store.setPdfWriteBack('tw', true)

const paths = { tw: file, off: fileOff }
const events = []
let scans = 0
let writes = 0
let beforeApplyOps = async () => {}
let applyHook = null
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
  twoWay: {
    isEnabled: (id) => store.getPdfWriteBack(id),
    plan: async (id, items, complete) => planTwoWaySync({ items, complete, ledger: store.listTwoWayLedger(id), rows: await store.listHighlights(id) }),
    apply: (id, plan, items, after) => (applyHook ? applyHook(id, plan, items, after) : store.applyTwoWaySync(id, plan, items, after)),
    applyOps: async (bytes, ops) => {
      await beforeApplyOps()
      return applyAnnotationOps({ bytes, ops })
    },
    writeFile: async (p, bytes) => {
      writes++
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
fs.writeFileSync(fileOff, buildAnnotatedPdf())
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
  assert.equal(lastEvent().writeStatus, 'written')
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

await check('6. a locked (read-only) file: the write fails, stays pending, and is retried once it’s free', async () => {
  const f = await saveRow({ ...rectRow(1, 0.7) })
  fs.chmodSync(file, 0o444)
  service.notifyAppChange('tw')
  await until(() => events.some((e) => e.writeStatus === 'locked' || e.writeStatus === 'failed'), 8000, 'locked status')
  assert.equal(await written(f.id), undefined)
  fs.chmodSync(file, 0o666)
  await until(async () => !!(await written(f.id)), 15000, 'retried write')
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
  }
  service.notifyAppChange('tw')
  await until(() => deletedMidWrite, 8000, 'delete during write')
  beforeApplyOps = async () => {}
  await until(async () => !(await written(r.id)), 12000, 'removed from the file afterwards')
  await sleep(1200)
  assert.equal((await rows()).some((x) => x.note === 'deleted mid-write'), false, 'not imported back')
})

await check('9. write-back off: Readmate edits never touch the file', async () => {
  const before = sha256Hex(fs.readFileSync(fileOff))
  const target2 = { id: 2, isDestroyed: () => false, once: () => {} }
  await service.watch(target2, 'off')
  await sleep(400)
  await invoke(OverlayChannels.saveHighlight, { bookId: 'off', styleKind: 'highlight', colorHex: '#FFEB3B', ...rectRow(0, 0.1) })
  service.notifyAppChange('off')
  await sleep(1200)
  assert.equal(sha256Hex(fs.readFileSync(fileOff)), before)
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

service.disposeAll()
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${passed} two-way sync checks passed`)
process.exit(0)
