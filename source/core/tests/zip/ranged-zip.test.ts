import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { RANGED_ZIP_LIMITS, decodeUtf8, openRangedZip, type RandomAccessSource } from '../../src/zip/ranged-zip'
import { SdkError } from '../../src/core/errors'

// ---- a tiny ZIP writer for the tests (stored / deflate, optional ZIP64 end records, optional comment) ----

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(b: Uint8Array): number {
  let c = 0xffffffff
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

type Entry = { name: string; data: Uint8Array; deflate?: boolean }

function u16(v: number) {
  const b = new Uint8Array(2)
  new DataView(b.buffer).setUint16(0, v, true)
  return b
}
function u32(v: number) {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, v >>> 0, true)
  return b
}
function u64(v: number) {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigUint64(0, BigInt(v), true)
  return b
}
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
const utf8 = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'))

function buildZip(entries: Entry[], options: { zip64?: boolean; comment?: string } = {}): Uint8Array {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const e of entries) {
    const body = e.deflate ? new Uint8Array(deflateRawSync(e.data)) : e.data
    const name = utf8(e.name)
    const method = e.deflate ? 8 : 0
    const crc = crc32(e.data)
    const local = concat([
      u32(0x04034b50), u16(20), u16(0x800), u16(method), u16(0), u16(0), u32(crc),
      u32(body.length), u32(e.data.length), u16(name.length), u16(0), name, body,
    ])
    centrals.push(
      concat([
        u32(0x02014b50), u16(20), u16(20), u16(0x800), u16(method), u16(0), u16(0), u32(crc),
        u32(body.length), u32(e.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0),
        u32(offset), name,
      ]),
    )
    locals.push(local)
    offset += local.length
  }
  const cd = concat(centrals)
  const cdOffset = offset
  const comment = utf8(options.comment ?? '')
  const tail: Uint8Array[] = []
  if (options.zip64) {
    const z64Offset = cdOffset + cd.length
    tail.push(
      concat([
        u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0),
        u64(entries.length), u64(entries.length), u64(cd.length), u64(cdOffset),
      ]),
      concat([u32(0x07064b50), u32(0), u64(z64Offset), u32(1)]),
      concat([u32(0x06054b50), u16(0), u16(0), u16(0xffff), u16(0xffff), u32(0xffffffff), u32(0xffffffff), u16(comment.length), comment]),
    )
  } else {
    tail.push(
      concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cd.length), u32(cdOffset), u16(comment.length), comment]),
    )
  }
  return concat([...locals, cd, ...tail])
}

/** An in-memory source that counts what is read. */
function memorySource(bytes: Uint8Array) {
  const reads: { offset: number; length: number }[] = []
  const source: RandomAccessSource = {
    size: bytes.length,
    read: async (offset, length) => {
      reads.push({ offset, length })
      return bytes.slice(offset, offset + length)
    },
  }
  return { source, reads, bytesRead: () => reads.reduce((n, r) => n + r.length, 0) }
}

const inflate = (data: Uint8Array) => new Uint8Array(inflateRawSync(data))

const opf = '<package><metadata><dc:title>Ünïcödé — 標題</dc:title></metadata></package>'

