import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import zlib from 'node:zlib'
import {
  ZIP_IMPORT_LIMITS,
  collisionKey,
  normalizeArchivePath,
  type ZipRejectCode,
} from '@reading-book/book-reader-sdk'

/**
 * Minimal, bounded ZIP reader for the audiobook import preview. It reads only the end-of-central-directory
 * record and the central directory (never the whole archive), and extracts single entries by streaming them
 * through `zlib` with the byte count enforced on the ACTUAL output. `jszip` is deliberately not used: it needs the
 * whole archive in memory. The archive is untrusted: every failure here is a `ZipFormatError` with a stable code.
 */

export class ZipFormatError extends Error {
  constructor(
    readonly code: ZipRejectCode | 'unsupported_entry' | 'size_mismatch' | 'cancelled',
    message: string,
  ) {
    super(message)
    this.name = 'ZipFormatError'
  }
}

export interface ZipEntryRecord {
  /** Index in the central directory; the preview id is `e<index>`. */
  index: number
  /** Normalised, safe relative path (no trailing slash). */
  path: string
  isDirectory: boolean
  isSymlink: boolean
  encrypted: boolean
  method: number
  crc32: number
  compressedSize: number
  size: number
  localOffset: number
}

export interface ZipDirectory {
  fileSize: number
  entries: ZipEntryRecord[]
}

const SIG_EOCD = 0x06054b50
const SIG_ZIP64_LOCATOR = 0x07064b50
const SIG_ZIP64_EOCD = 0x06064b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50
const EOCD_MIN = 22
const MAX_COMMENT = 0xffff

const invalid = (message: string): ZipFormatError => new ZipFormatError('invalid_zip', message)

function safeNumber(value: bigint, what: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid(`${what} out of range`)
  return Number(value)
}

async function readAt(handle: fsp.FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length)
  const { bytesRead } = await handle.read(buf, 0, length, position)
  if (bytesRead !== length) throw invalid('archive is truncated')
  return buf
}

function decodeName(raw: Buffer, flags: number): string {
  if (flags & 0x800) return raw.toString('utf8')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw)
  } catch {
    return raw.toString('latin1')
  }
}

/**
 * Read and validate the central directory. Rejects the whole archive on: not a ZIP, empty, too many entries,
 * unsafe or too deep paths, duplicate (normalised) paths, any entry or the total above the size limits.
 */
