/**
 * Spec 017 (US3, T036 / T039): the REAL Main read of a book for the Reader (`files/read-book-bytes.ts`, the body of
 * `library:openBookContent` after the path check) on temp files — automated, Node only.
 *
 *   npm run spike:open:content
 *
 * Checks (FR-015, FR-016, FR-021):
 *   1. EPUB / MD: no fingerprint is kept (no whole-file SHA-256 to open a book);
 *   2. PDF: the fingerprint the live sync compares with (`servedBookSha256`) is the SHA-256 of the bytes served;
 *      opening the same book as another format later forgets it;
 *   3. the returned ArrayBuffer is the read buffer's own (no copy) when it is not a pooled slice, one copy otherwise;
 *   4. a missing file answers without reading it; a size change during the read ⇒ `file_changed`, retryable; an mtime
 *      change alone ⇒ opens; a Markdown file over the limit is refused before it is read;
 *   5. EBUSY ⇒ retryable `read_failed`; a cloud placeholder error ⇒ `not_available_offline`, not retryable;
 *   6. the renderer's `toArrayBuffer` keeps the ArrayBuffer it receives (no second copy) and copies only a partial view.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { readBookBytes, servedBookSha256, ownArrayBuffer } = await import('../../files/read-book-bytes.ts')
const { toArrayBuffer } = await import('../../../../components/reader/renderers/epub/epubjs/host-layout.ts')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-open-content-'))
const write = (name, bytes) => {
  const p = path.join(dir, name)
  fs.writeFileSync(p, bytes)
  return p
}
const big = Buffer.alloc(256 * 1024, 7)

const results = []
const check = async (name, fn) => {
  try {
    await fn()
    results.push(['PASS', name])
  } catch (error) {
    results.push(['FAIL', name, error?.message ?? String(error)])
  }
}

await check('1. EPUB / MD keep no fingerprint', async () => {
  const epub = await readBookBytes({ bookId: 'e1', path: write('a.epub', big), format: 'epub' })
  assert.equal(epub.ok, true)
  assert.equal(servedBookSha256('e1'), undefined)
  const md = await readBookBytes({ bookId: 'm1', path: write('a.md', Buffer.from('# Title\n')), format: 'md' })
  assert.equal(md.ok, true)
  assert.equal(servedBookSha256('m1'), undefined)
})

await check('2. PDF keeps the SHA-256 of the served bytes; another format forgets it', async () => {
  const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), big])
  const p = write('a.pdf', bytes)
  const pdf = await readBookBytes({ bookId: 'p1', path: p, format: 'pdf' })
  assert.equal(pdf.ok, true)
  assert.equal(servedBookSha256('p1'), createHash('sha256').update(bytes).digest('hex'))
  await readBookBytes({ bookId: 'p1', path: write('b.epub', big), format: 'epub' })
  assert.equal(servedBookSha256('p1'), undefined)
})

await check('3. the read buffer is sent as is (one copy only for a pooled slice)', async () => {
  let readBuf = null
  const p = write('c.epub', big)
  const r = await readBookBytes({
    bookId: 'e2',
    path: p,
    format: 'epub',
    readFile: async (file) => (readBuf = fs.readFileSync(file)),
  })
  assert.equal(r.ok, true)
  assert.equal(r.data, readBuf.buffer, 'same ArrayBuffer as the read Buffer')
  const pooled = Buffer.from('tiny') // a slice of Node's shared pool
  assert.notEqual(pooled.byteLength, pooled.buffer.byteLength)
  const copy = ownArrayBuffer(pooled)
  assert.notEqual(copy, pooled.buffer)
  assert.equal(copy.byteLength, 4)
})

await check('4. missing / changed / touched / too large', async () => {
  let reads = 0
  const counting = async (file) => {
    reads++
    return fs.readFileSync(file)
  }
  const missing = await readBookBytes({ bookId: 'x', path: path.join(dir, 'nope.epub'), format: 'epub', readFile: counting })
  assert.equal(missing.ok, false)
  assert.equal(reads, 0, 'a missing file is never read')

  const p = write('d.epub', big)
  const grown = await readBookBytes({
    bookId: 'e3',
    path: p,
    format: 'epub',
    readFile: async (file) => Buffer.concat([fs.readFileSync(file), Buffer.from('more')]),
  })
  assert.deepEqual(grown, { ok: false, code: 'file_changed', retryable: true })

  const later = new Date(Date.now() + 60_000)
  fs.utimesSync(p, later, later)
  const touched = await readBookBytes({ bookId: 'e3', path: p, format: 'epub' })
  assert.equal(touched.ok, true, 'an mtime change alone opens')

  reads = 0
  const huge = await readBookBytes({
    bookId: 'm2',
    path: write('big.md', big),
    format: 'md',
    sizeAllowed: (n) => n <= 1024,
    readFile: counting,
  })
  assert.deepEqual(huge, { ok: false, code: 'too_large', retryable: false })
  assert.equal(reads, 0, 'refused before it is read')
})

await check('5. EBUSY retryable; cloud placeholder ⇒ not_available_offline', async () => {
  const p = write('e.epub', big)
  const busy = await readBookBytes({
    bookId: 'e4',
    path: p,
    format: 'epub',
    readFile: async () => {
      throw Object.assign(new Error('busy'), { code: 'EBUSY' })
    },
  })
  assert.deepEqual(busy, { ok: false, code: 'read_failed', retryable: true })
  const cloud = await readBookBytes({
    bookId: 'e4',
    path: p,
    format: 'epub',
    readFile: async () => {
      throw Object.assign(new Error('The cloud file provider is not running.'), { code: 'UNKNOWN', errno: -4094 })
    },
  })
  assert.deepEqual(cloud, { ok: false, code: 'not_available_offline', retryable: false })
})

await check('6. the renderer keeps the ArrayBuffer it receives', async () => {
  const ab = new ArrayBuffer(64)
  assert.equal(toArrayBuffer(ab), ab, 'no second copy')
  const whole = new Uint8Array(ab)
  assert.equal(toArrayBuffer(whole), ab, 'a view of the whole buffer gives that buffer')
  const part = new Uint8Array(ab, 8, 16)
  const copied = toArrayBuffer(part)
  assert.notEqual(copied, ab)
  assert.equal(copied.byteLength, 16)
})

fs.rmSync(dir, { recursive: true, force: true })
for (const r of results) console.log(r.join(' — '))
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(failed ? `spike:open:content — ${failed} FAILED` : `spike:open:content — all ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
