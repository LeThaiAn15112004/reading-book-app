import { describe, expect, it } from 'vitest'
import { MAX_AUDIO_BOOKMARKS, type AudioBookmark } from '../../src/audio/audio-bookmarks'
import { RESTART_NEAR_END_SECONDS } from '../../src/audio/audio-playback'
import {
  canAddAnotherNote,
  groupNotesByTrack,
  notesForTrack,
  orderTrackNotes,
  trackNoteJumpTarget,
  trackNoteLabel,
} from '../../src/audio/audio-track-notes'
import type { AudioTrack } from '../../src/audio/audio-tracks'

const TRACKS: AudioTrack[] = [
  { id: 't1', title: 'Intro', durationSeconds: 100 },
  { id: 't2', title: 'Same title', durationSeconds: 200 },
  { id: 't3', title: 'Same title', durationSeconds: null },
]
const note = (id: string, trackId: string | undefined, positionSeconds: number, createdAt = '2026-01-01T00:00:00Z'): AudioBookmark => ({
  id,
  label: id,
  positionSeconds,
  createdAt,
  ...(trackId === undefined ? {} : { trackId }),
})

describe('orderTrackNotes', () => {
  it('orders by track index, then position, then createdAt, regardless of input order', () => {
    const input = [
      note('c', 't3', 5),
      note('b2', 't2', 30, '2026-01-01T00:00:09Z'),
      note('b1', 't2', 30, '2026-01-01T00:00:01Z'),
      note('b0', 't2', 10),
      note('a', 't1', 99),
    ]
    expect(orderTrackNotes(input, TRACKS).map((n) => n.id)).toEqual(['a', 'b0', 'b1', 'b2', 'c'])
  })

  it('orders by the track LIST, not by the id text', () => {
    const reversed: AudioTrack[] = [TRACKS[2]!, TRACKS[1]!, TRACKS[0]!]
    expect(orderTrackNotes([note('x', 't1', 1), note('y', 't3', 1)], reversed).map((n) => n.id)).toEqual(['y', 'x'])
  })

  it('is stable: two Notes at the same second with the same creation time keep their input order', () => {
    const a = note('first', 't1', 10)
    const b = note('second', 't1', 10)
    expect(orderTrackNotes([a, b], TRACKS).map((n) => n.id)).toEqual(['first', 'second'])
    expect(orderTrackNotes([b, a], TRACKS).map((n) => n.id)).toEqual(['second', 'first'])
  })

  it('excludes Notes without a trackId (single-file Notes) and Notes of an unknown track', () => {
    const out = orderTrackNotes([note('single', undefined, 1), note('orphan', 'gone', 1), note('ok', 't1', 1)], TRACKS)
    expect(out.map((n) => n.id)).toEqual(['ok'])
  })

  it('does not mutate its inputs', () => {
    const input = [note('b', 't2', 1), note('a', 't1', 1)]
    const snapshot = JSON.stringify(input)
    const tracksSnapshot = JSON.stringify(TRACKS)
    orderTrackNotes(input, TRACKS)
    expect(JSON.stringify(input)).toBe(snapshot)
    expect(JSON.stringify(TRACKS)).toBe(tracksSnapshot)
  })
})

describe('notesForTrack', () => {
  const all = [note('a', 't1', 1), note('b', 't2', 1), note('c', 't1', 2), note('s', undefined, 3)]
  it('returns only the Notes of that track, in input order', () => {
    expect(notesForTrack(all, 't1').map((n) => n.id)).toEqual(['a', 'c'])
  })
  it('unknown or empty track id gives []; single-file Notes are never returned', () => {
    expect(notesForTrack(all, 'nope')).toEqual([])
    expect(notesForTrack(all, '')).toEqual([])
    expect(notesForTrack([note('s', undefined, 3)], 't1')).toEqual([])
  })
  it('does not mutate its input', () => {
    const snapshot = JSON.stringify(all)
    notesForTrack(all, 't1')
    expect(JSON.stringify(all)).toBe(snapshot)
  })
})

