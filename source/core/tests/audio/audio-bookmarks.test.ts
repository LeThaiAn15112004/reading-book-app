import { describe, expect, it } from 'vitest'
import { audioProgressPatch, parseAudioProgress, sanitizeAudioProgressInput } from '../../src/audio/audio-progress'
import { createAudioBookmark, resolveBookmarkTarget, sanitizeAudioBookmarks } from '../../src/audio/audio-bookmarks'
import { normalizeChapters, type AudioChapter } from '../../src/audio/audio-timeline'
import { parseReadingState } from '../../src/persistence/books-json'

const CH = normalizeChapters(
  [
    { id: 'a', title: 'One', startSeconds: 0, endSeconds: 1200 },
    { id: 'b', title: 'Two', startSeconds: 1200, endSeconds: 2700 },
  ],
  2700,
).chapters as AudioChapter[]
const NOW = '2026-10-21T10:00:00.000Z'

describe('createAudioBookmark', () => {
  it('inside a chapter: keeps the absolute position, the chapter id and the offset in it', () => {
    const b = createAudioBookmark({ id: 'x', positionSeconds: 1500, chapters: CH, nowIso: NOW })
    expect(b).toEqual({ id: 'x', label: 'Two · 25:00', positionSeconds: 1500, chapterId: 'b', chapterOffsetSeconds: 300, createdAt: NOW })
  })
  it('without chapters: position only, neutral label', () => {
    const b = createAudioBookmark({ id: 'x', positionSeconds: 3725, chapters: [], nowIso: NOW })
    expect(b).toEqual({ id: 'x', label: 'Bookmark at 1:02:05', positionSeconds: 3725, createdAt: NOW })
    expect('chapterId' in b).toBe(false)
  })
  it('a custom label wins; a garbage position becomes 0', () => {
    expect(createAudioBookmark({ id: 'x', positionSeconds: 10, chapters: [], nowIso: NOW, label: '  Great quote  ' }).label).toBe('Great quote')
    expect(createAudioBookmark({ id: 'x', positionSeconds: NaN, chapters: [], nowIso: NOW }).positionSeconds).toBe(0)
  })
})

describe('resolveBookmarkTarget', () => {
  const bookmark = createAudioBookmark({ id: 'x', positionSeconds: 1500, chapters: CH, nowIso: NOW })
  it('restores the saved position', () => {
    expect(resolveBookmarkTarget(bookmark, CH, 2700)).toBe(1500)
  })
  it('follows the chapter when the chapter list was re-read with shifted boundaries', () => {
    const shifted = normalizeChapters([{ id: 'a', startSeconds: 0, endSeconds: 1260 }, { id: 'b', startSeconds: 1260, endSeconds: 2700 }], 2700).chapters
    expect(resolveBookmarkTarget(bookmark, shifted, 2700)).toBe(1560)
  })
  it('falls back to the absolute position when the chapter is gone, and stays inside the audio', () => {
    expect(resolveBookmarkTarget(bookmark, [], 2700)).toBe(1500)
    expect(resolveBookmarkTarget({ ...bookmark, positionSeconds: 9999, chapterId: undefined, chapterOffsetSeconds: undefined }, [], 2700)).toBe(2700)
  })
  it('never leaves its chapter when the offset is larger than the chapter now is', () => {
    const shortened = normalizeChapters([{ id: 'a', startSeconds: 0, endSeconds: 1200 }, { id: 'b', startSeconds: 1200, endSeconds: 1300 }], 1300).chapters
    expect(resolveBookmarkTarget(bookmark, shortened, 1300)).toBe(1300)
  })
})

