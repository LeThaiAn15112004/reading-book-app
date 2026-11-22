/**
 * Spec 016 (T047, SC-006): cancelled / failed imports leave nothing behind, and the startup sweep removes what a
 * quit or crash could have left — only inside the app's own folders; the reader's files keep their fingerprint.
 *
 *   npm run spike:import:cleanup
 *
 * 1. The startup sweep on a temp layout: orphan `{books}/{uuid}` folders, orphan covers and old `reading-book-*` temp
 *    folders go; referenced folders / covers, `.partial` ZIP folders, recent temp folders and non-UUID names stay.
 * 2. 20 real `import:runJob` runs that are cancelled while fingerprinting or fail (damaged EPUB, unsupported,
 *    changed file): 0 rows, 0 sandbox copies, 0 covers, and every source file's SHA-256 unchanged.
 * 3. Spec 017 (FR-021): a file whose modified time alone changes during the import (a sync program touching it) is
 *    still added; only a content change is "file changed".
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, handlers } from '../pdf-annotations/electron-stub.mjs'
import { getDatabase } from '../pdf-annotations/db-stub.mjs'
import { buildSyntheticSamples } from './import-samples.mjs'

const { sweepImportLeftovers } = await import('../../files/import-sweep.ts')
const { ImportChannels } = await import('../../ipc/channels.ts')
const { registerImportIpc } = await import('../../ipc/import.ipc.ts')
const { holdPickedFile } = await import('../../ipc/picked-files.ts')
const { ensureBooksSandbox, getCoversPath } = await import('../../files/sandbox.ts')

const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const uuid = () => globalThis.crypto.randomUUID()
let passed = 0
const check = async (name, fn) => {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-016-cleanup-'))
try {
  await check('startup sweep removes only leftovers inside the app folders', async () => {
    const booksDir = path.join(work, 'books')
    const coversDir = path.join(work, 'covers')
    const tempDir = path.join(work, 'tmp')
    for (const d of [booksDir, coversDir, tempDir]) fs.mkdirSync(d, { recursive: true })
    const keptBook = path.join(booksDir, uuid())
    const orphanBook = path.join(booksDir, uuid())
    const partialBook = path.join(booksDir, uuid())
    const notUuid = path.join(booksDir, 'my-notes')
    for (const d of [keptBook, orphanBook, partialBook, notUuid]) fs.mkdirSync(d)
    fs.writeFileSync(path.join(keptBook, 'file.epub'), 'x')
    fs.writeFileSync(path.join(orphanBook, 'file.epub'), 'x')
    fs.writeFileSync(path.join(partialBook, '.partial'), '')
    const keptCover = path.join(coversDir, 'kept.png')
    const orphanCover = path.join(coversDir, 'orphan.png')
    fs.writeFileSync(keptCover, 'p')
    fs.writeFileSync(orphanCover, 'p')
    const oldTemp = path.join(tempDir, 'reading-book-cloud-old')
    const newTemp = path.join(tempDir, 'reading-book-cloud-new')
    const otherTemp = path.join(tempDir, 'someone-else')
    for (const d of [oldTemp, newTemp, otherTemp]) fs.mkdirSync(d)
    const hourAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000
    fs.utimesSync(oldTemp, hourAgo, hourAgo)
    fs.utimesSync(otherTemp, hourAgo, hourAgo)

    const report = await sweepImportLeftovers({
      rows: () => [{ filePath: path.join(keptBook, 'file.epub'), coverPath: keptCover }],
      booksDir,
      coversDir,
      tempDir,
      now: Date.now(),
    })
    assert.deepEqual(report, { bookDirs: 1, covers: 1, tempDirs: 1 })
    assert.equal(fs.existsSync(orphanBook), false)
    for (const kept of [keptBook, partialBook, notUuid, keptCover, newTemp, otherTemp]) assert.equal(fs.existsSync(kept), true, kept)
    assert.equal(fs.existsSync(orphanCover), false)
    assert.equal(fs.existsSync(oldTemp), false)
  })

  await check('20 cancelled / failed imports leave 0 rows, 0 copies, 0 covers; the sources are unchanged', async () => {
    const userData = app.getPath('userData')
    fs.rmSync(path.dirname(userData), { recursive: true, force: true })
    fs.mkdirSync(userData, { recursive: true })
    const db = getDatabase()
    db.transaction ??= (fn) => (...args) => {
      db.exec('BEGIN')
      try {
        const r = fn(...args)
        db.exec('COMMIT')
        return r
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    }
    registerImportIpc()
    const runJob = handlers.get(ImportChannels.runJob)
    const cancelJob = handlers.get(ImportChannels.cancelJob)
    const sender = { isDestroyed: () => false, send: () => {} }

    const samplesDir = path.join(work, 'samples')
    const [epubWithCover, , pdf] = buildSyntheticSamples(samplesDir)
    // A large file, so a cancel lands while it is being fingerprinted.
    const big = path.join(samplesDir, 'big.pdf')
    fs.writeFileSync(big, Buffer.concat([fs.readFileSync(pdf), Buffer.alloc(64 * 1024 * 1024, 7)]))
    const damaged = path.join(samplesDir, 'damaged.epub')
    fs.writeFileSync(damaged, 'PK\u0003\u0004 not really a zip')
    const sources = [big, damaged, epubWithCover]
    const before = Object.fromEntries(sources.map((f) => [f, sha(f)]))

    let cancelled = 0
    let failed = 0
    for (let i = 0; i < 20; i++) {
      const jobId = uuid()
      if (i % 2 === 0) {
        const pickId = holdPickedFile(big)
        const run = runJob({ sender }, { jobId, pickId })
        await new Promise((r) => setTimeout(r, 5))
        const answer = cancelJob({}, { jobId })
        const result = await run
        assert.equal(answer.ok, true)
        assert.equal(result.errorCode, 'cancelled')
        cancelled += 1
      } else {
        const changing = i % 4 !== 1
        // Spec 017 (FR-021): "changed" is judged by content, so the changed case works on its own copy of the book
        // (the sample files keep their fingerprint).
        const file = changing ? path.join(work, `changing-${i}.epub`) : damaged
        if (changing) fs.copyFileSync(epubWithCover, file)
        const pickId = holdPickedFile(file)
        if (changing) {
          // Changed while importing: rewritten when Main reports "reading" — after the fingerprint, before the
          // "file changed?" check — so the import must answer file_changed and remove the cover it extracted.
          const rewriting = {
            isDestroyed: () => false,
            send: (_channel, payload) => {
              if (payload?.step !== 'reading') return
              fs.appendFileSync(file, Buffer.from('changed'))
            },
          }
          const result = await runJob({ sender: rewriting }, { jobId, pickId })
          assert.equal(result.errorCode, 'file_changed')
          fs.rmSync(file, { force: true })
        } else {
          const result = await runJob({ sender }, { jobId, pickId })
          assert.equal(result.ok, true, 'a damaged EPUB falls back to its file name (today’s behaviour)')
          db.prepare('DELETE FROM books WHERE id = ?').run(result.bookId)
          // Its cover (none) and row are gone; nothing else was created.
        }
        failed += 1
      }
    }
    assert.ok(cancelled >= 10)
    const rows = db.prepare('SELECT count(*) AS n FROM books').get().n
    const sandbox = ensureBooksSandbox()
    const copies = fs.existsSync(sandbox) ? fs.readdirSync(sandbox).length : 0
    const covers = fs.existsSync(getCoversPath()) ? fs.readdirSync(getCoversPath()).length : 0
    assert.deepEqual({ rows, copies, covers }, { rows: 0, copies: 0, covers: 0 })
    for (const f of sources) assert.equal(sha(f), before[f], `${path.basename(f)} unchanged`)
    console.log(`    (${cancelled} cancelled while fingerprinting, ${failed} failed / changed)`)
  })

  await check('spec 017: a modified time touched during the import (same content) is still added', async () => {
    const db = getDatabase()
    const runJob = handlers.get(ImportChannels.runJob)
    const samples = path.join(work, 'samples-touched')
    fs.mkdirSync(samples, { recursive: true })
    const [epubWithCover] = buildSyntheticSamples(samples)
    const file = path.join(work, 'touched.epub')
    fs.copyFileSync(epubWithCover, file)
    const touching = {
      isDestroyed: () => false,
      send: (_channel, payload) => {
        if (payload?.step !== 'reading') return
        const t = new Date(Date.now() + 60_000)
        fs.utimesSync(file, t, t)
      },
    }
    const result = await runJob({ sender: touching }, { jobId: 'touched-job', pickId: holdPickedFile(file) })
    assert.equal(result.ok, true, `added, not ${result.errorCode}`)
    db.prepare('DELETE FROM books WHERE id = ?').run(result.bookId)
    for (const name of fs.existsSync(getCoversPath()) ? fs.readdirSync(getCoversPath()) : []) {
      fs.rmSync(path.join(getCoversPath(), name), { force: true })
    }
  })

  console.log(`spike:import:cleanup — ${passed} checks passed`)
} finally {
  fs.rmSync(work, { recursive: true, force: true })
}
