/**
 * Annotation import / export — performance (specs/006-annotation-import-export, SC-001 / SC-004, task T041).
 *
 * The real export and import services, the real overlay / library / TXT stores and the REAL better-sqlite3 on a temp file in
 * WAL mode. better-sqlite3 is built for Electron's ABI, so this script re-launches itself with the app's own Electron binary
 * in `ELECTRON_RUN_AS_NODE` mode (no window, nothing but os.tmpdir()). Fixtures are synthetic and generated from a fixed seed,
 * one book per format (EPUB, PDF, TXT, Markdown). Every figure is the median of RUNS runs, printed with the machine.
 *
 *   (a) export of 1,000 annotations, end to end                       < 30 s    (SC-001)
 *   (b) import of 5,000, preview + confirm                            < 60 s    (SC-004)
 *   (c) the confirm transaction alone                                 < 1 s
 *   (d) main-thread stall while planning the preview of 5,000         p99 < 100 ms and max < 1 s, progress events still delivered
 *
 * A figure over its limit fails the script. Run: npm run spike:annotations:perf   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

if (!process.versions.electron) {
  const electron = require('electron') // path to the app's Electron binary
  const alias = pathToFileURL(path.join(here, 'register-alias-bs.mjs')).href
  const r = spawnSync(electron, ['--experimental-transform-types', '--import', alias, fileURLToPath(import.meta.url)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    windowsHide: true,
  })
  process.exit(r.status ?? 1)
}

const RUNS = 5
const EXPORT_COUNT = 1_000
const IMPORT_COUNT = 5_000
const LIMITS = { exportMs: 30_000, importMs: 60_000, confirmMs: 1_000, planP99Ms: 100, planMaxMs: 1_000 }

const { getDatabase, closeAndRemove } = await import('./db-stub-bs.mjs')
const { getOverlayStore } = await import('../../electron/persistence/sqlite-overlay-store.ts')
const { getTxtStore } = await import('../../electron/persistence/sqlite-txt-store.ts')
const { getLibraryStore } = await import('../../electron/persistence/sqlite-library-store.ts')
const { exportRestoreAnnotations } = await import('../../electron/annotation-transfer/export-service.ts')
const { createImportService } = await import('../../electron/annotation-transfer/import-service.ts')
const { writeFileSafely } = await import('../../electron/pdf-sync/pdf-annotation-export.ts')

const sha = (data) => createHash('sha256').update(data).digest('hex')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-annotations-perf-files-'))
const db = getDatabase()
const overlays = getOverlayStore()
const txtStore = getTxtStore()
const library = getLibraryStore()
const T0 = '2026-10-20T13:01:12.000Z'

// ---- a fixed-seed generator (mulberry32) ---------------------------------------------------------------------------
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const WORDS = ['trăm', 'năm', 'trong', 'cõi', 'người', 'ta', 'chữ', 'tài', 'chữ', 'mệnh', 'khéo', 'là', 'ghét', 'nhau', 'đã', 'quá', 'muộn', 'vũ', 'trụ', 'hợp', 'lực']
const sentence = (rand, n) => Array.from({ length: n }, () => WORDS[Math.floor(rand() * WORDS.length)]).join(' ')

/** The i-th annotation of a format: unique content (the index is in the quote), valid for the parsers the import re-runs. */
function annotation(format, i, rand) {
  const base = { createdAt: T0, colorHex: '#FFEB3B', styleKind: 'highlight', selectionText: { highlight: `${sentence(rand, 6)} #${i}` }, note: i % 3 === 0 ? `${sentence(rand, 8)} (${i})` : undefined }
  if (format === 'epub') return { ...base, locator: { kind: 'cfi', cfi: `epubcfi(/6/${2 + (i % 60) * 2}!/4/2/${2 + i * 2},/1:0,/1:20)`, chapterIndex: i % 60 } }
  if (format === 'pdf') {
    const page = 1 + (i % 400)
    return { ...base, locator: { kind: 'page-rect', page }, pdfAnnotation: { pageIndex: page - 1, rects: [{ x: 0.05 + (i % 50) / 100, y: 0.05 + (Math.floor(i / 50) % 90) / 100, width: 0.3, height: 0.02 }] } }
  }
  if (format === 'txt') return { ...base, locator: { kind: 'text-offset', offset: i * 40, blockId: 'txt' }, txtAnnotation: { startOffset: i * 40, endOffset: i * 40 + 20 } }
  const seg = i % 200
  return { ...base, locator: { kind: 'text-offset', offset: i, blockId: 'md', chapterIndex: seg }, mdAnnotation: { startSegment: seg, startOffset: i, endSegment: seg, endOffset: i + 10 } }
}