describe('sanitizeAudioBookmarks', () => {
  it('keeps good entries sorted by position, drops garbage and duplicates', () => {
    const raw = [
      { id: 'b', label: 'Later', positionSeconds: 500, createdAt: NOW },
      { id: 'a', label: 'Early', positionSeconds: 10, chapterId: 'c1', chapterOffsetSeconds: 10, createdAt: NOW },
      { id: 'a', label: 'dup', positionSeconds: 99 },
      { id: 'bad1', positionSeconds: -1 },
      { id: 'bad2', positionSeconds: NaN },
      { id: '', positionSeconds: 1 },
      { positionSeconds: 1 },
      null,
      'x',
      { id: 'c', positionSeconds: 1e12 },
    ]
    const out = sanitizeAudioBookmarks(raw)
    expect(out.map((b) => b.id)).toEqual(['a', 'b'])
    expect(out[0]).toMatchObject({ chapterId: 'c1', chapterOffsetSeconds: 10 })
    expect(sanitizeAudioBookmarks('nope')).toEqual([])
    expect(sanitizeAudioBookmarks(undefined)).toEqual([])
  })
  it('caps the list and the label length', () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ id: `i${i}`, positionSeconds: i, label: 'x'.repeat(500) }))
    const out = sanitizeAudioBookmarks(many)
    expect(out).toHaveLength(500)
    expect(out[0]?.label.length).toBe(200)
  })
  it('create → store → restore → delete round trip', () => {
    const a = createAudioBookmark({ id: 'a', positionSeconds: 100, chapters: CH, nowIso: NOW })
    const b = createAudioBookmark({ id: 'b', positionSeconds: 1500, chapters: CH, nowIso: NOW })
    const stored = JSON.parse(JSON.stringify(sanitizeAudioBookmarks([b, a])))
    expect(stored.map((x: { id: string }) => x.id)).toEqual(['a', 'b'])
    const restored = sanitizeAudioBookmarks(stored)
    expect(resolveBookmarkTarget(restored[1]!, CH, 2700)).toBe(1500)
    expect(sanitizeAudioBookmarks(restored.filter((x) => x.id !== 'a')).map((x) => x.id)).toEqual(['b'])
  })
})

describe('audio progress: scope and chapter', () => {
  it('sanitize accepts scope / chapterId, ignores junk', () => {
    expect(sanitizeAudioProgressInput({ positionSeconds: 5, playbackRate: 1, scope: 'chapter', chapterId: 'b' })).toEqual({ positionSeconds: 5, playbackRate: 1, scope: 'chapter', chapterId: 'b' })
    expect(sanitizeAudioProgressInput({ positionSeconds: 5, playbackRate: 1, scope: 'weird', chapterId: 42 })).toEqual({ positionSeconds: 5, playbackRate: 1 })
    expect(sanitizeAudioProgressInput({ positionSeconds: 5, playbackRate: 1, chapterId: null })).toEqual({ positionSeconds: 5, playbackRate: 1, chapterId: null })
  })
  it('patch: scope/chapterId only when given; null clears the stored chapter (merge-patch delete)', () => {
    const p = audioProgressPatch({ positionSeconds: 5, playbackRate: 1, scope: 'book', chapterId: null }, NOW)
    expect(p.audioProgress).toMatchObject({ scope: 'book', chapterId: null })
    const q = audioProgressPatch({ positionSeconds: 5, playbackRate: 1 }, NOW)
    expect('scope' in q.audioProgress).toBe(false)
    expect('chapterId' in q.audioProgress).toBe(false)
  })
  it('parse restores scope and chapter; the position is what restore uses', () => {
    const merged = { fontSize: 18, ...audioProgressPatch({ positionSeconds: 1500, durationSeconds: 2700, playbackRate: 1.25, scope: 'chapter', chapterId: 'b' }, NOW) }
    const parsed = parseAudioProgress(parseReadingState(JSON.stringify(merged)))
    expect(parsed).toMatchObject({ positionSeconds: 1500, scope: 'chapter', chapterId: 'b', playbackRate: 1.25 })
    expect(parseAudioProgress(parseReadingState(JSON.stringify({ audioProgress: { positionSeconds: 1, scope: 'bogus' } })))?.scope).toBeUndefined()
  })
})

/**
 * CHARACTERIZATION GOLDENS (Notes for Multi-Track Audiobooks, task T001).
 * Expected values below were captured from the implementation as it was BEFORE that feature (no `trackId`
 * anywhere). They pin the single-file Notes behaviour of `sanitizeAudioBookmarks` / `createAudioBookmark`
 * and must keep passing, unmodified, after `trackId` support is added.
 */
