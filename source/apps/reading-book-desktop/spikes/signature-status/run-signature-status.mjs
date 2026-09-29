/**
 * Checks for book signature-status detection (verification only — the app never signs anything).
 *
 *   1. supported signed document            -> valid   (RSA, ECDSA, SHA-1 digest, CAdES sub-filter)
 *   2. unsigned document                    -> unsigned (also with a highlight annotation)
 *   3. invalid signature                    -> invalid (tampered content / damaged value / edited after signing / empty)
 *   4. unsupported format or signature type -> unsupported (EPUB, TXT, DOCX…, unknown PDF sub-filter, non-PDF bytes)
 *   5. cache never outlives the file        -> re-verified when the file's SHA-256 changes
 *   6. storage + migration                  -> metadata round-trip, legacy `isSigned` data, full migration chain
 *
 * The PDF fixtures are signed by OpenSSL (see build-fixtures.mjs), not by the code under test.
 *
 * Run: npm run spike:signature:status
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import {
  isSignatureInfoCurrent,
  signatureInfoFromMetadata,
  signatureMetadataPatch,
} from '../../../book-reader-sdk/src/domain/book/book-signature.ts'
import { verifyDetachedCms } from '../../electron/signature/cms.ts'
import { hashFile } from '../../electron/files/file-hash.ts'
import { resolveSignatureInfo } from '../../electron/signature/signature-check.ts'
import { verifySignature } from '../../electron/signature/signature-service.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name))
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

let passed = 0
async function check(name, fn) {
  try {
    await fn()
    passed++
    console.log(`ok   ${name}`)
  } catch (err) {
    console.error(`FAIL ${name}`)
    throw err
  }
}

// --- 1. valid ---------------------------------------------------------------------------------

await check('RSA / SHA-256 PDF signature -> valid, with signer + signing time', () => {
  const r = verifySignature('pdf', fixture('signed-rsa.pdf'))
  assert.equal(r.status, 'valid')
  assert.equal(r.signerName, 'Fixture Signer')
  assert.ok(r.signedAt && !Number.isNaN(Date.parse(r.signedAt)), 'signedAt is an ISO date')
})

await check('ECDSA P-256 PDF signature -> valid', () => {
  const r = verifySignature('pdf', fixture('signed-ecdsa.pdf'))
  assert.equal(r.status, 'valid')
  assert.equal(r.signerName, 'Fixture EC Signer')
})

await check('SHA-1 digest and CAdES sub-filter -> valid', () => {
  assert.equal(verifySignature('pdf', fixture('signed-sha1.pdf')).status, 'valid')
  assert.equal(verifySignature('pdf', fixture('signed-cades.pdf')).status, 'valid')
})

// --- 2. unsigned ------------------------------------------------------------------------------

await check('PDF without a signature dictionary -> unsigned', () => {
  assert.equal(verifySignature('pdf', fixture('unsigned.pdf')).status, 'unsigned')
})

await check('a highlight annotation is NOT a signature -> unsigned', () => {
  const pdf = fixture('unsigned-annotated.pdf')
  assert.ok(pdf.includes('/Subtype /Highlight'), 'fixture really carries an annotation')
  assert.equal(verifySignature('pdf', pdf).status, 'unsigned')
})

await check('the SHA-256 fingerprint is not a signature check', () => {
  // Every file has a fingerprint; only the dictionary + CMS decide whether it is signed.
  assert.notEqual(sha256(fixture('signed-rsa.pdf')), sha256(fixture('unsigned.pdf')))
  assert.equal(verifySignature('pdf', fixture('unsigned.pdf')).status, 'unsigned')
  assert.equal(verifySignature('pdf', fixture('signed-rsa.pdf')).status, 'valid')
})

// --- 3. invalid -------------------------------------------------------------------------------

await check('content changed after signing -> invalid', () => {
  const r = verifySignature('pdf', fixture('tampered-content.pdf'))
  assert.equal(r.status, 'invalid')
  assert.match(r.reason, /digest/)
})

await check('damaged signature value -> invalid', () => {
  assert.equal(verifySignature('pdf', fixture('broken-signature.pdf')).status, 'invalid')
})

await check('bytes appended after the signed range -> invalid', () => {
  const r = verifySignature('pdf', fixture('modified-after-signing.pdf'))
  assert.equal(r.status, 'invalid')
  assert.match(r.reason, /modified after/)
})

await check('signature dictionary with empty /Contents -> invalid', () => {
  assert.equal(verifySignature('pdf', fixture('empty-signature.pdf')).status, 'invalid')
})

await check('garbage CMS never throws -> invalid', () => {
  const content = [Buffer.from('x')]
  assert.equal(verifyDetachedCms(Buffer.from([0x30, 0x03, 0x02, 0x01, 0x00]), content).kind, 'invalid')
  assert.equal(verifyDetachedCms(Buffer.alloc(0), content).kind, 'invalid')
  assert.equal(verifyDetachedCms(Buffer.from([0x30, 0x84, 0xff, 0xff, 0xff, 0xff]), content).kind, 'invalid')
})

// --- 4. unsupported ---------------------------------------------------------------------------

await check('EPUB -> unsupported (never claimed signed or unsigned)', () => {
  const zipMagic = Buffer.from('PK\x03\x04 not really an epub, and it does not matter')
  assert.equal(verifySignature('epub', zipMagic).status, 'unsupported')
})

await check('formats with no verifier (txt, md, docx, doc) -> unsupported', () => {
  for (const format of ['txt', 'md', 'docx', 'doc']) {
    assert.equal(verifySignature(format, Buffer.from('hello')).status, 'unsupported', format)
  }
})

await check('PDF signature type the app cannot evaluate -> unsupported', () => {
  assert.equal(verifySignature('pdf', fixture('signed-unsupported-subfilter.pdf')).status, 'unsupported')
})

await check('bytes that are not a PDF -> unsupported', () => {
  assert.equal(verifySignature('pdf', Buffer.from('definitely not a pdf')).status, 'unsupported')
})

// --- 5. cache vs. file changes ----------------------------------------------------------------

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'sigcheck-'))

await check('a fresh cached result is reused without reading the file', async () => {
  const file = path.join(tmp, 'a.pdf')
  await fsp.writeFile(file, fixture('signed-rsa.pdf'))
  const first = await resolveSignatureInfo({ format: 'pdf', filePath: file })
  assert.equal(first.fromCache, false)
  assert.equal(first.info.status, 'valid')
  assert.equal(first.info.checkedSha256, sha256(fixture('signed-rsa.pdf')))

  let reads = 0
  const second = await resolveSignatureInfo({
    format: 'pdf',
    filePath: file,
    cached: first.info,
    io: {
      hashFile,
      readFile: (p) => {
        reads++
        return fsp.readFile(p)
      },
    },
  })
  assert.equal(second.fromCache, true)
  assert.equal(reads, 0)
  assert.deepEqual(second.info, first.info)
})

await check('cached "valid" is NOT trusted once the file changes', async () => {
  const file = path.join(tmp, 'b.pdf')
  await fsp.writeFile(file, fixture('signed-rsa.pdf'))
  const first = await resolveSignatureInfo({ format: 'pdf', filePath: file })
  assert.equal(first.info.status, 'valid')

  // The user edits the referenced file in place; books.sha256 (import-time) is now stale.
  await fsp.writeFile(file, fixture('tampered-content.pdf'))
  const second = await resolveSignatureInfo({ format: 'pdf', filePath: file, cached: first.info })
  assert.equal(second.fromCache, false)
  assert.equal(second.info.status, 'invalid')
  assert.equal(second.info.checkedSha256, sha256(fixture('tampered-content.pdf')))
  assert.equal(isSignatureInfoCurrent(first.info, second.info.checkedSha256), false)
})

await check('an unsigned file replaced by a signed one is re-verified', async () => {
  const file = path.join(tmp, 'c.pdf')
  await fsp.writeFile(file, fixture('unsigned.pdf'))
  const first = await resolveSignatureInfo({ format: 'pdf', filePath: file })
  assert.equal(first.info.status, 'unsigned')
  await fsp.writeFile(file, fixture('signed-rsa.pdf'))
  const second = await resolveSignatureInfo({ format: 'pdf', filePath: file, cached: first.info })
  assert.equal(second.info.status, 'valid')
  assert.equal(second.info.signerName, 'Fixture Signer')
})

await check('cache with no recorded hash (legacy / hand-edited) is never current', async () => {
  const file = path.join(tmp, 'd.pdf')
  await fsp.writeFile(file, fixture('signed-rsa.pdf'))
  const stale = { status: 'valid', checkedAt: '', checkedSha256: '' }
  const r = await resolveSignatureInfo({ format: 'pdf', filePath: file, cached: stale })
  assert.equal(r.fromCache, false)
})

await check('import path: known hash skips re-hashing; EPUB never reads the file', async () => {
  let hashes = 0
  let reads = 0
  const io = {
    hashFile: async () => {
      hashes++
      return { sha256: 'x', fileSizeBytes: 1 }
    },
    readFile: async () => {
      reads++
      return Buffer.alloc(0)
    },
  }
  const r = await resolveSignatureInfo({
    format: 'epub',
    filePath: '/nope.epub',
    known: { sha256: 'abc', fileSizeBytes: 10 },
    io,
  })
  assert.deepEqual([hashes, reads, r.info.status, r.info.checkedSha256], [0, 0, 'unsupported', 'abc'])
})

await fsp.rm(tmp, { recursive: true, force: true })

// --- 6. metadata contract + migration ---------------------------------------------------------

await check('metadata round-trip; a new result fully replaces the old one (no stale signer)', () => {
  const db = new DatabaseSync(':memory:')
  db.exec("CREATE TABLE t (m TEXT NOT NULL DEFAULT '{}')")
  db.prepare('INSERT INTO t (m) VALUES (?)').run(JSON.stringify({ fileSizeBytes: 5, description: 'd' }))
  const patch = (info) =>
    db.prepare('UPDATE t SET m = json_patch(m, ?)').run(JSON.stringify(signatureMetadataPatch(info)))
  const read = () => JSON.parse(db.prepare('SELECT m FROM t').get().m)

  const valid = {
    status: 'valid',
    signerName: 'Ann',
    signedAt: '2026-03-12T09:30:00.000Z',
    checkedAt: '2026-04-01T00:00:00.000Z',
    checkedSha256: 'aa',
  }
  patch(valid)
  assert.deepEqual(signatureInfoFromMetadata(read()), valid)
  assert.equal(read().fileSizeBytes, 5, 'unrelated metadata survives')
  assert.equal('isSigned' in read(), false, 'no redundant isSigned flag')

  patch({ status: 'unsigned', checkedAt: '2026-05-01T00:00:00.000Z', checkedSha256: 'bb' })
  const after = read()
  assert.equal('signerName' in after, false)
  assert.equal('signedAt' in after, false)
  assert.equal(after.signatureStatus, 'unsigned')
  assert.equal(after.description, 'd')

  patch(undefined)
  assert.equal(signatureInfoFromMetadata(read()), undefined)
})

await check('unknown / legacy status strings read as "not checked"', () => {
  for (const status of ['unknown', 'expired', 'VALID', '', 7, null]) {
    assert.equal(signatureInfoFromMetadata({ signatureStatus: status }), undefined, String(status))
  }
})

await check('migrations 001–020 + 022 apply in order; 022 clears legacy isSigned data and keeps the rest', () => {
  const dir = path.join(__dirname, '../../electron/persistence/migrations')
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  assert.equal(files.at(-1), '022_book_signature_status.sql')

  const db = new DatabaseSync(':memory:')
  // 021 builds an FTS5 index over book_chunks (node:sqlite ships without FTS5) and never touches
  // `books`, so it is skipped here.
  for (const file of files.filter((f) => f < '022' && !f.startsWith('021_'))) {
    db.exec(fs.readFileSync(path.join(dir, file), 'utf8'))
  }

  const insert = db.prepare(
    `INSERT INTO books (id, title, file_path, file_format, sha256, metadata_json, added_at, updated_at)
     VALUES (?, ?, ?, 'pdf', ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  )
  // Exactly what migration 020 left behind for a never-signed book, and for a "signed" demo row.
  insert.run('b1', 'Plain', '/a.pdf', 'h1', '{"fileSizeBytes":10,"pageCount":3,"description":"x","isSigned":false,"signatureStatus":"unknown"}')
  insert.run('b2', 'Demo', '/b.pdf', 'h2', '{"fileSizeBytes":20,"isSigned":true,"signerName":"Nguyen Van A","signatureStatus":"valid","signedAt":"2026-03-12T09:30:00.000Z"}')
  // A row already carrying a real verification result must be left alone.
  insert.run('b3', 'Verified', '/c.pdf', 'h3', '{"signatureStatus":"valid","signerName":"Ann","signatureCheckedAt":"2026-05-01T00:00:00.000Z","signatureCheckedSha256":"h3"}')

  const migration022 = fs.readFileSync(path.join(dir, '022_book_signature_status.sql'), 'utf8')
  db.exec(migration022)

  const meta = (id) => JSON.parse(db.prepare('SELECT metadata_json m FROM books WHERE id = ?').get(id).m)
  assert.deepEqual(meta('b1'), { fileSizeBytes: 10, pageCount: 3, description: 'x' })
  assert.deepEqual(meta('b2'), { fileSizeBytes: 20 })
  assert.equal(meta('b3').signerName, 'Ann')
  assert.equal(db.prepare("SELECT updated_at u FROM books WHERE id = 'b1'").get().u, '2026-01-01T00:00:00Z')

  // Idempotent: running it again changes nothing.
  db.exec(migration022)
  assert.deepEqual(meta('b1'), { fileSizeBytes: 10, pageCount: 3, description: 'x' })
  assert.equal(meta('b3').signatureStatus, 'valid')
})

console.log(`\n${passed} checks passed`)
