/**
 * Checks for the LIVE sync of embedded PDF annotations (docs/implementation_plan/pdf_embedded_annotation_live_sync.md),
 * without Electron but with the real pieces: `/NM` reader, Main's scan (pdf.js 5.4.624 legacy build),
 * `StableFileWatcher` on real temp files, `createPdfAnnotationSyncService` and `SqliteOverlayStore`
 * on the real migrated schema (node:sqlite, migration 023). Files are rewritten the way other
 * viewers save: in place, as an incremental update, as a full rewrite (objects renumbered), as
 * "write temp + rename over", in several bursts, truncated first.
 *
 *   A. /NM reader      -> literal / hex / UTF-16 / escaped names, last incremental version wins,
 *                         object streams, nested dictionaries ignored, encrypted files skipped
 *   B. scan            -> names attached for plain, compressed and incrementally saved files
 *   C. watcher         -> change detection, debounce of bursts, rename-over (new inode), duplicate
 *                         events dropped, dispose stops everything
 *   D. live sync       -> open sync; add / recolor + comment / move / resize (with /NM: same row) /
 *                         move without /NM / delete / delete all — each reported without reopening;
 *                         no duplicates after many syncs; app rows untouched; app edits survive a
 *                         removal; partial writes and truncation never delete; switching / closing
 *                         the book stops the watch; a failed transaction rolls back and retries
 *
 * Run: npm run spike:pdf:live   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pdfHighlightDtoToReaderHighlight } from '@reading-book/book-reader-sdk'
import { invoke } from './electron-stub.mjs'
import { getDatabase } from './db-stub.mjs'
import { appendIncrementalUpdate, buildAnnotatedPdf } from '../../e2e/support/build-annotated-pdf.mjs'

const { OverlayChannels } = await import('../../electron/ipc/channels.ts')
const { registerOverlayIpc } = await import('../../electron/ipc/overlay.ipc.ts')
const { getOverlayStore } = await import('../../electron/persistence/sqlite-overlay-store.ts')
const { readAnnotationNames, nameFromObjectBody } = await import('../../electron/pdf-sync/pdf-raw-objects.ts')
const { scanPdfAnnotationBytes } = await import('../../electron/pdf-sync/pdf-annotation-scan.ts')
const { StableFileWatcher } = await import('../../electron/pdf-sync/stable-file-watcher.ts')
const { createPdfAnnotationSyncService, sha256Hex } = await import('../../electron/pdf-sync/pdf-annotation-sync-service.ts')

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-live-'))
const latencies = []

// ---------------------------------------------------------------- A. /NM reader
console.log('A. /NM reader')

await check('literal, hex, UTF-16BE and escaped names; nested dictionaries are not the annotation’s', () => {
  assert.equal(nameFromObjectBody(' << /Type /Annot /NM (abc-1) /Subtype /Highlight >> '), 'abc-1')
  assert.equal(nameFromObjectBody('<</NM<616263>>>'), 'abc')
  assert.equal(nameFromObjectBody('<< /NM <FEFF0041004E> >>'), 'AN')
  assert.equal(nameFromObjectBody('<< /NM (a\\(b\\)c \\101) >>'), 'a(b)c A')
  assert.equal(nameFromObjectBody('<< /NMX (no) /NM (yes) >>'), 'yes')
  assert.equal(nameFromObjectBody('<< /Popup << /NM (inner) >> /T (x) >>'), undefined)
  assert.equal(nameFromObjectBody('<< /Contents (/NM (fake)) /T (x) >>'), undefined)
  assert.equal(nameFromObjectBody('<< /Subtype /Highlight >>'), undefined)
})

const NAMED = [
  { page: 1, subtype: 'Highlight', lines: [2], color: [1, 1, 0], nm: '{A-0001}', contents: 'first' },
  { page: 1, subtype: 'Underline', lines: [4], color: [0, 0, 1], nm: '{A-0002}' },
  { page: 2, subtype: 'StrikeOut', lines: [1], color: [1, 0, 0], nm: '{A-0003}' },
]

await check('names come from plain objects, object streams and the latest incremental version', () => {
  const plain = buildAnnotatedPdf({ annotations: NAMED })
  const ids = ['10R', '11R', '12R']
  assert.deepEqual([...readAnnotationNames(plain, ids).values()], ['{A-0001}', '{A-0002}', '{A-0003}'])
  const compressed = buildAnnotatedPdf({ annotations: NAMED, objectStreams: true })
  assert.deepEqual([...readAnnotationNames(compressed, ids).values()], ['{A-0001}', '{A-0002}', '{A-0003}'])
  const updated = appendIncrementalUpdate(plain, { annotations: NAMED, changes: { 0: { ...NAMED[0], nm: '{A-0001-v2}' } } })
  assert.equal(readAnnotationNames(updated, ['10R']).get('10R'), '{A-0001-v2}')
  assert.equal(readAnnotationNames(plain, ['99R', 'bogus']).size, 0)
  const encrypted = Buffer.concat([plain, Buffer.from('trailer\n<< /Encrypt 5 0 R >>\n%%EOF\n', 'latin1')])
  assert.equal(readAnnotationNames(encrypted, ids).size, 0)
})

// ---------------------------------------------------------------- B. scan
console.log('B. scan (pdf.js + /NM)')

await check('every scanned item carries its name, whatever the file layout', async () => {
  for (const bytes of [
    buildAnnotatedPdf({ annotations: NAMED }),
    buildAnnotatedPdf({ annotations: NAMED, objectStreams: true }),
    appendIncrementalUpdate(buildAnnotatedPdf({ annotations: NAMED }), { annotations: NAMED, changes: { 1: { ...NAMED[1], lines: [6] } } }),
  ]) {
    const { items, complete } = await scanPdfAnnotationBytes(new Uint8Array(bytes))
    assert.equal(complete, true)
    assert.deepEqual(items.map((i) => i.nm), ['{A-0001}', '{A-0002}', '{A-0003}'])
  }
})

// ---------------------------------------------------------------- C. watcher
console.log('C. watcher')
const FAST = { debounceMs: 60, stableMs: 120, pollMs: 400, maxWaitMs: 5000 }

function watchFile(file) {
  const reports = []
  const watcher = new StableFileWatcher(file, { ...FAST, initialSignature: null, onStable: (sig) => reports.push(sig) })
  return { watcher, reports }
}
async function until(fn, timeoutMs = 5000, label = 'condition') {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await sleep(20)
  }
}

await check('a write is reported once it settles; a burst of writes is reported once', async () => {
  const file = path.join(tmp, 'w1.pdf')
  fs.writeFileSync(file, 'v0')
  const { watcher, reports } = watchFile(file)
  watcher.start()
  await sleep(150)
  fs.writeFileSync(file, 'v1-longer')
  await until(() => reports.length === 1, 3000, 'first report')
  for (let i = 0; i < 6; i++) {
    fs.appendFileSync(file, `-chunk${i}`)
    await sleep(30) // well under debounce + stable time
  }
  await until(() => reports.length === 2, 3000, 'burst report')
  await sleep(700) // polls see no difference → no extra report
  assert.equal(reports.length, 2)
  assert.equal(reports[1].size, fs.statSync(file).size)
  watcher.dispose()
})

await check('a save that replaces the file (temp + rename, new inode) is reported', async () => {
  const file = path.join(tmp, 'w2.pdf')
  fs.writeFileSync(file, 'original')
  const { watcher, reports } = watchFile(file)
  watcher.start()
  await sleep(150)
  const temp = path.join(tmp, 'w2.pdf.tmp')
  fs.writeFileSync(temp, 'replacement content')
  fs.renameSync(temp, file)
  await until(() => reports.length >= 1, 3000, 'replace report')
  assert.equal(reports.at(-1).size, 'replacement content'.length)
  watcher.dispose()
})

await check('duplicate / spurious events for an unchanged file are dropped; dispose stops reports', async () => {
  const file = path.join(tmp, 'w3.pdf')
  fs.writeFileSync(file, 'same')
  const { watcher, reports } = watchFile(file)
  watcher.start()
  await sleep(150)
  fs.writeFileSync(file, 'same+1')
  await until(() => reports.length === 1, 3000, 'report')
  for (let i = 0; i < 5; i++) watcher.notify() // e.g. neighbour files, the app's own read
  fs.writeFileSync(path.join(tmp, 'neighbour.txt'), 'x')
  await sleep(600)
  assert.equal(reports.length, 1)
  watcher.dispose()
  fs.writeFileSync(file, 'after dispose')
  await sleep(700)
  assert.equal(reports.length, 1)
  assert.equal(watcher.isDisposed, true)
})

// ---------------------------------------------------------------- D. live sync service
console.log('D. live sync service')

const db = getDatabase()
db.exec('PRAGMA foreign_keys = ON')
const insertBook = db.prepare(
  `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at)
   VALUES (?, ?, ?, ?, ?, 'reading', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
)
const fileA = path.join(tmp, 'book-a.pdf')
const fileB = path.join(tmp, 'book-b.pdf')
insertBook.run('live-a', 'A', fileA, 'pdf', 'sha-a')
insertBook.run('live-b', 'B', fileB, 'pdf', 'sha-b')
registerOverlayIpc()
const store = getOverlayStore()

const paths = { 'live-a': fileA, 'live-b': fileB }
const served = new Map()
const events = []
let scans = 0
let failNextSync = false
const service = createPdfAnnotationSyncService({
  resolvePdfPath: async (bookId) => (paths[bookId] && fs.existsSync(paths[bookId]) ? paths[bookId] : null),
  scan: async (bytes) => {
    scans++
    return scanPdfAnnotationBytes(bytes)
  },
  sync: (bookId, items, options) => {
    if (failNextSync) {
      failNextSync = false
      throw new Error('injected failure before the transaction')
    }
    return store.syncEmbeddedPdfAnnotations(bookId, items, options)
  },
  servedSha256: (bookId) => served.get(bookId),
  emit: (_target, event) => events.push({ ...event, receivedAt: Date.now() }),
  watcherOptions: FAST,
  log: (m, d) => process.env.LIVE_DEBUG && console.log('    [log]', m, d?.message ?? ''),
})

function makeTarget(id) {
  const listeners = []
  return {
    id,
    destroyed: false,
    isDestroyed() {
      return this.destroyed
    },
    once(_event, fn) {
      listeners.push(fn)
    },
    destroy() {
      this.destroyed = true
      for (const fn of listeners) fn()
    },
  }
}

const rows = async (bookId) => (await invoke(OverlayChannels.listHighlights, bookId)).map(pdfHighlightDtoToReaderHighlight)
const ledger = (bookId) => db.prepare(`SELECT source_key FROM pdf_embedded_annotations WHERE book_id = ? ORDER BY source_key`).all(bookId).map((r) => r.source_key)

/** Write `bytes` to `file` like another viewer and wait for the sync event it causes. */
async function saveAndWait(file, bytes, { label, write = 'inplace', timeoutMs = 6000 } = {}) {
  const before = events.length
  const startedAt = Date.now()
  if (write === 'rename') {
    const temp = `${file}.~tmp`
    fs.writeFileSync(temp, bytes)
    fs.renameSync(temp, file)
  } else fs.writeFileSync(file, bytes)
  await until(() => events.length > before, timeoutMs, `sync event (${label})`)
  const event = events.at(-1)
  latencies.push({ label, ms: event.receivedAt - startedAt })
  return event
}
async function noEventFor(ms) {
  const before = events.length
  await sleep(ms)
  return events.length === before
}

