/**
 * Markdown reader, Main side (docs/implementation_plan/markdown_reader.md): the real
 * `openBookContent` (size limit, errors, BOM bytes, referenced book on the migrated schema via the
 * node:sqlite stand-in) and the real relative-image resolver, on files in a temp folder. No Electron
 * window, no user data: every path is under os.tmpdir().
 *
 * Run: npm run spike:md:main   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MD_MAX_FILE_BYTES, MD_MAX_IMAGE_BYTES } from '@reading-book/book-reader-sdk'
import { getDatabase } from '../pdf-annotations/db-stub.mjs'

const { openBookContent } = await import('../../electron/files/open-book-content.ts')
const { resolveMdAssetFile } = await import('../../electron/md/md-asset-files.ts')
const { parseMdAssetRequest } = await import('../../electron/md/md-asset-files.ts')

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const sha = (data) => createHash('sha256').update(data).digest('hex')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readmate-md-'))
const docs = path.join(tmp, 'docs')
const outside = path.join(tmp, 'outside')
fs.mkdirSync(path.join(docs, 'img'), { recursive: true })
fs.mkdirSync(outside)

const db = getDatabase()
db.exec('PRAGMA foreign_keys = ON')
const insertBook = db.prepare(
  `INSERT INTO books (id, title, file_path, file_format, sha256, reading_status, reading_state_json, added_at, updated_at)
   VALUES (?, ?, ?, ?, ?, 'reading', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
)
function addBook(id, format, file, bytes) {
  insertBook.run(id, `Book ${id}`, file, format, sha(id))
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
)

console.log('1. openBookContent')
await check('returns the exact bytes of a small .md (BOM, Vietnamese, emoji kept untouched)', async () => {
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# Chào 🌳\r\n\r\nNội dung\r\n', 'utf8')])
  const file = path.join(docs, 'a.md')
  fs.writeFileSync(file, bytes)
  addBook('bk-a', 'md', file, bytes)
  const result = await openBookContent('bk-a')
  assert.equal(result.ok, true)
  assert.equal(result.format, 'md')
  assert.deepEqual(Buffer.from(result.data), bytes)
})

await check('an empty .md opens (the reader shows the empty state)', async () => {
  const file = path.join(docs, 'empty.md')
  fs.writeFileSync(file, '')
  addBook('bk-empty', 'md', file, Buffer.alloc(0))
  const result = await openBookContent('bk-empty')
  assert.equal(result.ok, true)
  assert.equal(result.byteLength, 0)
})

await check('exactly 5 MB opens; one byte more is refused with too_large and no data', async () => {
  const atLimit = path.join(docs, 'limit.md')
  fs.writeFileSync(atLimit, Buffer.alloc(MD_MAX_FILE_BYTES, 0x61))
  addBook('bk-limit', 'md', atLimit, Buffer.alloc(1))
  const ok = await openBookContent('bk-limit')
  assert.equal(ok.ok, true)
  assert.equal(ok.byteLength, MD_MAX_FILE_BYTES)

  const big = path.join(docs, 'big.md')
  fs.writeFileSync(big, Buffer.alloc(MD_MAX_FILE_BYTES + 1, 0x61))
  addBook('bk-big', 'md', big, Buffer.alloc(1))
  const refused = await openBookContent('bk-big')
  assert.equal(refused.ok, false)
  assert.equal(refused.errorCode, 'too_large')
  assert.equal(refused.data, undefined)
  assert.match(refused.errorMessage, /5 MB/)
})

await check('a deleted file reports missing_file; an unknown id reports not_found', async () => {
  const file = path.join(docs, 'gone.md')
  fs.writeFileSync(file, '# x')
  addBook('bk-gone', 'md', file, Buffer.from('# x'))
  fs.rmSync(file)
  const missing = await openBookContent('bk-gone')
  assert.equal(missing.ok, false)
  assert.equal(missing.errorCode, 'missing_file')
  assert.equal((await openBookContent('nope')).errorCode, 'not_found')
})

await check('other formats are unchanged (a large non-md file is not size-limited here)', async () => {
  const file = path.join(docs, 'x.pdf')
  const bytes = Buffer.alloc(MD_MAX_FILE_BYTES + 10, 0x20)
  fs.writeFileSync(file, bytes)
  addBook('bk-pdf', 'pdf', file, bytes)
  const result = await openBookContent('bk-pdf')
  assert.equal(result.ok, true)
  assert.equal(result.format, 'pdf')
})

await check('the .md file is never modified (bytes and mtime identical)', async () => {
  const file = path.join(docs, 'a.md')
  const before = fs.statSync(file)
  await openBookContent('bk-a')
  const after = fs.statSync(file)
  assert.equal(after.mtimeMs, before.mtimeMs)
  assert.equal(after.size, before.size)
})

console.log('2. relative images')
const md = path.join(docs, 'a.md')
fs.writeFileSync(path.join(docs, 'pic.png'), PNG)
fs.writeFileSync(path.join(docs, 'img', 'nested.PNG'), PNG)
fs.writeFileSync(path.join(docs, 'ảnh 🙂.png'), PNG)
fs.writeFileSync(path.join(docs, 'notes.txt'), 'secret')
fs.writeFileSync(path.join(docs, 'vector.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
fs.writeFileSync(path.join(outside, 'secret.png'), PNG)

await check('serves images next to the document, in subfolders, with Unicode names', async () => {
  for (const [src, mime] of [
    ['pic.png', 'image/png'],
    ['./img/nested.PNG', 'image/png'],
    ['ảnh 🙂.png', 'image/png'],
    ['ảnh%20%F0%9F%99%82.png', 'image/png'],
    ['vector.svg', 'image/svg+xml'],
  ]) {
    const r = await resolveMdAssetFile(md, src)
    assert.equal(r.ok, true, src)
    assert.equal(r.mime, mime, src)
    assert.equal(path.dirname(r.path).startsWith(fs.realpathSync(docs)), true)
  }
})

await check('refuses traversal, absolute, drive, UNC, remote, file:, data:, ADS and non-image files', async () => {
  const abs = path.join(outside, 'secret.png')
  for (const src of [
    '../outside/secret.png',
    'img/../../outside/secret.png',
    '..%2Foutside%2Fsecret.png',
    '%2e%2e/outside/secret.png',
    '..\\outside\\secret.png',
    abs,
    abs.replace(/\\/g, '/'),
    '/etc/passwd',
    'C:\\Windows\\win.ini',
    '\\\\server\\share\\a.png',
    '//server/share/a.png',
    'http://example.com/a.png',
    'https://example.com/a.png',
    `file:///${abs.replace(/\\/g, '/')}`,
    'data:image/png;base64,AAAA',
    'pic.png:stream',
    'notes.txt',
    'a.md',
    '',
  ]) {
    const r = await resolveMdAssetFile(md, src)
    assert.equal(r.ok, false, `must refuse: ${src}`)
  }
})

await check('a missing image is not_found, a directory named like an image is not served', async () => {
  assert.deepEqual(await resolveMdAssetFile(md, 'missing.png'), { ok: false, reason: 'not_found' })
  fs.mkdirSync(path.join(docs, 'folder.png'))
  const r = await resolveMdAssetFile(md, 'folder.png')
  assert.equal(r.ok, false)
})

await check('a link inside the folder that leads outside is refused (real path checked)', async () => {
  const link = path.join(docs, 'linked')
  try {
    fs.symlinkSync(outside, link, 'junction')
  } catch (err) {
    console.log(`    (skipped: cannot create a directory link here: ${err.code})`)
    return
  }
  const r = await resolveMdAssetFile(md, 'linked/secret.png')
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'blocked')
  let fileLinkMade = true
  try {
    fs.symlinkSync(path.join(outside, 'secret.png'), path.join(docs, 'sneaky.png'), 'file')
  } catch {
    fileLinkMade = false
  }
  if (fileLinkMade) assert.equal((await resolveMdAssetFile(md, 'sneaky.png')).ok, false)
})

await check('an image above the size limit is refused', async () => {
  const big = path.join(docs, 'huge.png')
  const fd = fs.openSync(big, 'w')
  fs.ftruncateSync(fd, MD_MAX_IMAGE_BYTES + 1)
  fs.closeSync(fd)
  assert.deepEqual(await resolveMdAssetFile(md, 'huge.png'), { ok: false, reason: 'too_large' })
})

await check('the protocol URL is parsed to a book id + relative path, or refused', async () => {
  assert.deepEqual(parseMdAssetRequest('rb-md-asset://local/bk-a/img/a%20b.png'), { bookId: 'bk-a', src: 'img/a b.png' })
  assert.deepEqual(parseMdAssetRequest('rb-md-asset://local/bk-a/..%2Fx.png'), { bookId: 'bk-a', src: '../x.png' })
  assert.equal(parseMdAssetRequest('rb-md-asset://evil/bk-a/a.png'), null)
  assert.equal(parseMdAssetRequest('rb-md-asset://local/bk-a'), null)
  assert.equal(parseMdAssetRequest('rb-md-asset://local/'), null)
  assert.equal(parseMdAssetRequest('not a url'), null)
})

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\nMarkdown Main checks: ${passed} passed`)
