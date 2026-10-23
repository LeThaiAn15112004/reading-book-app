import { describe, expect, it } from 'vitest'
import {
  absoluteFromScoped,
  chapterIndexAt,
  chapterStart,
  nextChapterTarget,
  normalizeChapters,
  previousChapterTarget,
  timelineView,
  type AudioChapter,
} from '../../src/audio/audio-timeline'

const MIN = 60
/** 3 chapters of a 60-minute book: [0,20) [20,45) [45,60). Deterministic fixture. */
const RAW = [
  { id: 'a', title: 'One', startSeconds: 0, endSeconds: 20 * MIN },
  { id: 'b', title: 'Two', startSeconds: 20 * MIN, endSeconds: 45 * MIN },
  { id: 'c', title: 'Three', startSeconds: 45 * MIN, endSeconds: 60 * MIN },
]
const DURATION = 60 * MIN
const ok = (raw: unknown, duration: unknown = DURATION) => normalizeChapters(raw, duration)
const CH = ok(RAW).chapters as AudioChapter[]

describe('normalizeChapters', () => {
  it('accepts a contiguous, ordered list inside the duration', () => {
    const r = ok(RAW)
    expect(r.status).toBe('ok')
    expect(r.chapters).toEqual([
      { id: 'a', title: 'One', startSeconds: 0, endSeconds: 1200 },
      { id: 'b', title: 'Two', startSeconds: 1200, endSeconds: 2700 },
      { id: 'c', title: 'Three', startSeconds: 2700, endSeconds: 3600 },
    ])
  })

  it('start-only sources: each chapter ends where the next starts, the last at the duration', () => {
    const r = ok([{ startSeconds: 0 }, { startSeconds: 100 }, { startSeconds: 250, endSeconds: null }], 400)
    expect(r.status).toBe('ok')
    expect(r.chapters.map((c) => [c.startSeconds, c.endSeconds])).toEqual([[0, 100], [100, 250], [250, 400]])
    expect(r.chapters.map((c) => c.id)).toEqual(['ch-1', 'ch-2', 'ch-3'])
    expect(r.chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3'])
  })

  it('no list → none (a single MP3 is never assumed to have chapters)', () => {
    for (const raw of [undefined, null, []]) expect(ok(raw)).toEqual({ status: 'none', chapters: [] })
  })

  it('duration unknown → pending, nothing shown yet', () => {
    for (const d of [NaN, Infinity, 0, undefined]) expect(normalizeChapters(RAW, d)).toEqual({ status: 'pending-duration', chapters: [] })
  })

  it('snaps sub-second rounding at the edges and between chapters', () => {
    const r = ok([{ startSeconds: 0.4, endSeconds: 99.6 }, { startSeconds: 100, endSeconds: 200.5 }], 200)
    expect(r.status).toBe('ok')
    expect(r.chapters[0]).toMatchObject({ startSeconds: 0, endSeconds: 100 })
    expect(r.chapters[1]).toMatchObject({ startSeconds: 100, endSeconds: 200 })
  })

  const invalid = (raw: unknown, duration: unknown = DURATION) => {
    const r = ok(raw, duration)
    expect(r.status).toBe('invalid')
    expect(r.chapters).toEqual([])
    expect(r.reason).toBeTruthy()
  }
  it('rejects the whole list for any untrustworthy entry', () => {
    invalid('nope')
    invalid({})
    invalid([null])
    invalid([{ startSeconds: NaN }])
    invalid([{ startSeconds: -5 }])
    invalid([{ startSeconds: 0 }, { startSeconds: Infinity }])
    invalid([{ startSeconds: 0, endSeconds: 'x' }])
    invalid([{ startSeconds: 0, endSeconds: -1 }])
  })
  it('rejects unordered / duplicate starts', () => {
    invalid([{ startSeconds: 0 }, { startSeconds: 300 }, { startSeconds: 200 }])
    invalid([{ startSeconds: 0 }, { startSeconds: 100 }, { startSeconds: 100 }])
  })
  it('rejects overlaps and gaps bigger than the snap tolerance', () => {
    invalid([{ startSeconds: 0, endSeconds: 150 }, { startSeconds: 100, endSeconds: 300 }], 300) // overlap
    invalid([{ startSeconds: 0, endSeconds: 80 }, { startSeconds: 100, endSeconds: 300 }], 300) // gap
  })
  it('rejects chapters outside the real duration', () => {
    invalid([{ startSeconds: 0 }, { startSeconds: 500 }], 400) // starts after the end
    invalid([{ startSeconds: 0, endSeconds: 100 }, { startSeconds: 100, endSeconds: 900 }], 400) // ends far past it
    invalid([{ startSeconds: 0, endSeconds: 100 }, { startSeconds: 100, endSeconds: 200 }], 400) // stops far short
    invalid([{ startSeconds: 60 }, { startSeconds: 100 }], 400) // first chapter not at the beginning
  })
  it('duplicate ids are made unique; titles trimmed; an empty title becomes a position label', () => {
    const r = ok([{ id: 'x', title: '  Intro  ', startSeconds: 0 }, { id: 'x', title: '', startSeconds: 50 }], 100)
    expect(r.chapters.map((c) => c.id)).toEqual(['x', 'x#2'])
    expect(r.chapters.map((c) => c.title)).toEqual(['Intro', 'Chapter 2'])
  })
})

describe('chapterIndexAt', () => {
  it('finds the chapter by [start, end); the very end belongs to the last', () => {
    expect(chapterIndexAt(CH, 0)).toBe(0)
    expect(chapterIndexAt(CH, 1199.9)).toBe(0)
    expect(chapterIndexAt(CH, 1200)).toBe(1)
    expect(chapterIndexAt(CH, 2699)).toBe(1)
    expect(chapterIndexAt(CH, 2700)).toBe(2)
    expect(chapterIndexAt(CH, 3600)).toBe(2)
  })
  it('no chapter for garbage, negative or past-the-end positions, or an empty list', () => {
    for (const p of [-1, NaN, Infinity, 3601, undefined]) expect(chapterIndexAt(CH, p)).toBe(-1)
    expect(chapterIndexAt([], 10)).toBe(-1)
  })
})

describe('timelineView — Book scope', () => {
  it('whole-audio range: elapsed from the start, remaining to the end', () => {
    const v = timelineView('book', 25 * MIN, DURATION, CH)!
    expect(v).toMatchObject({ scope: 'book', startSeconds: 0, endSeconds: 3600, positionSeconds: 1500, durationSeconds: 3600, remainingSeconds: 2100, chapterIndex: 1 })
    expect(v.fraction).toBeCloseTo(1500 / 3600)
  })
  it('stays correct as the chapter changes (position keeps counting from the book start)', () => {
    expect(timelineView('book', 19 * MIN, DURATION, CH)!.positionSeconds).toBe(19 * MIN)
    expect(timelineView('book', 21 * MIN, DURATION, CH)!.positionSeconds).toBe(21 * MIN)
    expect(timelineView('book', 21 * MIN, DURATION, CH)!.chapterIndex).toBe(1)
  })
  it('single file without chapters works in Book scope; Chapter scope falls back to it', () => {
    const b = timelineView('book', 100, 400, [])!
    expect(b).toMatchObject({ scope: 'book', positionSeconds: 100, durationSeconds: 400, remainingSeconds: 300, chapterIndex: -1 })
    expect(timelineView('chapter', 100, 400, [])).toEqual(b)
  })
  it('unknown / invalid duration → no view; position is clamped into the audio', () => {
    for (const d of [NaN, Infinity, 0, -1, undefined]) expect(timelineView('book', 10, d, CH)).toBeNull()
    expect(timelineView('book', 9999, 400, [])!.positionSeconds).toBe(400)
    expect(timelineView('book', -5, 400, [])!.positionSeconds).toBe(0)
    expect(timelineView('book', NaN, 400, [])!.positionSeconds).toBe(0)
  })
})

describe('timelineView — Chapter scope (the example from the spec)', () => {
  it('a chapter starting at 20:00 with 5:00 listened → Book 25:00, Chapter 5:00', () => {
    const position = 25 * MIN
    const book = timelineView('book', position, DURATION, CH)!
    const chapter = timelineView('chapter', position, DURATION, CH)!
    expect(book.positionSeconds).toBe(25 * MIN)
    expect(chapter.positionSeconds).toBe(5 * MIN)
    expect(chapter).toMatchObject({ scope: 'chapter', startSeconds: 1200, endSeconds: 2700, durationSeconds: 25 * MIN, remainingSeconds: 20 * MIN, chapterIndex: 1 })
    expect(chapter.fraction).toBeCloseTo(5 / 25)
    expect(chapter.maxSeekSeconds).toBeCloseTo(25 * MIN - 0.1)
    expect(book.positionSeconds).not.toBe(chapter.positionSeconds)
  })
  it('switching scope never changes the canonical position', () => {
    for (const p of [0, 1, 1199.99, 1200, 1500, 2699, 2700, 3599, 3600]) {
      const b = timelineView('book', p, DURATION, CH)!
      const c = timelineView('chapter', p, DURATION, CH)!
      expect(b.startSeconds + b.positionSeconds).toBeCloseTo(p)
      expect(c.startSeconds + c.positionSeconds).toBeCloseTo(p) // same absolute position from both views
    }
  })
  it('changing chapter re-bases the chapter timeline', () => {
    const before = timelineView('chapter', 20 * MIN - 1, DURATION, CH)!
    const after = timelineView('chapter', 20 * MIN + 1, DURATION, CH)!
    expect(before.chapterIndex).toBe(0)
    expect(before.remainingSeconds).toBe(1)
    expect(after.chapterIndex).toBe(1)
    expect(after.positionSeconds).toBe(1)
    expect(after.durationSeconds).toBe(25 * MIN)
  })
  it('chapter boundaries: the very end of the book is inside the last chapter', () => {
    const v = timelineView('chapter', 3600, DURATION, CH)!
    expect(v).toMatchObject({ chapterIndex: 2, positionSeconds: 15 * MIN, remainingSeconds: 0 })
    expect(v.fraction).toBe(1)
  })
})

describe('absoluteFromScoped — seeking maps to the canonical timeline', () => {
  it('Book scope: relative = absolute', () => {
    const v = timelineView('book', 100, DURATION, CH)!
    expect(absoluteFromScoped(v, 1800)).toBe(1800)
    expect(absoluteFromScoped(v, 99999)).toBe(3600)
    expect(absoluteFromScoped(v, -4)).toBe(0)
  })
  it('Chapter scope: 10:00 into chapter two is 30:00 of the book, and can never leave the chapter', () => {
    const v = timelineView('chapter', 25 * MIN, DURATION, CH)!
    expect(absoluteFromScoped(v, 10 * MIN)).toBe(30 * MIN)
    expect(absoluteFromScoped(v, 0)).toBe(20 * MIN)
    // the chapter's own end is the next chapter's start: a seek stops just short of it
    expect(absoluteFromScoped(v, 25 * MIN)).toBeCloseTo(45 * MIN - 0.1)
    expect(absoluteFromScoped(v, 9999 * MIN)).toBeCloseTo(45 * MIN - 0.1)
    expect(timelineView('chapter', absoluteFromScoped(v, 9999 * MIN), DURATION, CH)!.chapterIndex).toBe(1)
    // the last chapter may be seeked to the very end of the book
    const last = timelineView('chapter', 50 * MIN, DURATION, CH)!
    expect(absoluteFromScoped(last, 9999 * MIN)).toBe(60 * MIN)
    expect(absoluteFromScoped(v, -50)).toBe(20 * MIN)
    expect(absoluteFromScoped(v, NaN)).toBe(20 * MIN)
  })
})

describe('chapter navigation', () => {
  it('previous: restart the chapter when more than 3 s in, otherwise go to the previous chapter', () => {
    expect(previousChapterTarget(CH, 25 * MIN)).toBe(20 * MIN)
    expect(previousChapterTarget(CH, 20 * MIN + 2)).toBe(0)
    expect(previousChapterTarget(CH, 2)).toBe(0) // first chapter: restart it
    expect(previousChapterTarget(CH, 9999)).toBeNull()
    expect(previousChapterTarget([], 10)).toBeNull()
  })
  it('next: the following chapter start; none on the last chapter', () => {
    expect(nextChapterTarget(CH, 5)).toBe(20 * MIN)
    expect(nextChapterTarget(CH, 25 * MIN)).toBe(45 * MIN)
    expect(nextChapterTarget(CH, 50 * MIN)).toBeNull()
    expect(nextChapterTarget([], 10)).toBeNull()
  })
  it('chapterStart by id', () => {
    expect(chapterStart(CH, 'b')).toBe(20 * MIN)
    expect(chapterStart(CH, 'zzz')).toBeNull()
  })
})