const windowA = makeTarget(1)
let v = NAMED.slice()

await check('open: the first sync imports everything and may hide the displayed file’s own marks', async () => {
  const bytes = buildAnnotatedPdf({ annotations: v })
  fs.writeFileSync(fileA, bytes)
  served.set('live-a', sha256Hex(bytes))
  assert.deepEqual(await service.watch(windowA, 'live-a'), { ok: true })
  await until(() => events.length === 1, 4000, 'open event')
  const e = events[0]
  assert.equal(e.reason, 'open')
  assert.equal(e.outcome.inserted.length, 3)
  assert.equal(e.matchesDisplayedFile, true)
  assert.equal(e.complete, true)
  assert.equal((await rows('live-a')).length, 3)
  assert.ok(ledger('live-a').every((k) => k.startsWith('nm1:')))
})

let firstRowId
await check('add in another app → new row, no reopen (incremental save)', async () => {
  firstRowId = (await rows('live-a')).find((r) => r.note === 'first').id
  v = [...v, { page: 2, subtype: 'Highlight', lines: [6], color: [0, 1, 0], nm: '{A-0004}', contents: 'added live' }]
  const e = await saveAndWait(fileA, buildAnnotatedPdf({ annotations: v }), { label: 'add' })
  assert.equal(e.reason, 'file-change')
  assert.equal(e.matchesDisplayedFile, false) // the reader still displays the old bytes
  assert.equal(e.outcome.inserted.length, 1)
  assert.equal(e.outcome.inserted[0].note, 'added live')
  assert.equal((await rows('live-a')).length, 4)
})

