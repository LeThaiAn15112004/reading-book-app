/**
 * Audiobook ZIP import — Main side, headless (no Electron window, nothing outside os.tmpdir()).
 * Uses the real code: the bounded ZIP reader, `ZipImportService` (inspect / cover preview / confirm) and the real
 * audio probe (`probeAudioFile`, music-metadata). ZIPs are generated here by a tiny writer, so malicious
 * shapes (traversal names, forged sizes, symlink modes) can be produced exactly.
 *
 *   1. inspect   multi-track, mixed files, nested dirs, duplicate basenames, natural order, no audio,
 *                only-unsupported, empty, corrupt, no cover, several covers, damaged audio, big audio (prefix probe)
 *   2. security  traversal, absolute, drive letter, backslash, duplicate normalised path, entry count, declared sizes,
 *                forged sizes while reading (zip bomb), path depth, symlink, encrypted
 *   3. confirm   re-validation, changed archive, expired session, boundary hand-off, default stage refuses
 *   4. cleanup   scratch folder empty after success / failure / cancellation; the ZIP is never modified
 *
 * Run: npm run spike:audio:zip   (builds the SDK bundle first)
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const { ZipImportService, sniffImageMime } = await import('../../electron/zip-import/zip-import-service.ts')
const { readZipDirectory, ZipFormatError, extractEntryToFile } = await import('../../electron/zip-import/zip-reader.ts')
const { probeAudioFile } = await import('../../electron/adapters/audio.adapter.ts')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-zip-import-'))
const scratch = path.join(tmp, 'scratch')
let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// ---- synthetic media ----
const FRAME = Buffer.alloc(417)
FRAME[0] = 0xff; FRAME[1] = 0xfb; FRAME[2] = 0x90
const mp3 = (frames = 40) => Buffer.concat(Array(frames).fill(FRAME))
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==', 'base64')
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9])
const aiff = Buffer.concat([Buffer.from('FORM'), Buffer.alloc(8), Buffer.from('AIFF')])

// ---- tiny ZIP writer ----
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (b) => {
  let c = 0xffffffff
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
/** entry: { name, data?, deflate?, mode?, declaredSize?, flags? } — name is used verbatim. */
function buildZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const e of entries) {
    const data = e.data ?? Buffer.alloc(0)
    const body = e.deflate ? zlib.deflateRawSync(data) : data
    const name = Buffer.from(e.name, 'utf8')
    const flags = 0x800 | (e.flags ?? 0)
    const usize = e.declaredSize ?? data.length
    const method = e.deflate ? 8 : 0
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(method, 8)
    lh.writeUInt32LE(crc32(data), 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(usize, 22); lh.writeUInt16LE(name.length, 26)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(((e.mode ? 3 : 0) << 8) | 20, 4); ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(flags, 8); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc32(data), 16); ch.writeUInt32LE(body.length, 20)
    ch.writeUInt32LE(usize, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(((e.mode ?? 0) << 16) >>> 0, 38); ch.writeUInt32LE(offset, 42)
    locals.push(lh, name, body)
    centrals.push(ch, name)
    offset += 30 + name.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}
let n = 0
const zipFile = (entries, raw) => {
  const file = path.join(tmp, `t${(n += 1)}.zip`)
  fs.writeFileSync(file, raw ?? buildZip(entries))
  return file
}

const probe = async (file, format) => {
  const parsed = await probeAudioFile(file, format)
  return { durationSeconds: parsed.format.duration }
}
const service = (options = {}) => new ZipImportService({ tmpRoot: scratch, probe, ...options })
const inspect = async (entries, raw) => {
  const file = zipFile(entries, raw)
  const svc = service()
  return { file, svc, result: await svc.inspect(file) }
}
const scratchLeftovers = () => (fs.existsSync(scratch) ? fs.readdirSync(scratch) : [])
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.preview }
const names = (p, ids) => ids.map((id) => p.entries.find((e) => e.id === id).path)