const insertBook = db.prepare(
  `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, metadata_json, added_at, updated_at)
   VALUES (?, ?, ?, ?, ?, 'reading', '{}', '{"pageCount":400}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
)
const FORMATS = ['epub', 'pdf', 'txt', 'md']
const books = Object.fromEntries(
  FORMATS.map((f) => {
    const bytes = Buffer.from(`${f} bytes`)
    const file = path.join(tmp, `perf.${f}`)
    fs.writeFileSync(file, bytes)
    insertBook.run(`perf-${f}`, `Perf ${f}`, file, f, sha(bytes))
    return [f, { id: `perf-${f}`, file }]
  }),
)

function seed(format, count) {
  const rand = rng(20261028 + count)
  db.exec('BEGIN')
  try {
    for (let i = 0; i < count; i++) overlays.writeHighlight({ bookId: books[format].id, ...annotation(format, i, rand) })
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
const wipe = (bookId) => db.prepare('DELETE FROM notes WHERE book_id = ?').run(bookId)
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

// ---- services under test ----------------------------------------------------------------------------------------------
let events = 0
let exportTarget = null
const exportDeps = {
  findBook: async (id) => {
    const b = await library.findById(id)
    return b ? { id: b.id, title: b.title, format: b.format, sha256: b.sha256, pageCount: b.pageCount } : null
  },
  listRows: (id) => overlays.listAnnotationsForTransfer(id),
  ledger: (id) => overlays.listEmbeddedLedger(id),
  txtContentSha256: (id) => txtStore.getDocument(id)?.contentSha256,
  chooseTarget: async () => exportTarget,
  isForbiddenTarget: () => false,
  write: writeFileSafely,
  appVersion: 'perf',
}
let importFile = null
function importService() {
  return createImportService({
    pickFilePath: async () => importFile,
    readText: async (p) => fs.readFileSync(p, 'utf8'),
    library,
    findBook: exportDeps.findBook,
    bookFileAvailable: async (id) => fs.existsSync((await library.findById(id)).filePath),
    scanPdfKeys: async () => new Set(),
    listRows: (id) => overlays.listAnnotationsForTransfer(id),
    annotationStamp: (id) => overlays.annotationStamp(id),
    existingNoteIds: (ids) => overlays.existingNoteIds(ids),
    bookSha256: (id) => db.prepare('SELECT sha256 FROM books WHERE id = ?').get(id)?.sha256,
    txtState: (id) => {
      const d = txtStore.getDocument(id)
      return { revision: d?.revision ?? 0, contentSha256: d?.contentSha256 }
    },
    writeRow: (input) => overlays.writeHighlight(input),
    db,
    newId: () => `p-${Math.random().toString(36).slice(2)}`,
    progress: () => {
      events += 1
    },
  })
}

const results = []
for (const format of FORMATS) {
  const id = books[format].id
  // (a) export of 1,000, end to end
  const exportMs = []
  for (let run = 0; run < RUNS; run++) {
    wipe(id)
    seed(format, EXPORT_COUNT)
    exportTarget = path.join(tmp, `export-${format}-${run}.readmate-notes.json`)
    const t = performance.now()
    const r = await exportRestoreAnnotations(id, exportDeps)
    exportMs.push(performance.now() - t)
    assert.deepEqual(r, { ok: true, exported: EXPORT_COUNT }, `${format} export`)
  }

  // (b)(c)(d) import of 5,000: preview + confirm
  const totalMs = []
  const confirmMs = []
  const p99 = []
  const max = []
  const added = []
  for (let run = 0; run < RUNS; run++) {
    wipe(id)
    seed(format, IMPORT_COUNT)
    exportTarget = path.join(tmp, `import-${format}-${run}.readmate-notes.json`)
    assert.equal((await exportRestoreAnnotations(id, exportDeps)).ok, true)
    wipe(id)
    importFile = exportTarget
    const svc = importService()
    events = 0
    const h = monitorEventLoopDelay({ resolution: 5 })
    h.enable()
    const t0 = performance.now()
    const pre = await svc.pickFile({ bookId: id })
    const planned = performance.now()
    // The sampling timer was held back by any blocking; let it fire so the stall is recorded before the histogram is read.
    await new Promise((resolve) => setTimeout(resolve, 30))
    h.disable()
    assert.equal(pre.ok, true, `${format} preview: ${JSON.stringify(pre)}`)
    assert.equal(pre.preview.toAdd, IMPORT_COUNT, `${format} toAdd`)
    const c0 = performance.now()
    const done = await svc.confirm(pre.preview.sessionId)
    const end = performance.now()
    assert.deepEqual(done, { ok: true, added: IMPORT_COUNT, present: 0, notPlaced: 0 }, `${format} confirm`)
    assert.ok(events >= 2, 'progress events were delivered')
    assert.equal(overlays.countAnnotationsForTransfer(id), IMPORT_COUNT)
    totalMs.push(end - t0)
    confirmMs.push(end - c0)
    p99.push(h.percentile(99) / 1e6)
    max.push(h.max / 1e6)
    added.push(planned - t0)
  }
  results.push({ format, exportMs: median(exportMs), importMs: median(totalMs), confirmMs: median(confirmMs), planMs: median(added), planP99: median(p99), planMax: median(max) })
  wipe(id)
}

console.log(`machine: ${os.cpus()[0].model.trim()} x${os.cpus().length}, ${Math.round(os.totalmem() / 2 ** 30)} GB, electron ${process.versions.electron} (node ${process.versions.node}), better-sqlite3 on a temp file in WAL mode`)
console.log(`median of ${RUNS} runs; export ${EXPORT_COUNT} annotations / import ${IMPORT_COUNT} annotations`)
console.log('format | export 1,000 (ms) | import 5,000 total (ms) | confirm (ms) | planning (ms) | planning stall p99 (ms) | planning stall max (ms)')
const f = (n) => n.toFixed(0).padStart(8)
for (const r of results) console.log(`${r.format.padEnd(6)} | ${f(r.exportMs)} | ${f(r.importMs)} | ${f(r.confirmMs)} | ${f(r.planMs)} | ${r.planP99.toFixed(1).padStart(8)} | ${r.planMax.toFixed(1).padStart(8)}`)

let failed = false
const check = (ok, message) => {
  console.log(`  ${ok ? '✓' : '✗'} ${message}`)
  if (!ok) failed = true
}
for (const r of results) {
  check(r.exportMs < LIMITS.exportMs, `${r.format}: export of ${EXPORT_COUNT} in ${r.exportMs.toFixed(0)} ms (limit ${LIMITS.exportMs})`)
  check(r.importMs < LIMITS.importMs, `${r.format}: import of ${IMPORT_COUNT} in ${r.importMs.toFixed(0)} ms (limit ${LIMITS.importMs})`)
  check(r.confirmMs < LIMITS.confirmMs, `${r.format}: confirm transaction ${r.confirmMs.toFixed(0)} ms (limit ${LIMITS.confirmMs})`)
  check(r.planP99 < LIMITS.planP99Ms && r.planMax < LIMITS.planMaxMs, `${r.format}: planning stall p99 ${r.planP99.toFixed(1)} ms / max ${r.planMax.toFixed(1)} ms (limits ${LIMITS.planP99Ms} / ${LIMITS.planMaxMs})`)
}

closeAndRemove()
fs.rmSync(tmp, { recursive: true, force: true })
if (failed) {
  console.log('annotations perf spike: a figure is over its limit')
  process.exit(1)
}
console.log('annotations perf spike: all figures within their limits')