await check('recolor + comment edit → the same row is updated', async () => {
  v = v.map((a, i) => (i === 0 ? { ...a, color: [1, 0, 1], contents: 'edited live' } : a))
  const base = buildAnnotatedPdf({ annotations: v.map((a, i) => (i === 0 ? NAMED[0] : a)) })
  const e = await saveAndWait(fileA, appendIncrementalUpdate(base, { annotations: v, changes: { 0: v[0] } }), { label: 'recolor' })
  assert.deepEqual(e.outcome.updated.map((h) => h.id), [firstRowId])
  const row = (await rows('live-a')).find((r) => r.id === firstRowId)
  assert.equal(row.colorHex, '#FF00FF')
  assert.equal(row.note, 'edited live')
})

await check('move and resize of a named annotation → same row, new geometry (full rewrite, objects renumbered)', async () => {
  const yBefore = (await rows('live-a')).find((r) => r.id === firstRowId).rects[0].y
  v = v.map((a, i) => (i === 0 ? { ...a, lines: [6, 7] } : a))
  const e = await saveAndWait(fileA, buildAnnotatedPdf({ annotations: v, padObjects: 5 }), { label: 'move+resize', write: 'rename' })
  assert.deepEqual(e.outcome.updated.map((h) => h.id), [firstRowId])
  assert.equal(e.outcome.inserted.length + e.outcome.deleted.length, 0)
  const row = (await rows('live-a')).find((r) => r.id === firstRowId)
  assert.equal(row.rects.length, 2)
  assert.ok(row.rects[0].y > yBefore)
  assert.equal((await rows('live-a')).length, 4)
})

