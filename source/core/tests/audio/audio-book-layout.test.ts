import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  AUDIOBOOK_HASH_DOMAIN,
  CHAPTER_FORMATS,
  audiobookHashInput,
  audiobookParentSha256,
  chapterFileName,
  isChapterFileName,
  sha256Hex,
  validateChapterRecords,
  type AudioChapterRecord,
} from '../../src/audio/audio-book-layout'
import { AUDIO_FORMAT_KEYS } from '../../src/audio/audio-formats'

const nodeSha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const H = (n: number) => n.toString(16).padStart(64, '0')

describe('sha256Hex (pure implementation)', () => {
  it('matches Node crypto on the standard vectors and on block boundaries', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    for (const n of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
      const s = 'x'.repeat(n)
      expect(sha256Hex(s), `length ${n}`).toBe(nodeSha(s))
    }
  })
  it('refuses non-ASCII input', () => {
    expect(() => sha256Hex('é')).toThrow()
  })
})

describe('chapter file names', () => {
  const id = '3f9a1c2e-1111-4222-8333-444455556666'
  it('is {position:04d}-{id8}.{format}, a plain basename', () => {
    expect(chapterFileName(0, id, 'mp3')).toBe('0000-3f9a1c2e.mp3')
    expect(chapterFileName(67, id, 'm4b')).toBe('0067-3f9a1c2e.m4b')
    expect(chapterFileName(12345, id, 'flac')).toBe('12345-3f9a1c2e.flac')
    for (const f of CHAPTER_FORMATS) expect(isChapterFileName(chapterFileName(1, id, f))).toBe(true)
  })
  it('never collides: same archive basename in different folders still gets distinct names', () => {
    // CD1/01.mp3 and CD2/01.mp3 are chapters 0 and 1 with different ids — names differ by position and id.
    const a = chapterFileName(0, 'aaaaaaaa-0000-0000-0000-000000000000', 'mp3')
    const b = chapterFileName(1, 'bbbbbbbb-0000-0000-0000-000000000000', 'mp3')
    expect(a).not.toBe(b)
    // even with the same id prefix, position keeps them apart
    expect(chapterFileName(0, id, 'mp3')).not.toBe(chapterFileName(1, id, 'mp3'))
  })
  it('accepts only importable formats and ids, and positions in range', () => {
    expect(() => chapterFileName(0, id, 'aiff')).toThrow()
    expect(() => chapterFileName(0, id, 'zip')).toThrow()
    expect(() => chapterFileName(0, 'not-hex!', 'mp3')).toThrow()
    expect(() => chapterFileName(-1, id, 'mp3')).toThrow()
    expect(() => chapterFileName(1.5, id, 'mp3')).toThrow()
  })
  it('rejects anything that is not a canonical basename', () => {
    for (const bad of ['', '../0000-3f9a1c2e.mp3', 'a/0000-3f9a1c2e.mp3', 'a\\0000-3f9a1c2e.mp3', '0000-3f9a1c2e.aiff', '0-3f9a1c2e.mp3', '0000-3F9A1C2E.mp3', '0000-3f9a1c2e.mp3.exe', 5, null]) {
      expect(isChapterFileName(bad), String(bad)).toBe(false)
    }
  })
  it('chapter formats are exactly the importable audio formats', () => {
    expect([...CHAPTER_FORMATS].sort()).toEqual([...AUDIO_FORMAT_KEYS].sort())
  })
})

describe('parent hash', () => {
  const a = H(1)
  const b = H(2)
  const c = H(3)
  it('is the SHA-256 of the domain-prefixed ordered list', () => {
    expect(audiobookHashInput([a, b])).toBe(`${AUDIOBOOK_HASH_DOMAIN}\n${a}\n${b}`)
    expect(audiobookParentSha256([a, b])).toBe(nodeSha(`${AUDIOBOOK_HASH_DOMAIN}\n${a}\n${b}`))
  })
  it('is deterministic, and depends on order and on the selection', () => {
    expect(audiobookParentSha256([a, b, c])).toBe(audiobookParentSha256([a, b, c]))
    expect(audiobookParentSha256([a, b, c])).not.toBe(audiobookParentSha256([a, c, b]))
    expect(audiobookParentSha256([a, b, c])).not.toBe(audiobookParentSha256([a, b]))
    expect(audiobookParentSha256([a, b])).not.toBe(audiobookParentSha256([b, c]))
  })
  it('depends only on the track hashes (the same tracks from another archive give the same hash)', () => {
    expect(audiobookParentSha256([a, b])).toBe(audiobookParentSha256([...[a, b]]))
  })
  it('can never equal the SHA-256 of any single track or of the concatenated tracks', () => {
    const parent = audiobookParentSha256([a, b])
    expect([a, b, c]).not.toContain(parent)
    expect(parent).not.toBe(nodeSha(a + b))
    expect(parent).toMatch(/^[0-9a-f]{64}$/)
  })
  it('rejects empty lists and malformed hashes', () => {
    expect(() => audiobookParentSha256([])).toThrow()
    expect(() => audiobookParentSha256([a, 'XYZ'])).toThrow()
    expect(() => audiobookParentSha256([a, H(255).toUpperCase()])).toThrow()
  })
})