describe('golden: sanitizeAudioBookmarks without trackId (pre-multi-track-Notes behaviour)', () => {
  const longId = 'long'.padEnd(100, 'x')
  const mixed = [
    { id: ' pad ', label: '  Padded  ', positionSeconds: 30, note: '  hi  ', createdAt: NOW, junk: 1 },
    { id: 'ws', label: '   ', positionSeconds: 61, note: '   ', createdAt: 5 },
    { id: longId, positionSeconds: 0 },
    { id: 'too'.padEnd(101, 'y'), positionSeconds: 1 },
    { id: 'max', positionSeconds: 10_000_000, createdAt: 'z'.repeat(60) },
    { id: 'over', positionSeconds: 10_000_001 },
    { id: 'inf', positionSeconds: Infinity },
    { id: 'str', positionSeconds: '5' },
    { id: 'chOK', positionSeconds: 100, chapterId: 'c1', chapterOffsetSeconds: 40.5 },
    { id: 'chNeg', positionSeconds: 101, chapterId: 'c1', chapterOffsetSeconds: -1 },
    { id: 'chBig', positionSeconds: 102, chapterId: 'c'.repeat(101), chapterOffsetSeconds: 1 },
    { id: 'chNoOff', positionSeconds: 103, chapterId: 'c2' },
    { id: 'offOnly', positionSeconds: 104, chapterOffsetSeconds: 3 },
    { id: 'tie1', positionSeconds: 200, label: 'first' },
    { id: 'tie2', positionSeconds: 200, label: 'second' },
    { id: 'noteLong', positionSeconds: 300, note: 'n'.repeat(2500) },
    { id: 'ws', positionSeconds: 7, label: 'dup-of-ws' },
  ]

  it('garbage, whitespace, ranges, chapter refs, ties and unknown keys: exact output', () => {
    expect(sanitizeAudioBookmarks(mixed)).toEqual([
      { id: longId, label: 'Bookmark at 0:00', positionSeconds: 0, createdAt: '' },
      { id: ' pad ', label: 'Padded', positionSeconds: 30, createdAt: NOW, note: 'hi' },
      { id: 'ws', label: 'Bookmark at 1:01', positionSeconds: 61, createdAt: '' },
      { id: 'chOK', label: 'Bookmark at 1:40', positionSeconds: 100, createdAt: '', chapterId: 'c1', chapterOffsetSeconds: 40.5 },
      { id: 'chNeg', label: 'Bookmark at 1:41', positionSeconds: 101, createdAt: '', chapterId: 'c1' },
      { id: 'chBig', label: 'Bookmark at 1:42', positionSeconds: 102, createdAt: '' },
      { id: 'chNoOff', label: 'Bookmark at 1:43', positionSeconds: 103, createdAt: '', chapterId: 'c2' },
      { id: 'offOnly', label: 'Bookmark at 1:44', positionSeconds: 104, createdAt: '' },
      { id: 'tie1', label: 'first', positionSeconds: 200, createdAt: '' },
      { id: 'tie2', label: 'second', positionSeconds: 200, createdAt: '' },
      { id: 'noteLong', label: 'Bookmark at 5:00', positionSeconds: 300, createdAt: '', note: 'n'.repeat(2000) },
      { id: 'max', label: 'Bookmark at 2777:46:40', positionSeconds: 10_000_000, createdAt: 'z'.repeat(40) },
    ])
  })

  it('key order of an emitted entry is stable (it is what is written to the stored JSON)', () => {
    const [first] = sanitizeAudioBookmarks([{ id: 'k', positionSeconds: 5, note: 'n', chapterId: 'c', chapterOffsetSeconds: 1, createdAt: NOW, label: 'L' }])
    expect(Object.keys(first!)).toEqual(['id', 'label', 'positionSeconds', 'createdAt', 'note', 'chapterId', 'chapterOffsetSeconds'])
  })

  it('over the cap: the FIRST 500 in INPUT order are kept, then sorted by position', () => {
    const rev = Array.from({ length: 600 }, (_, i) => ({ id: `i${i}`, positionSeconds: 599 - i }))
    const out = sanitizeAudioBookmarks(rev)
    expect(out).toHaveLength(500)
    expect([out[0]!.id, out[0]!.positionSeconds, out[499]!.id, out[499]!.positionSeconds]).toEqual(['i499', 100, 'i0', 599])
    expect(out.some((b) => b.id === 'i500')).toBe(false)
  })

  it('duplicates are removed BEFORE the cap counts (first occurrence wins)', () => {
    const dups = [
      ...Array.from({ length: 3 }, () => ({ id: 'd', positionSeconds: 1 })),
      ...Array.from({ length: 520 }, (_, i) => ({ id: `u${i}`, positionSeconds: i })),
    ]
    const out = sanitizeAudioBookmarks(dups)
    expect(out).toHaveLength(500)
    expect(out.filter((b) => b.id === 'd')).toHaveLength(1)
    expect(out.some((b) => b.id === 'u498')).toBe(true)
    expect(out.some((b) => b.id === 'u499')).toBe(false)
  })

  it('is idempotent (the IPC handler and the store both sanitize)', () => {
    const rev = Array.from({ length: 600 }, (_, i) => ({ id: `i${i}`, positionSeconds: 599 - i }))
    expect(sanitizeAudioBookmarks(sanitizeAudioBookmarks(mixed))).toEqual(sanitizeAudioBookmarks(mixed))
    expect(sanitizeAudioBookmarks(sanitizeAudioBookmarks(rev))).toEqual(sanitizeAudioBookmarks(rev))
  })

  it('non-array input gives []', () => {
    for (const bad of [null, {}, 5, 'x', undefined]) expect(sanitizeAudioBookmarks(bad)).toEqual([])
  })
})