await check('delete in another app → the imported row is deleted (complete scan)', async () => {
  const gone = (await rows('live-a')).find((r) => r.styleKind === 'strikethrough').id
  v = v.filter((a) => a.nm !== '{A-0003}')
  const e = await saveAndWait(fileA, buildAnnotatedPdf({ annotations: v }), { label: 'delete' })
  assert.deepEqual(e.outcome.deleted, [gone])
  assert.equal((await rows('live-a')).length, 3)
  assert.equal(ledger('live-a').length, 3)
})

await check('a move without /NM is a delete + insert; an app-edited row survives its removal', async () => {
  // An unnamed annotation, imported, then edited in the app (note added).
  const unnamed = { page: 3, subtype: 'Underline', lines: [3], color: [0.5, 0.5, 0.5] }
  v = [...v, unnamed]
  await saveAndWait(fileA, buildAnnotatedPdf({ annotations: v }), { label: 'add unnamed' })
  const imported = (await rows('live-a')).find((r) => r.page === 3)
  await invoke(OverlayChannels.saveHighlight, {
    bookId: 'live-a',
    id: imported.id,
    locatorRef: imported.locatorRef,
    styleKind: imported.styleKind,
    colorHex: imported.colorHex,
    note: 'my note in Readmate',
    selectionTextRef: imported.selectionText ? JSON.stringify(imported.selectionText) : undefined,
    pdfAnnotationRef: JSON.stringify({ pageIndex: 2, rects: imported.rects.map((r) => ({ pageIndex: 2, x: r.x, y: r.y, width: r.width, height: r.height })) }),
  })
  // Moved in the other app: without /NM that's "old removed, new added".
  v = v.map((a) => (a === unnamed ? { ...unnamed, lines: [5] } : a))
  const e = await saveAndWait(fileA, buildAnnotatedPdf({ annotations: v }), { label: 'move unnamed' })
  assert.equal(e.outcome.inserted.length, 1)
  assert.equal(e.outcome.deleted.length, 0)
  assert.equal(e.outcome.keptAppEditsOnRemoval, 1)
  assert.equal((await rows('live-a')).find((r) => r.id === imported.id)?.note, 'my note in Readmate')
})