try {
  console.log('1. inspect')
  await check('multiple tracks, preselected, natural order (1, 2, 10) regardless of ZIP order', async () => {
    const { result } = await inspect([
      { name: '10 - Ten.mp3', data: mp3() },
      { name: '2 - Two.mp3', data: mp3() },
      { name: '1 - One.mp3', data: mp3() },
    ])
    const p = ok(result)
    assert.deepEqual(names(p, p.trackOrder), ['1 - One.mp3', '2 - Two.mp3', '10 - Ten.mp3'])
    assert.ok(p.entries.filter((e) => e.kind === 'audio').every((e) => e.eligible && e.status === 'ok'))
    assert.deepEqual(p.warnings.map((w) => w.code), ['no_cover'])
    assert.equal(p.archiveName.endsWith('.zip'), true)
  })
  await check('mixed archive: audio + images + README + metadata + documents + junk + nested zip', async () => {
    const { result } = await inspect([
      { name: 'Book/', data: Buffer.alloc(0) },
      { name: 'Book/01.mp3', data: mp3(), deflate: true },
      { name: 'Book/02.mp3', data: mp3() },
      { name: 'Book/cover.jpg', data: JPG },
      { name: 'README.txt', data: Buffer.from('hi') },
      { name: 'meta.json', data: Buffer.from('{}') },
      { name: 'book.pdf', data: Buffer.from('%PDF') },
      { name: 'book.epub', data: Buffer.from('x') },
      { name: 'notes.docx', data: Buffer.from('x') },
      { name: 'inner.zip', data: Buffer.from('PK') },
      { name: '__MACOSX/Book/._01.mp3', data: Buffer.from('x') },
      { name: '.DS_Store', data: Buffer.from('x') },
    ])
    const p = ok(result)
    const kind = (name) => p.entries.find((e) => e.path === name)
    assert.equal(p.trackOrder.length, 2)
    assert.equal(kind('Book').kind, 'folder')
    assert.equal(kind('README.txt').kind, 'metadata')
    assert.equal(kind('meta.json').kind, 'metadata')
    assert.equal(kind('book.pdf').kind, 'document')
    assert.equal(kind('inner.zip').kind, 'archive')
    assert.equal(kind('__MACOSX/Book/._01.mp3').kind, 'junk')
    assert.equal(kind('.DS_Store').kind, 'junk')
    assert.ok(p.entries.filter((e) => e.kind !== 'audio').every((e) => !e.eligible))
    assert.equal(names(p, [p.defaultCoverId])[0], 'Book/cover.jpg')
  })
  await check('duplicate basenames in different folders are distinct entries with distinct paths', async () => {
    const { result } = await inspect([
      { name: 'CD1/01.mp3', data: mp3() },
      { name: 'CD2/01.mp3', data: mp3() },
    ])
    const p = ok(result)
    assert.deepEqual(names(p, p.trackOrder), ['CD1/01.mp3', 'CD2/01.mp3'])
    assert.equal(new Set(p.entries.map((e) => e.id)).size, 2)
  })
  await check('durations are reported when the header knows them (never invented)', async () => {
    const { result } = await inspect([{ name: 'a.wav', data: wav() }, { name: 'b.mp3', data: mp3() }])
    const p = ok(result)
    const a = p.entries.find((e) => e.path === 'a.wav')
    assert.ok(a.durationSeconds > 0.9 && a.durationSeconds < 1.1, String(a.durationSeconds))
  })
  await check('unnumbered names produce an ordering warning', async () => {
    const { result } = await inspect([{ name: 'intro.mp3', data: mp3() }, { name: 'outro.mp3', data: mp3() }])
    assert.equal(ok(result).warnings[0].code, 'no_numbering')
  })
  await check('no audio at all → preview with no tracks (UI explains), not an error', async () => {
    const { result } = await inspect([{ name: 'cover.png', data: PNG1 }, { name: 'README.txt', data: Buffer.from('x') }])
    const p = ok(result)
    assert.deepEqual(p.trackOrder, [])
  })
  await check('only unsupported audio (aiff, renamed text, damaged mp3, empty, encrypted) → every one flagged with a reason', async () => {
    const { result } = await inspect([
      { name: 'a.aiff', data: aiff },
      { name: 'fake.mp3', data: Buffer.from('this is not audio at all') },
      { name: 'empty.mp3', data: Buffer.alloc(0) },
      { name: 'locked.mp3', data: mp3(), flags: 1 },
    ])
    const p = ok(result)
    assert.deepEqual(p.trackOrder, [])
    for (const e of p.entries) {
      assert.equal(e.status, 'unsupported', e.path)
      assert.equal(e.eligible, false)
      assert.ok(e.reason, e.path)
    }
  })
  await check('good and bad audio side by side: only the good one is eligible', async () => {
    const { result } = await inspect([{ name: '1.mp3', data: mp3() }, { name: '2.mp3', data: Buffer.from('nope') }])
    const p = ok(result)
    assert.deepEqual(names(p, p.trackOrder), ['1.mp3'])
  })
  await check('audio larger than the probe prefix (deflated) is still validated', async () => {
    const { result } = await inspect([{ name: 'big.mp3', data: mp3(11000), deflate: true }])
    assert.equal(ok(result).trackOrder.length, 1)
  })
  await check('empty ZIP and corrupt / non-ZIP files are rejected with a code', async () => {
    const empty = await inspect([])
    assert.deepEqual([empty.result.ok, empty.result.errorCode], [false, 'empty_zip'])
    for (const raw of [Buffer.from('not a zip at all, just text padding.'), Buffer.alloc(0), mp3().subarray(0, 100)]) {
      const r = (await inspect(undefined, raw)).result
      assert.deepEqual([r.ok, r.errorCode], [false, 'invalid_zip'])
    }
    const zip = buildZip([{ name: 'a.mp3', data: mp3() }])
    const cut = (await inspect(undefined, zip.subarray(0, zip.length - 30))).result
    assert.equal(cut.ok, false)
    const missing = await service().inspect(path.join(tmp, 'nope.zip'))
    assert.equal(missing.errorCode, 'unreadable')
  })
  await check('no cover → none selected + warning; several covers → ranked, conventional name wins', async () => {
    const none = ok((await inspect([{ name: '1.mp3', data: mp3() }])).result)
    assert.equal(none.defaultCoverId, null)
    assert.equal(none.warnings.at(-1).code, 'no_cover')
    const many = ok((await inspect([
      { name: '1.mp3', data: mp3() },
      { name: 'art/zzz.png', data: PNG1 },
      { name: 'folder.jpg', data: JPG },
      { name: 'sub/cover.png', data: PNG1 },
      { name: 'fake.jpg', data: Buffer.from('not an image') },
      { name: 'vector.svg', data: Buffer.from('<svg/>') },
    ])).result)
    assert.deepEqual(names(many, many.coverCandidates), ['folder.jpg', 'sub/cover.png', 'art/zzz.png'])
    assert.equal(many.entries.find((e) => e.path === 'fake.jpg').reason, 'Not a valid image')
    assert.ok(!many.coverCandidates.includes(many.entries.find((e) => e.path === '1.mp3').id))
  })
  await check('cover preview: data URL for a candidate only; audio / unknown ids refused', async () => {
    const { svc, result } = await inspect([{ name: '1.mp3', data: mp3() }, { name: 'cover.png', data: PNG1 }])
    const p = ok(result)
    const r = await svc.coverPreview(p.sessionId, p.defaultCoverId)
    assert.equal(r.ok, true)
    assert.ok(r.dataUrl.startsWith('data:image/png;base64,'))
    assert.equal((await svc.coverPreview(p.sessionId, p.trackOrder[0])).ok, false)
    assert.equal((await svc.coverPreview('nope', p.defaultCoverId)).errorCode, 'session_expired')
    assert.equal(sniffImageMime(Buffer.from('<svg/>')), null)
  })

  console.log('2. security')
  const reject = async (label, entries, code) => {
    const { result } = await inspect(entries)
    assert.deepEqual([label, result.ok, result.errorCode], [label, false, code])
  }
  await check('path traversal / absolute / drive-letter / backslash / UNC / control chars → archive rejected', async () => {
    for (const name of ['../evil.mp3', 'a/../../evil.mp3', '/etc/evil.mp3', 'C:/evil.mp3', 'c:evil.mp3', 'a\\b.mp3', '\\\\srv\\share\\x.mp3', 'a//b.mp3', 'a/\u0001.mp3']) {
      await reject(name, [{ name: '1.mp3', data: mp3() }, { name, data: mp3() }], 'unsafe_path')
    }
  })
  await check('duplicate normalised paths (exact, case, ./ prefix) → rejected', async () => {
    await reject('exact', [{ name: 'a.mp3', data: mp3() }, { name: 'a.mp3', data: mp3() }], 'duplicate_path')
    await reject('case', [{ name: 'a.mp3', data: mp3() }, { name: 'A.MP3', data: mp3() }], 'duplicate_path')
    await reject('dot', [{ name: 'a.mp3', data: mp3() }, { name: './a.mp3', data: mp3() }], 'duplicate_path')
  })
  await check('too many entries → rejected before the directory is parsed', async () => {
    await reject('count', Array.from({ length: 5001 }, (_, i) => ({ name: `f${i}.txt` })), 'too_many_entries')
    assert.equal(ok((await inspect(Array.from({ length: 5000 }, (_, i) => ({ name: `f${i}.txt` })))).result).trackOrder.length, 0)
  })
  await check('declared sizes: one entry over 2 GiB, and a total over 8 GiB → rejected', async () => {
    await reject('single', [{ name: 'a.mp3', data: mp3(), declaredSize: 2 * 1024 ** 3 + 1 }], 'too_large')
    await reject('total', Array.from({ length: 6 }, (_, i) => ({ name: `a${i}.mp3`, data: mp3(), declaredSize: 1536 * 1024 ** 2 })), 'too_large')
  })
  await check('path depth over the limit → rejected', async () => {
    await reject('depth', [{ name: `${Array.from({ length: 13 }, () => 'd').join('/')}/a.mp3`, data: mp3() }], 'path_too_deep')
    assert.equal(ok((await inspect([{ name: `${Array.from({ length: 11 }, () => 'd').join('/')}/a.mp3`, data: mp3() }])).result).trackOrder.length, 1)
  })
  await check('forged sizes are caught while reading, not trusted: zip-bomb entry stops early', async () => {
    const bomb = Buffer.alloc(64 * 1024 ** 2) // inflates far past the 10 bytes it claims
    const zip = zipFile([{ name: 'bomb.mp3', data: bomb, deflate: true, declaredSize: 10 }])
    const dir = await readZipDirectory(zip)
    const out = path.join(tmp, 'bomb.out')
    await assert.rejects(extractEntryToFile(zip, dir.fileSize, dir.entries[0], out), (e) => e instanceof ZipFormatError && e.code === 'size_mismatch')
    assert.ok(!fs.existsSync(out) || fs.statSync(out).size <= 1024 ** 2, 'wrote at most one chunk-ish before stopping')
    const stored = zipFile([{ name: 'stored.mp3', data: Buffer.from('abc'), declaredSize: 50 }])
    const d1 = await readZipDirectory(stored)
    await assert.rejects(extractEntryToFile(stored, d1.fileSize, d1.entries[0], path.join(tmp, 'stored.out')), (e) => e.code === 'invalid_zip')
    const understated = zipFile([{ name: 'short.mp3', data: Buffer.from('abc'), deflate: true, declaredSize: 50 }])
    const d2 = await readZipDirectory(understated)
    await assert.rejects(extractEntryToFile(understated, d2.fileSize, d2.entries[0], path.join(tmp, 'short.out')), (e) => e.code === 'size_mismatch')
    // And through the service: the lying entry is just an unplayable track, the archive still opens.
    const p = ok((await service().inspect(zip)))
    assert.equal(p.entries[0].eligible, false)
  })
  await check('symlink entries are never extracted or offered; encrypted entries are unsupported', async () => {
    const p = ok((await inspect([
      { name: '1.mp3', data: mp3() },
      { name: 'link.mp3', data: Buffer.from('/etc/passwd'), mode: 0o120777 },
    ])).result)
    assert.deepEqual(names(p, p.trackOrder), ['1.mp3'])
    const link = p.entries.find((e) => e.path === 'link.mp3')
    assert.deepEqual([link.eligible, link.status], [false, 'ignored'])
    const zip = zipFile([{ name: 'link.mp3', data: Buffer.from('x'), mode: 0o120777 }])
    const dir = await readZipDirectory(zip)
    await assert.rejects(extractEntryToFile(zip, dir.fileSize, dir.entries[0], path.join(tmp, 'link.out')), (e) => e.code === 'unsupported_entry')
  })

  console.log('3. confirm')
  await check('valid selection reaches the import stage in playback order; archive path stays in Main', async () => {
    let seen
    const file = zipFile([{ name: '2.mp3', data: mp3() }, { name: '1.mp3', data: mp3() }, { name: 'cover.png', data: PNG1 }])
    const svc = service({ importer: async (req) => { seen = req; return { ok: true, bookId: 'book-1' } } })
    const p = ok(await svc.inspect(file))
    const r = await svc.confirm(p.sessionId, { trackIds: [...p.trackOrder].reverse(), coverId: p.defaultCoverId })
    assert.deepEqual(r, { ok: true, bookId: 'book-1' })
    assert.deepEqual(seen.chapters.map((c) => c.path), ['1.mp3', '2.mp3'])
    assert.equal(seen.cover.path, 'cover.png')
    assert.equal(seen.archivePath, file)
    assert.equal(svc.sessionCount, 0)
    const only = service({ importer: async (req) => { seen = req; return { ok: true, bookId: 'b' } } })
    const p2 = ok(await only.inspect(file))
    await only.confirm(p2.sessionId, { trackIds: [p2.trackOrder[1]], coverId: null })
    assert.deepEqual(seen.chapters.map((c) => c.path), ['2.mp3'])
    assert.equal(seen.cover, null)
  })
  await check('the default stage refuses honestly (no multi-track storage yet) and keeps the preview', async () => {
    const { svc, result } = await inspect([{ name: '1.mp3', data: mp3() }])
    const p = ok(result)
    const r = await svc.confirm(p.sessionId, { trackIds: p.trackOrder, coverId: null })
    assert.deepEqual([r.ok, r.errorCode], [false, 'import_not_available'])
    assert.equal(svc.sessionCount, 1)
  })
  await check('invalid selections are refused by Main even if the renderer sends them', async () => {
    const { svc, result } = await inspect([{ name: '1.mp3', data: mp3() }, { name: 'x.aiff', data: aiff }, { name: 'cover.png', data: PNG1 }, { name: 'README.txt', data: Buffer.from('x') }])
    const p = ok(result)
    const id = (path_) => p.entries.find((e) => e.path === path_).id
    for (const sel of [
      { trackIds: [], coverId: null },
      { trackIds: [id('x.aiff')], coverId: null },
      { trackIds: [id('README.txt')], coverId: null },
      { trackIds: [p.trackOrder[0], p.trackOrder[0]], coverId: null },
      { trackIds: p.trackOrder, coverId: id('1.mp3') },
      { trackIds: p.trackOrder, coverId: '../../x' },
      null,
    ]) {
      const r = await svc.confirm(p.sessionId, sel)
      assert.deepEqual([r.ok, r.errorCode], [false, 'invalid_selection'], JSON.stringify(sel))
    }
    assert.equal((await svc.confirm('missing', { trackIds: p.trackOrder, coverId: null })).errorCode, 'session_expired')
  })
  await check('a ZIP changed after the preview is refused; sessions expire', async () => {
    let t = 1_000
    const file = zipFile([{ name: '1.mp3', data: mp3() }])
    const svc = service({ now: () => t })
    const p = ok(await svc.inspect(file))
    fs.appendFileSync(file, 'tamper')
    assert.equal((await svc.confirm(p.sessionId, { trackIds: p.trackOrder, coverId: null })).errorCode, 'archive_changed')
    fs.writeFileSync(file, buildZip([{ name: '1.mp3', data: mp3() }]))
    const p2 = ok(await svc.inspect(file))
    t += 31 * 60 * 1000
    assert.equal((await svc.confirm(p2.sessionId, { trackIds: p2.trackOrder, coverId: null })).errorCode, 'session_expired')
  })
  await check('discard drops the session', async () => {
    const { svc, result } = await inspect([{ name: '1.mp3', data: mp3() }])
    const p = ok(result)
    assert.equal(svc.discard(p.sessionId), true)
    assert.equal(svc.sessionCount, 0)
    assert.equal(svc.discard(p.sessionId), false)
  })

  console.log('4. cleanup')
  await check('scratch folder is empty after success, rejection and failure; cancellation leaves no session', async () => {
    assert.deepEqual(scratchLeftovers(), [])
    const file = zipFile([{ name: '1.mp3', data: mp3(11000), deflate: true }, { name: '2.mp3', data: mp3() }])
    const before = fs.readFileSync(file)
    const svc = service()
    const controller = new AbortController()
    controller.abort()
    const r = await svc.inspect(file, controller.signal)
    assert.deepEqual([r.ok, r.errorCode], [false, 'cancelled'])
    assert.equal(svc.sessionCount, 0)
    assert.deepEqual(scratchLeftovers(), [])
    const failing = new ZipImportService({ tmpRoot: scratch, probe: async () => { throw new Error('boom') } })
    const p = ok(await failing.inspect(file))
    assert.deepEqual(p.trackOrder, [])
    assert.deepEqual(scratchLeftovers(), [])
    assert.ok(fs.readFileSync(file).equals(before), 'the user’s ZIP is never modified')
  })
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log(`\n${passed} checks passed`)

function wav() {
  const data = Buffer.alloc(8000 * 2)
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(8000, 24); h.writeUInt32LE(16000, 28)
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}
