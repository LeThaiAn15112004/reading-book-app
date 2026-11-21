/**
 * Spec 016 (FR-004 / FR-004a, research R4): a ZIP reader that reads only what it is asked for.
 *
 * It reads the End Of Central Directory record (in the last ≤ 64 KiB + 22 B), the central directory, and then, per
 * requested entry, that entry's local header and data — never the whole file. Stored and deflate entries; ZIP64 end
 * records. It implements the existing `ArchiveReader` port, so `readEpubImportMetadata` runs on it unchanged.
 *
 * Pure: the file access (`RandomAccessSource`) and raw inflate (`InflateRaw`) are injected — Node `fs` + `zlib` on
 * Desktop, HTTP `Range` + `DecompressionStream('deflate-raw')` in the phone WebView.
 */
import { SdkError } from '../core/errors.js'
import type { ArchiveReader } from '../ports/archive.js'

export type RandomAccessSource = {
  /** Total size of the file in bytes. */
  size: number
  /** Bytes `[offset, offset + length)`; may return fewer only at the end of the file. */
  read: (offset: number, length: number) => Promise<Uint8Array>
}

/** Raw (headerless) DEFLATE decompression. */
export type InflateRaw = (data: Uint8Array) => Promise<Uint8Array> | Uint8Array

export type RangedZipLimits = {
  maxEntries: number
  maxCentralDirectoryBytes: number
  maxEntryBytes: number
}

/** research R4: entries ≤ 20 000, central directory ≤ 16 MiB, one entry ≤ 32 MiB → `EPUB_MALFORMED`. */
export const RANGED_ZIP_LIMITS: RangedZipLimits = {
  maxEntries: 20_000,
  maxCentralDirectoryBytes: 16 * 1024 * 1024,
  maxEntryBytes: 32 * 1024 * 1024,
}

const EOCD_SIG = 0x06054b50
const ZIP64_LOCATOR_SIG = 0x07064b50
const ZIP64_EOCD_SIG = 0x06064b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50
const EOCD_MIN = 22
const MAX_COMMENT = 0xffff
const LOCAL_HEADER = 30

type CentralEntry = {
  name: string
  method: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

const malformed = (message: string) => new SdkError('EPUB_MALFORMED', message)

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function u64(dv: DataView, at: number): number {
  const v = dv.getBigUint64(at, true)
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw malformed('ZIP64 value out of range')
  return Number(v)
}

async function readExactly(source: RandomAccessSource, offset: number, length: number): Promise<Uint8Array> {
  if (offset < 0 || length < 0 || offset + length > source.size) throw malformed('ZIP entry runs past the end of the file')
  if (length === 0) return new Uint8Array(0)
  const bytes = await source.read(offset, length)
  if (bytes.length !== length) throw malformed('ZIP file is truncated')
  return bytes
}

/** UTF-8 → string (BOM stripped, invalid sequences → U+FFFD). Core has no `TextDecoder` (no DOM / Node globals). */
export function decodeUtf8(bytes: Uint8Array): string {
  let i = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
  const out: string[] = []
  let chunk: number[] = []
  const push = (cp: number) => {
    if (cp > 0xffff) {
      cp -= 0x10000
      chunk.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
    } else chunk.push(cp)
    if (chunk.length > 8192) {
      out.push(String.fromCharCode(...chunk))
      chunk = []
    }
  }
  while (i < bytes.length) {
    const b = bytes[i]!
    let need = 0
    let cp = 0
    let min = 0
    if (b < 0x80) {
      push(b)
      i += 1
      continue
    } else if (b >= 0xc2 && b <= 0xdf) {
      need = 1
      cp = b & 0x1f
      min = 0x80
    } else if (b >= 0xe0 && b <= 0xef) {
      need = 2
      cp = b & 0x0f
      min = 0x800
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3
      cp = b & 0x07
      min = 0x10000
    } else {
      push(0xfffd)
      i += 1
      continue
    }
    let ok = true
    let j = 1
    for (; j <= need; j += 1) {
      const c = bytes[i + j]
      if (c === undefined || (c & 0xc0) !== 0x80) {
        ok = false
        break
      }
      cp = (cp << 6) | (c & 0x3f)
    }
    if (!ok || cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      push(0xfffd)
      i += Math.max(1, j)
      continue
    }
    push(cp)
    i += need + 1
  }
  out.push(String.fromCharCode(...chunk))
  return out.join('')
}

async function findEndOfCentralDirectory(source: RandomAccessSource) {
  if (source.size < EOCD_MIN) throw malformed('not a ZIP file (too small)')
  const tailLength = Math.min(source.size, EOCD_MIN + MAX_COMMENT)
  const tailStart = source.size - tailLength
  const tail = await readExactly(source, tailStart, tailLength)
  const dv = view(tail)
  for (let at = tail.length - EOCD_MIN; at >= 0; at -= 1) {
    if (dv.getUint32(at, true) !== EOCD_SIG) continue
    const commentLength = dv.getUint16(at + 20, true)
    if (at + EOCD_MIN + commentLength !== tail.length) continue // a signature inside the comment
    let entries = dv.getUint16(at + 10, true)
    let cdSize = dv.getUint32(at + 12, true)
    let cdOffset = dv.getUint32(at + 16, true)
    // ZIP64: the locator sits right before the classic end record.
    if ((entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) && at >= 20) {
      if (dv.getUint32(at - 20, true) === ZIP64_LOCATOR_SIG) {
        const z64Offset = u64(dv, at - 20 + 8)
        const z64 = await readExactly(source, z64Offset, 56)
        const zv = view(z64)
        if (zv.getUint32(0, true) !== ZIP64_EOCD_SIG) throw malformed('bad ZIP64 end of central directory')
        entries = u64(zv, 32)
        cdSize = u64(zv, 40)
        cdOffset = u64(zv, 48)
      }
    }
    return { entries, cdSize, cdOffset }
  }
  throw malformed('not a ZIP file (no end of central directory)')
}

function parseCentralDirectory(cd: Uint8Array, expected: number, limits: RangedZipLimits): CentralEntry[] {
  const dv = view(cd)
  const list: CentralEntry[] = []
  let at = 0
  while (at + 46 <= cd.length) {
    if (dv.getUint32(at, true) !== CENTRAL_SIG) throw malformed('bad central directory entry')
    if (list.length >= limits.maxEntries) throw malformed('too many ZIP entries')
    const method = dv.getUint16(at + 10, true)
    let compressedSize = dv.getUint32(at + 20, true)
    let uncompressedSize = dv.getUint32(at + 24, true)
    const nameLength = dv.getUint16(at + 28, true)
    const extraLength = dv.getUint16(at + 30, true)
    const commentLength = dv.getUint16(at + 32, true)
    let localHeaderOffset = dv.getUint32(at + 42, true)
    const nameStart = at + 46
    const extraStart = nameStart + nameLength
    const next = extraStart + extraLength + commentLength
    if (next > cd.length) throw malformed('central directory is truncated')
    const name = decodeUtf8(cd.subarray(nameStart, extraStart))
    // ZIP64 extended information extra field (0x0001): only the fields set to 0xFFFFFFFF are present, in order.
    let e = extraStart
    while (e + 4 <= extraStart + extraLength) {
      const id = dv.getUint16(e, true)
      const size = dv.getUint16(e + 2, true)
      if (id === 0x0001) {
        let p = e + 4
        if (uncompressedSize === 0xffffffff) {
          uncompressedSize = u64(dv, p)
          p += 8
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = u64(dv, p)
          p += 8
        }
        if (localHeaderOffset === 0xffffffff) localHeaderOffset = u64(dv, p)
      }
      e += 4 + size
    }
    list.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset })
    at = next
  }
  if (expected !== list.length && expected !== 0xffff) throw malformed('central directory entry count mismatch')
  return list
}