export async function readZipDirectory(zipPath: string): Promise<ZipDirectory> {
  const handle = await fsp.open(zipPath, 'r')
  try {
    const fileSize = (await handle.stat()).size
    if (fileSize < EOCD_MIN) throw invalid('not a ZIP archive')

    const tailLen = Math.min(fileSize, EOCD_MIN + MAX_COMMENT)
    const tail = await readAt(handle, fileSize - tailLen, tailLen)
    let eocd = -1
    for (let i = tail.length - EOCD_MIN; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === SIG_EOCD && i + EOCD_MIN + tail.readUInt16LE(i + 20) === tail.length) {
        eocd = i
        break
      }
    }
    if (eocd < 0) throw invalid('not a ZIP archive')

    let total = tail.readUInt16LE(eocd + 10)
    let cdSize = tail.readUInt32LE(eocd + 12)
    let cdOffset = tail.readUInt32LE(eocd + 16)
    if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const locatorPos = fileSize - tailLen + eocd - 20
      if (locatorPos < 0) throw invalid('missing ZIP64 locator')
      const locator = await readAt(handle, locatorPos, 20)
      if (locator.readUInt32LE(0) !== SIG_ZIP64_LOCATOR) throw invalid('missing ZIP64 locator')
      const z64Pos = safeNumber(locator.readBigUInt64LE(8), 'ZIP64 offset')
      if (z64Pos + 56 > fileSize) throw invalid('bad ZIP64 record')
      const z64 = await readAt(handle, z64Pos, 56)
      if (z64.readUInt32LE(0) !== SIG_ZIP64_EOCD) throw invalid('bad ZIP64 record')
      total = safeNumber(z64.readBigUInt64LE(32), 'entry count')
      cdSize = safeNumber(z64.readBigUInt64LE(40), 'directory size')
      cdOffset = safeNumber(z64.readBigUInt64LE(48), 'directory offset')
    }

    if (total === 0) throw new ZipFormatError('empty_zip', 'The archive is empty.')
    if (total > ZIP_IMPORT_LIMITS.maxEntries) {
      throw new ZipFormatError('too_many_entries', `The archive has more than ${ZIP_IMPORT_LIMITS.maxEntries} files.`)
    }
    if (cdSize > ZIP_IMPORT_LIMITS.maxCentralDirectoryBytes) {
      throw new ZipFormatError('too_large', 'The archive directory is too large.')
    }
    if (cdOffset + cdSize > fileSize) throw invalid('directory is outside the archive')

    const cd = await readAt(handle, cdOffset, cdSize)
    const entries: ZipEntryRecord[] = []
    const seen = new Set<string>()
    let declaredTotal = 0
    let pos = 0
    for (let index = 0; index < total; index += 1) {
      if (pos + 46 > cd.length || cd.readUInt32LE(pos) !== SIG_CENTRAL) throw invalid('damaged directory')
      const madeBy = cd.readUInt16LE(pos + 4)
      const flags = cd.readUInt16LE(pos + 8)
      const method = cd.readUInt16LE(pos + 10)
      const crc32 = cd.readUInt32LE(pos + 16)
      let compressedSize = cd.readUInt32LE(pos + 20)
      let size = cd.readUInt32LE(pos + 24)
      const nameLen = cd.readUInt16LE(pos + 28)
      const extraLen = cd.readUInt16LE(pos + 30)
      const commentLen = cd.readUInt16LE(pos + 32)
      const extAttr = cd.readUInt32LE(pos + 38)
      let localOffset = cd.readUInt32LE(pos + 42)
      const next = pos + 46 + nameLen + extraLen + commentLen
      if (next > cd.length) throw invalid('damaged directory')

      if (size === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) {
        let e = pos + 46 + nameLen
        const extraEnd = e + extraLen
        while (e + 4 <= extraEnd) {
          const id = cd.readUInt16LE(e)
          const len = cd.readUInt16LE(e + 2)
          if (id === 0x0001) {
            let f = e + 4
            const take = (): number => {
              if (f + 8 > e + 4 + len) throw invalid('bad ZIP64 extra field')
              const v = safeNumber(cd.readBigUInt64LE(f), 'entry field')
              f += 8
              return v
            }
            if (size === 0xffffffff) size = take()
            if (compressedSize === 0xffffffff) compressedSize = take()
            if (localOffset === 0xffffffff) localOffset = take()
            break
          }
          e += 4 + len
        }
        if (size === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) {
          throw invalid('bad ZIP64 entry')
        }
      }

      const rawName = decodeName(cd.subarray(pos + 46, pos + 46 + nameLen), flags)
      const isDirectory = rawName.endsWith('/')
      const normalized = normalizeArchivePath(rawName)
      if (!normalized.ok) {
        throw new ZipFormatError(normalized.code, `The archive contains an unsafe path (${normalized.reason}).`)
      }
      const key = collisionKey(normalized.path)
      if (seen.has(key)) {
        throw new ZipFormatError('duplicate_path', 'The archive contains two entries with the same path.')
      }
      seen.add(key)

      if (size > ZIP_IMPORT_LIMITS.maxAudioEntryBytes) {
        throw new ZipFormatError('too_large', 'A file in the archive is too large.')
      }
      declaredTotal += size
      if (declaredTotal > ZIP_IMPORT_LIMITS.maxTotalBytes) {
        throw new ZipFormatError('too_large', 'The archive is too large when unpacked.')
      }

      entries.push({
        index,
        path: normalized.path,
        isDirectory,
        // Unix host (3) with S_IFLNK in the high word of the external attributes.
        isSymlink: madeBy >> 8 === 3 && ((extAttr >>> 16) & 0o170000) === 0o120000,
        encrypted: (flags & 1) !== 0,
        method,
        crc32,
        compressedSize,
        size,
        localOffset,
      })
      pos = next
    }
    return { fileSize, entries }
  } finally {
    await handle.close().catch(() => {})
  }
}

