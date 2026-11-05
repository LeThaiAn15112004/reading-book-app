import { describe, expect, it } from 'vitest'
import {
  MAX_NOTE_CHARS,
  createAudioBookmark,
  noteMarkerFraction,
  sanitizeAudioBookmarks,
  updateAudioBookmarkNote,
} from '../../src/audio/audio-bookmarks'

const NOW = '2026-10-22T10:00:00.000Z'
const make = (id: string, position: number, note?: string) =>
  createAudioBookmark({ id, positionSeconds: position, chapters: [], nowIso: NOW, note })

describe('audio notes: create / edit / delete', () => {
  it('a note without text is a valid marker; text is trimmed and capped', () => {
    expect(make('a', 10).note).toBeUndefined()
    expect(make('a', 10, '   ').note).toBeUndefined()
    expect(make('a', 10, '  hi  ').note).toBe('hi')
    expect(make('a', 10, 'x'.repeat(5000)).note).toHaveLength(MAX_NOTE_CHARS)
  })

  it('the text survives the store / load round trip', () => {
    const stored = JSON.parse(JSON.stringify([make('a', 10, 'first'), make('b', 20)]))
    const back = sanitizeAudioBookmarks(stored)
    expect(back.map((n) => n.note)).toEqual(['first', undefined])
    expect(sanitizeAudioBookmarks([{ id: 'x', positionSeconds: 1, note: 42 }])[0]?.note).toBeUndefined()
  })

  it('editing changes only the text: same id, same position, no duplicate', () => {
    const list = [make('a', 10, 'one'), make('b', 20)]
    const edited = updateAudioBookmarkNote(list, 'b', ' second ')
    expect(edited).toHaveLength(2)
    expect(edited.map((n) => n.id)).toEqual(['a', 'b'])
    expect(edited[1]).toMatchObject({ id: 'b', positionSeconds: 20, note: 'second', createdAt: NOW })
    expect(edited[0]).toBe(list[0]) // untouched notes are the same objects
    expect(list[1]?.note).toBeUndefined() // the input is not mutated
    expect(sanitizeAudioBookmarks(edited)).toHaveLength(2)
  })

  it('clearing the text keeps the note as a plain marker; an unknown id changes nothing', () => {
    const list = [make('a', 10, 'one')]
    const cleared = updateAudioBookmarkNote(list, 'a', '  ')
    expect(cleared).toHaveLength(1)
    expect('note' in cleared[0]!).toBe(false)
    expect(updateAudioBookmarkNote(list, 'nope', 'x')).toEqual(list)
  })
})

describe('noteMarkerFraction: timestamp → timeline position', () => {
  it('whole-audio timeline: position / duration', () => {
    expect(noteMarkerFraction(0, 200)).toBe(0)
    expect(noteMarkerFraction(50, 200)).toBe(0.25)
    expect(noteMarkerFraction(200, 200)).toBe(1)
  })

  it('a position a hair past the end (rounding) is clamped onto it; further out is invalid', () => {
    expect(noteMarkerFraction(200.6, 200)).toBe(1)
    expect(noteMarkerFraction(201.5, 200)).toBeNull()
    expect(noteMarkerFraction(9999, 200)).toBeNull()
  })

  it('unknown / zero / invalid duration → no marker', () => {
    for (const d of [0, NaN, Infinity, -1, undefined, null, '100']) expect(noteMarkerFraction(10, d)).toBeNull()
  })

  it('invalid timestamps → no marker', () => {
    for (const p of [-1, NaN, Infinity, undefined, null, '10']) expect(noteMarkerFraction(p, 200)).toBeNull()
  })

  it('Chapter scope: relative to the chapter, only inside it', () => {
    const chapter = { startSeconds: 100, endSeconds: 150 }
    expect(noteMarkerFraction(125, 200, chapter)).toBe(0.5)
    expect(noteMarkerFraction(100, 200, chapter)).toBe(0)
    expect(noteMarkerFraction(99, 200, chapter)).toBeNull()
    expect(noteMarkerFraction(151, 200, chapter)).toBeNull()
    expect(noteMarkerFraction(10, 200, { startSeconds: 50, endSeconds: 50 })).toBeNull()
  })

  it('the position stays right when the duration changes (metadata arrives later)', () => {
    expect(noteMarkerFraction(60, 120)).toBe(0.5)
    expect(noteMarkerFraction(60, 240)).toBe(0.25)
  })
})
