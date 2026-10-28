/**
 * Multi-chapter audiobook layout — the platform-free rules shared by the importer and the library store
 * (docs/implementation_plan/audiobook_multi_chapter_import.md §2–§3).
 *
 * A multi-chapter audiobook is ONE `books` row plus ordered rows in `book_audio_chapters`. Its files live flat
 * in the book's own folder, named by position and chapter id, so two chapters can never share a name even when
 * the archive held the same basename in different folders. Nothing here touches the file system.
 */

/** Formats a chapter may have; `aiff` is recognised elsewhere but never importable. */
export const CHAPTER_FORMATS: readonly string[] = ['mp3', 'm4a', 'm4b', 'aac', 'wav', 'flac', 'ogg', 'opus']

/** Fewer than this is not a multi-chapter book: one selected track uses the single-file import path. */
export const MIN_AUDIOBOOK_CHAPTERS = 2

/** Prefix of the parent hash input. It makes the hash impossible to confuse with the SHA-256 of any real file. */
export const AUDIOBOOK_HASH_DOMAIN = 'readmate-audiobook-v1'

const HEX_64 = /^[0-9a-f]{64}$/
const CHAPTER_FILE_NAME = /^(\d{4,})-([0-9a-f]{8})\.(mp3|m4a|m4b|aac|wav|flac|ogg|opus)$/

/**
 * `{position:04d}-{first 8 hex digits of the chapter id}.{format}`, e.g. `0007-3f9a1c2e.mp3`.
 * The extension is the chapter's own format, so `resolveBookFile`-style extension checks keep working.
 */
export function chapterFileName(position: number, chapterId: string, format: string): string {
  if (!Number.isInteger(position) || position < 0 || position > 999_999) throw new Error('Invalid chapter position')
  if (!CHAPTER_FORMATS.includes(format)) throw new Error(`Not a chapter format: ${format}`)
  const hex = chapterId.replace(/-/g, '').toLowerCase()
  if (!/^[0-9a-f]{8,}$/.test(hex)) throw new Error('Invalid chapter id')
  return `${String(position).padStart(4, '0')}-${hex.slice(0, 8)}.${format}`
}

/** True for a name produced by {@link chapterFileName} (a basename: no separators, no dots other than the extension). */
export function isChapterFileName(name: unknown): name is string {
  return typeof name === 'string' && CHAPTER_FILE_NAME.test(name)
}

/**
 * The exact text hashed to identify the book: the domain prefix, then the SHA-256 (lowercase hex) of every chapter
 * file in playback order, one per line. Order and membership both change the result.
 */
export function audiobookHashInput(chapterSha256s: readonly string[]): string {
  if (chapterSha256s.length === 0) throw new Error('No chapters')
  for (const h of chapterSha256s) if (!HEX_64.test(h)) throw new Error('Invalid chapter hash')
  return `${AUDIOBOOK_HASH_DOMAIN}\n${chapterSha256s.join('\n')}`
}

/** `books.sha256` of a multi-chapter audiobook: SHA-256 of {@link audiobookHashInput}. Deterministic across archives. */
export function audiobookParentSha256(chapterSha256s: readonly string[]): string {
  return sha256Hex(audiobookHashInput(chapterSha256s))
}

export interface AudioChapterRecord {
  /** UUID, stable for the life of the book (the future `trackId`). */
  id: string
  bookId: string
  /** 0-based playback order. */
  position: number
  title: string
  /** Basename inside the book's folder — see {@link chapterFileName}. */
  fileName: string
  /** Archive-relative path; provenance only, never opened. */
  sourcePath: string
  fileFormat: string
  sizeBytes: number
  /** SHA-256 (lowercase hex) of the chapter file. */
  sha256: string
  /** `null` when it could not be determined — never a reason to reject a track. */
  durationSeconds: number | null
}

export type ChapterListCheck = { ok: true } | { ok: false; reason: string }

