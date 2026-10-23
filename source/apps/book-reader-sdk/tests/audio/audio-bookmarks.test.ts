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