await check('a save caught half-way or truncated first never deletes anything', async () => {
  const before = (await rows('live-a')).length
  const full = buildAnnotatedPdf({ annotations: v.slice(0, 1) }) // the final state removes several
  const scansBefore = scans
  // Truncate to zero, wait past the stability window, then write half, wait again.
  fs.writeFileSync(fileA, Buffer.alloc(0))
  await sleep(500)
  fs.writeFileSync(fileA, full.subarray(0, Math.floor(full.length / 2)))
  await sleep(500)
  assert.equal((await rows('live-a')).length, before, 'nothing deleted while the file is incomplete')
  assert.equal(scans, scansBefore, 'an incomplete file (no %%EOF) is never scanned')
  // Restore the previous complete state: nothing changed overall.
  fs.writeFileSync(fileA, buildAnnotatedPdf({ annotations: v }))
  await sleep(600)
  assert.equal((await rows('live-a')).length, before)
})

await check('no duplicates after many syncs of the same content; duplicate events cause no scan', async () => {
  const count = (await rows('live-a')).length
  const bytes = buildAnnotatedPdf({ annotations: v, padObjects: 2 })
  for (let i = 0; i < 3; i++) {
    fs.writeFileSync(fileA, bytes) // same bytes again: new mtime, same SHA-256
    await sleep(350)
  }
  await sleep(500)
  const scansBefore = scans
  fs.utimesSync(fileA, new Date(), new Date()) // touch
  await sleep(600)
  assert.equal(scans, scansBefore, 'a touch with identical content is not even scanned')
  assert.equal((await rows('live-a')).length, count)
  assert.equal(new Set(ledger('live-a')).size, ledger('live-a').length)
})

await check('delete everything in another app → every untouched import goes, app rows stay', async () => {
  const appMade = await invoke(OverlayChannels.saveHighlight, {
    bookId: 'live-a',
    locatorRef: JSON.stringify({ kind: 'page-rect', page: 1, rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.02 }, chapterIndex: 0 }),
    styleKind: 'highlight',
    colorHex: '#81C784',
    pdfAnnotationRef: JSON.stringify({ pageIndex: 0, rects: [{ pageIndex: 0, x: 0.1, y: 0.1, width: 0.2, height: 0.02 }] }),
  })
  v = []
  const e = await saveAndWait(fileA, buildAnnotatedPdf({ annotations: v }), { label: 'delete all' })
  assert.ok(e.outcome.deleted.length >= 3)
  const left = await rows('live-a')
  assert.deepEqual(left.map((r) => r.id).sort(), [appMade.id, (left.find((r) => r.note === 'my note in Readmate') ?? {}).id].filter(Boolean).sort())
})