/** Opens a ZIP over a random-access source. Throws `EPUB_MALFORMED` when it is not a readable ZIP. */
export async function openRangedZip(
  source: RandomAccessSource,
  inflate: InflateRaw,
  limitOverrides: Partial<RangedZipLimits> = {},
): Promise<ArchiveReader> {
  const limits = { ...RANGED_ZIP_LIMITS, ...limitOverrides }
  const { entries, cdSize, cdOffset } = await findEndOfCentralDirectory(source)
  if (entries > limits.maxEntries) throw malformed('too many ZIP entries')
  if (cdSize > limits.maxCentralDirectoryBytes) throw malformed('ZIP central directory too large')
  const cd = await readExactly(source, cdOffset, cdSize)
  const list = parseCentralDirectory(cd, entries, limits)
  const byName = new Map(list.map((entry) => [entry.name, entry]))
  const names = list.map((entry) => entry.name)

  async function readBytes(path: string): Promise<Uint8Array | null> {
    const entry = byName.get(path)
    if (!entry) return null
    if (entry.uncompressedSize > limits.maxEntryBytes || entry.compressedSize > limits.maxEntryBytes) {
      throw malformed(`ZIP entry too large: ${path}`)
    }
    const header = await readExactly(source, entry.localHeaderOffset, LOCAL_HEADER)
    const hv = view(header)
    if (hv.getUint32(0, true) !== LOCAL_SIG) throw malformed('bad local file header')
    const dataStart = entry.localHeaderOffset + LOCAL_HEADER + hv.getUint16(26, true) + hv.getUint16(28, true)
    const raw = await readExactly(source, dataStart, entry.compressedSize)
    if (entry.method === 0) return raw
    if (entry.method !== 8) throw malformed(`unsupported ZIP compression method ${entry.method}`)
    const out = await inflate(raw)
    if (out.length > limits.maxEntryBytes) throw malformed(`ZIP entry too large: ${path}`)
    return out
  }

  return {
    listEntries: () => names,
    readBytes,
    readText: async (path) => {
      const bytes = await readBytes(path)
      return bytes === null ? null : decodeUtf8(bytes)
    },
  }
}