describe('golden: createAudioBookmark without trackId (pre-multi-track-Notes behaviour)', () => {
  const make = (positionSeconds: number) => createAudioBookmark({ id: 'x', positionSeconds, chapters: CH, nowIso: NOW })

  it('chapter boundaries and out-of-range positions', () => {
    expect(make(0)).toEqual({ id: 'x', label: 'One · 0:00', positionSeconds: 0, createdAt: NOW, chapterId: 'a', chapterOffsetSeconds: 0 })
    expect(make(1199.999)).toEqual({ id: 'x', label: 'One · 19:59', positionSeconds: 1199.999, createdAt: NOW, chapterId: 'a', chapterOffsetSeconds: 1199.999 })
    expect(make(1200)).toEqual({ id: 'x', label: 'Two · 20:00', positionSeconds: 1200, createdAt: NOW, chapterId: 'b', chapterOffsetSeconds: 0 })
    expect(make(2700)).toEqual({ id: 'x', label: 'Two · 45:00', positionSeconds: 2700, createdAt: NOW, chapterId: 'b', chapterOffsetSeconds: 1500 })
    expect(make(2701)).toEqual({ id: 'x', label: 'Bookmark at 45:01', positionSeconds: 2701, createdAt: NOW })
    expect(make(3725.5)).toEqual({ id: 'x', label: 'Bookmark at 1:02:05', positionSeconds: 3725.5, createdAt: NOW })
    expect(make(10_000_001)).toEqual({ id: 'x', label: 'Bookmark at 2777:46:41', positionSeconds: 10_000_001, createdAt: NOW })
  })

  it('negative, NaN and Infinity positions become 0', () => {
    for (const bad of [-5, NaN, Infinity]) {
      expect(make(bad)).toEqual({ id: 'x', label: 'One · 0:00', positionSeconds: 0, createdAt: NOW, chapterId: 'a', chapterOffsetSeconds: 0 })
    }
  })

  it('label is trimmed and capped at 200, note is trimmed and capped at 2000, blank label / note fall back / disappear', () => {
    const long = createAudioBookmark({ id: 'x', positionSeconds: 1500, chapters: [], nowIso: NOW, label: 'L'.repeat(300), note: `  ${'q'.repeat(2500)}` })
    expect(long).toEqual({ id: 'x', label: 'L'.repeat(200), positionSeconds: 1500, createdAt: NOW, note: 'q'.repeat(2000) })
    const blank = createAudioBookmark({ id: 'x', positionSeconds: 5, chapters: [], nowIso: NOW, label: '   ', note: '   ' })
    expect(blank).toEqual({ id: 'x', label: 'Bookmark at 0:05', positionSeconds: 5, createdAt: NOW })
    expect('note' in blank).toBe(false)
  })
})