describe('validateChapterRecords', () => {
  const bookId = 'book-1'
  const make = (n: number): AudioChapterRecord[] =>
    Array.from({ length: n }, (_, i) => {
      const id = `${(i + 1).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`
      return {
        id,
        bookId,
        position: i,
        title: `Chapter ${i + 1}`,
        fileName: chapterFileName(i, id, 'mp3'),
        sourcePath: `Book/CD${i % 2}/01.mp3`, // duplicate basenames across folders on purpose
        fileFormat: 'mp3',
        sizeBytes: 100 + i,
        sha256: H(i + 1),
        durationSeconds: i === 1 ? null : 60 + i,
      }
    })

  it('accepts a valid list, mixed formats and unknown (null) durations', () => {
    expect(validateChapterRecords(bookId, make(3))).toEqual({ ok: true })
    const mixed = make(2)
    mixed[1] = { ...(mixed[1] as AudioChapterRecord), fileFormat: 'm4b', fileName: chapterFileName(1, (mixed[1] as AudioChapterRecord).id, 'm4b') }
    expect(validateChapterRecords(bookId, mixed)).toEqual({ ok: true })
  })
  it('requires at least two chapters (one track uses the single-file path)', () => {
    expect(validateChapterRecords(bookId, make(1)).ok).toBe(false)
    expect(validateChapterRecords(bookId, []).ok).toBe(false)
  })
  it.each([
    ['other book', (l: AudioChapterRecord[]) => { l[1] = { ...(l[1] as AudioChapterRecord), bookId: 'x' } }],
    ['gap in positions', (l: AudioChapterRecord[]) => { l[1] = { ...(l[1] as AudioChapterRecord), position: 5 } }],
    ['out of order', (l: AudioChapterRecord[]) => { l.reverse() }],
    ['duplicate id', (l: AudioChapterRecord[]) => { l[1] = { ...(l[1] as AudioChapterRecord), id: (l[0] as AudioChapterRecord).id } }],
    ['non-canonical file name', (l: AudioChapterRecord[]) => { l[1] = { ...(l[1] as AudioChapterRecord), fileName: '../evil.mp3' } }],
    ['name does not match position', (l: AudioChapterRecord[]) => { l[1] = { ...(l[1] as AudioChapterRecord), fileName: (l[0] as AudioChapterRecord).fileName } }],
    ['aiff format', (l: AudioChapterRecord[]) => { l[1] = { ...(l[1] as AudioChapterRecord), fileFormat: 'aiff' } }],
    ['empty title', (l: AudioChapterRecord[]) => { l[1] = { ...(l[1] as AudioChapterRecord), title: '  ' } }],
    ['empty source path', (l: AudioChapterRecord[]) => { l[1] = { ...(l[1] as AudioChapterRecord), sourcePath: '' } }],
    ['negative size', (l: AudioChapterRecord[]) => { l[1] = { ...(l[1] as AudioChapterRecord), sizeBytes: -1 } }],
    ['bad sha', (l: AudioChapterRecord[]) => { l[1] = { ...(l[1] as AudioChapterRecord), sha256: 'abc' } }],
    ['zero duration', (l: AudioChapterRecord[]) => { l[1] = { ...(l[1] as AudioChapterRecord), durationSeconds: 0 } }],
    ['NaN duration', (l: AudioChapterRecord[]) => { l[1] = { ...(l[1] as AudioChapterRecord), durationSeconds: Number.NaN } }],
  ])('rejects: %s', (_name, mutate) => {
    const list = make(3)
    mutate(list)
    expect(validateChapterRecords(bookId, list).ok).toBe(false)
  })
})