describe('openRangedZip', () => {
  it('lists entries and reads stored and deflated entries', async () => {
    const big = utf8('x'.repeat(50_000))
    const zip = buildZip([
      { name: 'mimetype', data: utf8('application/epub+zip') },
      { name: 'OEBPS/content.opf', data: utf8(opf), deflate: true },
      { name: 'OEBPS/big.xhtml', data: big, deflate: true },
    ])
    const { source } = memorySource(zip)
    const reader = await openRangedZip(source, inflate)
    expect(reader.listEntries()).toEqual(['mimetype', 'OEBPS/content.opf', 'OEBPS/big.xhtml'])
    expect(await reader.readText('mimetype')).toBe('application/epub+zip')
    expect(await reader.readText('OEBPS/content.opf')).toBe(opf)
    expect((await reader.readBytes('OEBPS/big.xhtml'))?.length).toBe(50_000)
    expect(await reader.readText('missing.txt')).toBeNull()
    expect(await reader.readBytes('missing.bin')).toBeNull()
  })

  it('reads only the end records, the central directory and the requested entries', async () => {
    const filler = new Uint8Array(2_000_000).map((_, i) => i % 251)
    const zip = buildZip([
      { name: 'META-INF/container.xml', data: utf8('<container/>'), deflate: true },
      { name: 'OEBPS/images/huge.bin', data: filler }, // stored, never asked for
      { name: 'OEBPS/content.opf', data: utf8(opf), deflate: true },
    ])
    const { source, bytesRead } = memorySource(zip)
    const reader = await openRangedZip(source, inflate)
    await reader.readText('META-INF/container.xml')
    await reader.readText('OEBPS/content.opf')
    expect(bytesRead()).toBeLessThan(100_000)
    expect(zip.length).toBeGreaterThan(2_000_000)
  })

  it('accepts a ZIP64 end of central directory', async () => {
    const zip = buildZip([{ name: 'a.txt', data: utf8('hello'), deflate: true }], { zip64: true })
    const reader = await openRangedZip(memorySource(zip).source, inflate)
    expect(reader.listEntries()).toEqual(['a.txt'])
    expect(await reader.readText('a.txt')).toBe('hello')
  })

  it('finds the end record behind a long archive comment', async () => {
    const zip = buildZip([{ name: 'a.txt', data: utf8('ok') }], { comment: 'c'.repeat(60_000) })
    const reader = await openRangedZip(memorySource(zip).source, inflate)
    expect(await reader.readText('a.txt')).toBe('ok')
  })

  it('rejects a truncated or non-ZIP file with EPUB_MALFORMED', async () => {
    const zip = buildZip([{ name: 'a.txt', data: utf8('hello') }])
    for (const bytes of [zip.slice(0, zip.length - 10), utf8('not a zip at all'), new Uint8Array(0)]) {
      await expect(openRangedZip(memorySource(bytes).source, inflate)).rejects.toMatchObject({ code: 'EPUB_MALFORMED' })
    }
  })

  it('rejects an entry whose data runs past the end of the file', async () => {
    const zip = buildZip([{ name: 'a.txt', data: utf8('hello world'), deflate: false }])
    // Cut the local data but keep the end records by rebuilding: corrupt the stored size in the central directory.
    const view = new DataView(zip.buffer)
    const cdStart = zip.length - 22 - (46 + 'a.txt'.length)
    view.setUint32(cdStart + 20, 10_000_000, true) // compressed size
    const reader = await openRangedZip(memorySource(zip).source, inflate)
    await expect(reader.readBytes('a.txt')).rejects.toBeInstanceOf(SdkError)
  })

  it('enforces the limits (entries, central directory, one entry)', async () => {
    expect(RANGED_ZIP_LIMITS).toEqual({ maxEntries: 20_000, maxCentralDirectoryBytes: 16 * 1024 * 1024, maxEntryBytes: 32 * 1024 * 1024 })
    const zip = buildZip([{ name: 'a.txt', data: utf8('x') }, { name: 'b.txt', data: utf8('y') }])
    await expect(openRangedZip(memorySource(zip).source, inflate, { maxEntries: 1 })).rejects.toMatchObject({ code: 'EPUB_MALFORMED' })
    await expect(openRangedZip(memorySource(zip).source, inflate, { maxCentralDirectoryBytes: 10 })).rejects.toMatchObject({ code: 'EPUB_MALFORMED' })
    const reader = await openRangedZip(memorySource(buildZip([{ name: 'big', data: new Uint8Array(100) }])).source, inflate, { maxEntryBytes: 50 })
    await expect(reader.readBytes('big')).rejects.toMatchObject({ code: 'EPUB_MALFORMED' })
  })

  it('refuses an unsupported compression method', async () => {
    const zip = buildZip([{ name: 'a.txt', data: utf8('hello') }])
    const view = new DataView(zip.buffer)
    const cdStart = zip.length - 22 - (46 + 'a.txt'.length)
    view.setUint16(cdStart + 10, 12, true) // bzip2
    const reader = await openRangedZip(memorySource(zip).source, inflate)
    await expect(reader.readBytes('a.txt')).rejects.toMatchObject({ code: 'EPUB_MALFORMED' })
  })
})

describe('decodeUtf8', () => {
  it('decodes multi-byte text, strips a BOM and replaces invalid bytes', () => {
    expect(decodeUtf8(utf8('Ünïcödé — 標題 😀'))).toBe('Ünïcödé — 標題 😀')
    expect(decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('A')
    expect(decodeUtf8(new Uint8Array([0x41, 0xff, 0x42]))).toBe('A�B')
  })
})