describe('trackId (multi-track Notes)', () => {
  it('sanitize keeps a valid trackId (non-empty, at most 100 characters) and drops anything else', () => {
    const ok = sanitizeAudioBookmarks([{ id: 'a', positionSeconds: 1, trackId: 'track-1' }])
    expect(ok[0]?.trackId).toBe('track-1')
    expect(sanitizeAudioBookmarks([{ id: 'a', positionSeconds: 1, trackId: 't'.repeat(100) }])[0]?.trackId).toHaveLength(100)
    for (const bad of ['', 't'.repeat(101), 5, null, {}, ['x']]) {
      const out = sanitizeAudioBookmarks([{ id: 'a', positionSeconds: 1, trackId: bad }])
      expect(out).toHaveLength(1)
      expect('trackId' in out[0]!).toBe(false)
    }
  })
  it('sanitize round trip through JSON keeps trackId on a track Note and never invents one', () => {
    const a = createAudioBookmark({ id: 'a', positionSeconds: 5, chapters: [], nowIso: NOW, trackId: 't1', trackNumber: 3 })
    const b = createAudioBookmark({ id: 'b', positionSeconds: 6, chapters: [], nowIso: NOW })
    const back = sanitizeAudioBookmarks(JSON.parse(JSON.stringify(sanitizeAudioBookmarks([a, b]))))
    expect(back.find((n) => n.id === 'a')?.trackId).toBe('t1')
    expect('trackId' in back.find((n) => n.id === 'b')!).toBe(false)
  })
  it('createAudioBookmark with trackId: trackId set, no chapter reference even when chapters are given, default label "Track N · m:ss"', () => {
    const n = createAudioBookmark({ id: 'x', positionSeconds: 1500, chapters: CH, nowIso: NOW, trackId: 't9', trackNumber: 12 })
    expect(n).toEqual({ id: 'x', label: 'Track 12 · 25:00', positionSeconds: 1500, createdAt: NOW, trackId: 't9' })
    expect('chapterId' in n).toBe(false)
    expect('chapterOffsetSeconds' in n).toBe(false)
  })
  it('createAudioBookmark with trackId: custom label wins, note is normalised, garbage position becomes 0, bad trackNumber falls back to the neutral label', () => {
    const n = createAudioBookmark({ id: 'x', positionSeconds: NaN, chapters: [], nowIso: NOW, trackId: 't', trackNumber: 2, label: '  Mine ', note: '  hi ' })
    expect(n).toEqual({ id: 'x', label: 'Mine', positionSeconds: 0, createdAt: NOW, trackId: 't', note: 'hi' })
    expect(createAudioBookmark({ id: 'x', positionSeconds: 65, chapters: [], nowIso: NOW, trackId: 't', trackNumber: 0 }).label).toBe('Bookmark at 1:05')
    expect(createAudioBookmark({ id: 'x', positionSeconds: 65, chapters: [], nowIso: NOW, trackId: 't' }).label).toBe('Bookmark at 1:05')
  })
  it('createAudioBookmark with an empty trackId behaves like a single-file Note', () => {
    expect(createAudioBookmark({ id: 'x', positionSeconds: 1500, chapters: CH, nowIso: NOW, trackId: '' })).toEqual(createAudioBookmark({ id: 'x', positionSeconds: 1500, chapters: CH, nowIso: NOW }))
  })
})