/** Counts the real output and fails when it exceeds, or at the end differs from, the declared size. */
function sizeGuard(declared: number, signal?: AbortSignal): Transform {
  let seen = 0
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      if (signal?.aborted) return cb(new ZipFormatError('cancelled', 'Cancelled'))
      seen += chunk.length
      if (seen > declared) return cb(new ZipFormatError('size_mismatch', 'An entry is larger than the archive says.'))
      cb(null, chunk)
    },
    flush(cb) {
      cb(seen === declared ? null : new ZipFormatError('size_mismatch', 'An entry is smaller than the archive says.'))
    },
  })
}

async function entryDataStream(zipPath: string, entry: ZipEntryRecord, fileSize: number, signal?: AbortSignal): Promise<Readable> {
  if (entry.isDirectory || entry.isSymlink) throw new ZipFormatError('unsupported_entry', 'Not a regular file.')
  if (entry.encrypted) throw new ZipFormatError('unsupported_entry', 'The file is password protected.')
  if (entry.method !== 0 && entry.method !== 8) {
    throw new ZipFormatError('unsupported_entry', `Unsupported compression method (${entry.method}).`)
  }
  if (entry.method === 0 && entry.compressedSize !== entry.size) throw invalid('damaged entry')
  const handle = await fsp.open(zipPath, 'r')
  let dataStart: number
  try {
    const header = await readAt(handle, entry.localOffset, 30)
    if (header.readUInt32LE(0) !== SIG_LOCAL) throw invalid('damaged entry header')
    dataStart = entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
  } finally {
    await handle.close().catch(() => {})
  }
  if (dataStart + entry.compressedSize > fileSize) throw invalid('entry is outside the archive')
  if (entry.size === 0) return Readable.from([])

  const raw = fs.createReadStream(zipPath, { start: dataStart, end: dataStart + entry.compressedSize - 1 })
  const guard = sizeGuard(entry.size, signal)
  const source: Readable = entry.method === 8 ? raw.pipe(zlib.createInflateRaw()) : raw
  // pipe() does not forward errors; surface them on the returned stream.
  raw.on('error', (e) => guard.destroy(e))
  if (source !== raw) source.on('error', (e) => guard.destroy(new ZipFormatError('invalid_zip', `Damaged data (${e.message})`)))
  guard.once('close', () => {
    raw.destroy()
    source.destroy()
  })
  return source.pipe(guard)
}

/** Stream one entry to `dest`. The caller owns `dest` (and removes it on failure). */
export async function extractEntryToFile(
  zipPath: string,
  fileSize: number,
  entry: ZipEntryRecord,
  dest: string,
  signal?: AbortSignal,
): Promise<void> {
  const stream = await entryDataStream(zipPath, entry, fileSize, signal)
  await pipeline(stream, fs.createWriteStream(dest, { flags: 'wx' }))
}

/** The first `limit` bytes of an entry (the stream is abandoned once enough was read). */
export async function readEntryBytes(
  zipPath: string,
  fileSize: number,
  entry: ZipEntryRecord,
  limit: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  const stream = await entryDataStream(zipPath, entry, fileSize, signal)
  const chunks: Buffer[] = []
  let got = 0
  try {
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer)
      got += (chunk as Buffer).length
      if (got >= limit) break
    }
  } finally {
    stream.destroy()
  }
  return Buffer.concat(chunks).subarray(0, limit)
}