describe('trackNoteLabel', () => {
  it('is "N · title" with the 1-based number and the live title', () => {
    expect(trackNoteLabel(note('a', 't1', 1), TRACKS)).toBe('1 · Intro')
    expect(trackNoteLabel(note('a', 't2', 1), TRACKS)).toBe('2 · Same title')
  })
  it('distinguishes duplicate titles by number', () => {
    expect(trackNoteLabel(note('a', 't2', 1), TRACKS)).not.toBe(trackNoteLabel(note('b', 't3', 1), TRACKS))
  })
  it('follows a changed title (derived from the live list, not stored)', () => {
    const renamed: AudioTrack[] = [{ ...TRACKS[0]!, title: 'Renamed' }, TRACKS[1]!, TRACKS[2]!]
    expect(trackNoteLabel(note('a', 't1', 1), renamed)).toBe('1 · Renamed')
  })
  it('is null for no trackId or a track that is not in the list', () => {
    expect(trackNoteLabel(note('a', undefined, 1), TRACKS)).toBeNull()
    expect(trackNoteLabel(note('a', 'gone', 1), TRACKS)).toBeNull()
  })
})

describe('trackNoteJumpTarget', () => {
  it('maps the Note to its track index and second (same or other track alike)', () => {
    expect(trackNoteJumpTarget(note('a', 't1', 42), TRACKS)).toEqual({ index: 0, seconds: 42 })
    expect(trackNoteJumpTarget(note('a', 't2', 7.5), TRACKS)).toEqual({ index: 1, seconds: 7.5 })
  })
  it('is null for an unknown track or a Note without trackId', () => {
    expect(trackNoteJumpTarget(note('a', 'gone', 5), TRACKS)).toBeNull()
    expect(trackNoteJumpTarget(note('a', undefined, 5), TRACKS)).toBeNull()
  })
  it('clamps a position beyond the known duration to the end of the track', () => {
    expect(trackNoteJumpTarget(note('a', 't1', 500), TRACKS)).toEqual({ index: 0, seconds: 100 })
  })
  it('keeps a position in the last seconds EXACTLY (no "restart near the end")', () => {
    const near = 100 - (RESTART_NEAR_END_SECONDS - 1)
    expect(trackNoteJumpTarget(note('a', 't1', near), TRACKS)).toEqual({ index: 0, seconds: near })
    expect(trackNoteJumpTarget(note('a', 't1', 99), TRACKS)?.seconds).toBe(99)
  })
  it('unknown duration: the position is kept, floored at 0', () => {
    expect(trackNoteJumpTarget(note('a', 't3', 12345), TRACKS)).toEqual({ index: 2, seconds: 12345 })
  })
  it('a negative or non-finite position gives 0', () => {
    for (const bad of [-3, NaN, Infinity, -Infinity]) {
      expect(trackNoteJumpTarget(note('a', 't1', bad), TRACKS)).toEqual({ index: 0, seconds: 0 })
      expect(trackNoteJumpTarget(note('a', 't3', bad), TRACKS)).toEqual({ index: 2, seconds: 0 })
    }
  })
  it('does not mutate its inputs', () => {
    const n = note('a', 't1', 500)
    const snapshot = JSON.stringify(n)
    trackNoteJumpTarget(n, TRACKS)
    expect(JSON.stringify(n)).toBe(snapshot)
  })
})

describe('canAddAnotherNote', () => {
  it('is true below the cap and false at and above it', () => {
    expect(MAX_AUDIO_BOOKMARKS).toBe(500)
    expect(canAddAnotherNote(0)).toBe(true)
    expect(canAddAnotherNote(499)).toBe(true)
    expect(canAddAnotherNote(500)).toBe(false)
    expect(canAddAnotherNote(501)).toBe(false)
  })
  it('refuses a non-finite count (never allows an unknown state)', () => {
    expect(canAddAnotherNote(NaN)).toBe(false)
  })
})