/** Everything the store requires of a chapter list before it writes (the SQL CHECKs are a second line of defence). */
export function validateChapterRecords(bookId: string, chapters: readonly AudioChapterRecord[]): ChapterListCheck {
  const bad = (reason: string): ChapterListCheck => ({ ok: false, reason })
  if (chapters.length < MIN_AUDIOBOOK_CHAPTERS) return bad(`A multi-chapter audiobook needs at least ${MIN_AUDIOBOOK_CHAPTERS} chapters`)
  const ids = new Set<string>()
  for (let i = 0; i < chapters.length; i += 1) {
    const c = chapters[i] as AudioChapterRecord
    const at = `chapter ${i}`
    if (c.bookId !== bookId) return bad(`${at}: belongs to another book`)
    if (c.position !== i) return bad(`${at}: positions must be 0..n-1 in order`)
    if (!c.id || ids.has(c.id)) return bad(`${at}: missing or duplicate id`)
    ids.add(c.id)
    if (!CHAPTER_FORMATS.includes(c.fileFormat)) return bad(`${at}: unsupported format`)
    let expected: string
    try {
      expected = chapterFileName(c.position, c.id, c.fileFormat)
    } catch (err) {
      return bad(`${at}: ${(err as Error).message}`)
    }
    if (c.fileName !== expected) return bad(`${at}: file name must be ${expected}`)
    if (typeof c.title !== 'string' || !c.title.trim()) return bad(`${at}: empty title`)
    if (typeof c.sourcePath !== 'string' || !c.sourcePath) return bad(`${at}: empty source path`)
    if (!Number.isSafeInteger(c.sizeBytes) || c.sizeBytes < 0) return bad(`${at}: invalid size`)
    if (!HEX_64.test(c.sha256)) return bad(`${at}: invalid sha256`)
    if (c.durationSeconds !== null && !(Number.isFinite(c.durationSeconds) && c.durationSeconds > 0)) return bad(`${at}: invalid duration`)
  }
  return { ok: true }
}

// ---------------------------------------------------------------- SHA-256 (SDK has no crypto)

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
  0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
  0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
  0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
  0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n))

/**
 * SHA-256 of an ASCII string, lowercase hex. ASCII only on purpose (the inputs here are a fixed prefix and hex
 * digests), which avoids needing a UTF-8 encoder in a runtime-free package. Checked against Node's `crypto` in the tests.
 */
export function sha256Hex(ascii: string): string {
  const len = ascii.length
  const bytes: number[] = new Array(len)
  for (let i = 0; i < len; i += 1) {
    const c = ascii.charCodeAt(i)
    if (c > 0x7f) throw new Error('sha256Hex: ASCII input only')
    bytes[i] = c
  }
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  const bitLen = len * 8
  const hi = Math.floor(bitLen / 0x1_0000_0000)
  const lo = bitLen >>> 0
  for (const word of [hi, lo]) for (let s = 24; s >= 0; s -= 8) bytes.push((word >>> s) & 0xff)

  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const w = new Uint32Array(64)
  for (let off = 0; off < bytes.length; off += 64) {
    for (let t = 0; t < 16; t += 1) {
      const j = off + t * 4
      w[t] = ((bytes[j] as number) << 24) | ((bytes[j + 1] as number) << 16) | ((bytes[j + 2] as number) << 8) | (bytes[j + 3] as number)
    }
    for (let t = 16; t < 64; t += 1) {
      const a = w[t - 15] as number
      const b = w[t - 2] as number
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)
      w[t] = ((w[t - 16] as number) + s0 + (w[t - 7] as number) + s1) | 0
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as [number, number, number, number, number, number, number, number]
    for (let t = 0; t < 64; t += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + (K[t] as number) + (w[t] as number)) | 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      hh = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    h[0] = ((h[0] as number) + a) | 0
    h[1] = ((h[1] as number) + b) | 0
    h[2] = ((h[2] as number) + c) | 0
    h[3] = ((h[3] as number) + d) | 0
    h[4] = ((h[4] as number) + e) | 0
    h[5] = ((h[5] as number) + f) | 0
    h[6] = ((h[6] as number) + g) | 0
    h[7] = ((h[7] as number) + hh) | 0
  }
  return Array.from(h, (x) => (x >>> 0).toString(16).padStart(8, '0')).join('')
}