await check('a failed sync rolls back completely and is retried', async () => {
  const count = (await rows('live-a')).length
  const ledgerBefore = ledger('live-a')
  // 1) failure inside the real transaction (second write throws) → full rollback.
  const original = store.writeHighlight
  let calls = 0
  store.writeHighlight = function (...args) {
    if (++calls === 2) throw new Error('injected failure mid-transaction')
    return original.apply(this, args)
  }
  v = [
    { page: 1, subtype: 'Highlight', lines: [1], color: [1, 1, 0], nm: '{R-1}' },
    { page: 1, subtype: 'Highlight', lines: [3], color: [1, 1, 0], nm: '{R-2}' },
  ]
  fs.writeFileSync(fileA, buildAnnotatedPdf({ annotations: v }))
  await until(() => calls >= 2, 4000, 'failing attempt')
  assert.equal((await rows('live-a')).length, count, 'no partial rows after the rollback')
  assert.deepEqual(ledger('live-a'), ledgerBefore)
  store.writeHighlight = original
  // 2) the retry (same file, no new event needed) applies everything once.
  // Wait on the outcome in SQLite itself (not on the last event), generously: the retry fires after
  // RETRY_DELAY_MS and then rescans.
  const deadline = Date.now() + 15_000
  while ((await rows('live-a')).length !== count + 2) {
    if (Date.now() > deadline) throw new Error(`retry did not apply: ${JSON.stringify(events.slice(-3).map((e) => [e.reason, e.outcome.inserted.length, e.outcome.deleted.length]))}`)
    await sleep(50)
  }
  assert.equal(new Set(ledger('live-a')).size, ledger('live-a').length)
  assert.equal((await rows('live-a')).length, count + 2)
  // 3) a failure before the transaction is retried too.
  failNextSync = true
  v = [...v, { page: 2, subtype: 'Underline', lines: [2], color: [0, 0, 1], nm: '{R-3}' }]
  const e = await saveAndWait(fileA, buildAnnotatedPdf({ annotations: v }), { label: 'retry after failure', timeoutMs: 8000 })
  assert.equal(e.outcome.inserted.length, 1)
  assert.equal((await rows('live-a')).length, count + 3)
})

await check('switching to another book stops watching the first; closing the window stops everything', async () => {
  fs.writeFileSync(fileB, buildAnnotatedPdf({ annotations: [{ page: 1, subtype: 'Highlight', lines: [2], color: [1, 1, 0], nm: '{B-1}' }] }))
  await service.watch(windowA, 'live-b')
  await until(() => events.at(-1)?.bookId === 'live-b', 4000, 'open of B')
  assert.deepEqual(service.activeSessions(), [{ targetId: 1, bookId: 'live-b' }])
  fs.writeFileSync(fileA, buildAnnotatedPdf({ annotations: [] }))
  assert.equal(await noEventFor(1200), true, 'A is no longer watched')
  await saveAndWait(fileB, buildAnnotatedPdf({ annotations: [{ page: 1, subtype: 'Highlight', lines: [2], color: [0, 0, 1], nm: '{B-1}' }] }), { label: 'B recolor' })
  // A stale unwatch for A (late cleanup of the previous book) must not end B's watch.
  service.unwatch(windowA, 'live-a')
  assert.equal(service.activeSessions().length, 1)
  windowA.destroy()
  assert.deepEqual(service.activeSessions(), [])
  fs.writeFileSync(fileB, buildAnnotatedPdf({ annotations: [] }))
  assert.equal(await noEventFor(1200), true, 'nothing after the window closed')
})

await check('unwatch ends the session; watching a missing / non-PDF book is refused', async () => {
  const w = makeTarget(2)
  assert.deepEqual(await service.watch(w, 'nope'), { ok: false, errorCode: 'not_found' })
  await service.watch(w, 'live-b')
  await until(() => events.at(-1)?.reason === 'open' && events.at(-1)?.bookId === 'live-b', 4000, 'open')
  service.unwatch(w, 'live-b')
  assert.deepEqual(service.activeSessions(), [])
  service.disposeAll()
})

console.log('\nLatency (file written → sync event; debounce 60 ms + stability 120 ms in this harness):')
for (const { label, ms } of latencies) console.log(`  ${label.padEnd(22)} ${ms} ms`)
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${passed} live embedded-annotation checks passed`)
process.exit(0)