describe('groupNotesByTrack', () => {
  it('no Notes gives no groups', () => {
    expect(groupNotesByTrack([], TRACKS)).toEqual([])
  })

  it('only tracks that have Notes get a group, in track order whatever the input order', () => {
    const input = [note('c', 't3', 5), note('a', 't1', 9)]
    const groups = groupNotesByTrack(input, TRACKS)
    expect(groups.map((g) => [g.trackId, g.index, g.track.title, g.count])).toEqual([
      ['t1', 0, 'Intro', 1],
      ['t3', 2, 'Same title', 1],
    ])
    expect(groups.some((g) => g.trackId === 't2')).toBe(false)
  })

  it('orders Notes inside a group by second, then creation time, then input order', () => {
    const input = [
      note('late', 't2', 30, '2026-01-01T00:00:09Z'),
      note('early', 't2', 30, '2026-01-01T00:00:01Z'),
      note('first', 't2', 10),
      note('tieA', 't2', 50),
      note('tieB', 't2', 50),
    ]
    const [group] = groupNotesByTrack(input, TRACKS)
    expect(group!.notes.map((n) => n.id)).toEqual(['first', 'early', 'late', 'tieA', 'tieB'])
    expect(group!.count).toBe(5)
  })

  it('count equals notes.length and is never 0', () => {
    for (const g of groupNotesByTrack([note('a', 't1', 1), note('b', 't1', 2), note('c', 't2', 3)], TRACKS)) {
      expect(g.count).toBe(g.notes.length)
      expect(g.count).toBeGreaterThan(0)
    }
  })

  it('every Note of a known track appears in exactly one group; single-file and unknown-track Notes in none', () => {
    const input = [
      note('a', 't1', 1),
      note('b', 't2', 2),
      note('c', 't2', 3),
      note('single', undefined, 4),
      note('orphan', 'gone', 5),
      note('d', 't3', 6),
    ]
    const groups = groupNotesByTrack(input, TRACKS)
    const ids = groups.flatMap((g) => g.notes.map((n) => n.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(groups.reduce((sum, g) => sum + g.count, 0)).toBe(4)
  })

  it('a repeated track id in the list counts once (the first occurrence defines the track)', () => {
    const dup: AudioTrack[] = [TRACKS[0]!, { id: 't1', title: 'Again', durationSeconds: 5 }, TRACKS[1]!]
    const groups = groupNotesByTrack([note('a', 't1', 1), note('b', 't2', 2)], dup)
    expect(groups.map((g) => [g.trackId, g.index, g.track.title])).toEqual([
      ['t1', 0, 'Intro'],
      ['t2', 2, 'Same title'],
    ])
  })

  it('tracks with the same title are separate groups told apart by index', () => {
    const groups = groupNotesByTrack([note('a', 't2', 1), note('b', 't3', 1)], TRACKS)
    expect(groups.map((g) => [g.track.title, g.index])).toEqual([['Same title', 1], ['Same title', 2]])
  })

  it('does not mutate its inputs', () => {
    const input = [note('b', 't2', 1), note('a', 't1', 1)]
    const before = JSON.stringify(input)
    const tracksBefore = JSON.stringify(TRACKS)
    const groups = groupNotesByTrack(input, TRACKS)
    expect(JSON.stringify(input)).toBe(before)
    expect(JSON.stringify(TRACKS)).toBe(tracksBefore)
    expect(groups[0]!.notes).not.toBe(input)
  })

  it('groups 500 Notes over 68 tracks and 500 Notes in one track correctly', () => {
    const many: AudioTrack[] = Array.from({ length: 68 }, (_, i) => ({ id: `t${i}`, title: `Title ${i}`, durationSeconds: 600 }))
    const spread = Array.from({ length: 500 }, (_, i) => note(`n${i}`, `t${i % 68}`, (i * 7) % 600))
    const groups = groupNotesByTrack(spread, many)
    expect(groups).toHaveLength(68)
    expect(groups.reduce((sum, g) => sum + g.count, 0)).toBe(500)
    expect(groups.map((g) => g.index)).toEqual(Array.from({ length: 68 }, (_, i) => i))
    for (const g of groups) expect(g.notes.map((n) => n.positionSeconds)).toEqual([...g.notes.map((n) => n.positionSeconds)].sort((a, b) => a - b))
    const one = groupNotesByTrack(Array.from({ length: 500 }, (_, i) => note(`m${i}`, 't5', 500 - i)), many)
    expect(one).toHaveLength(1)
    expect([one[0]!.count, one[0]!.index, one[0]!.notes[0]!.positionSeconds]).toEqual([500, 5, 1])
  })
})
