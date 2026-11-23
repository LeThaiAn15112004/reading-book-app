import { describe, expect, it } from 'vitest'
import {
  filterAudioNotes,
  groupNotesByChapter,
  isAudioNoteFilterActive,
} from '../../src/app-models/audio-note-filter'
import type { AudioBookmark } from '../../src/audio/audio-bookmarks'
import type { AudioChapter } from '../../src/audio/audio-timeline'

const chapters: AudioChapter[] = [
  { id: 'c1', title: 'Mở đầu', startSeconds: 0, endSeconds: 100 } as AudioChapter,
  { id: 'c2', title: 'Chương hai: Hà Nội', startSeconds: 100, endSeconds: 200 } as AudioChapter,
]

function note(id: string, text: string | undefined, chapterId?: string): AudioBookmark {
  return { id, label: id, positionSeconds: 1, note: text, chapterId, createdAt: '2026-11-23T00:00:00Z' }
}

const notes = [
  note('n1', 'Đoạn này rất hay', 'c1'),
  note('n2', 'Nhớ đọc lại', 'c2'),
  note('n3', undefined, 'c2'),
  note('n4', 'Không chương'),
]

describe('filterAudioNotes (spec 018 FR-033)', () => {
  it('an empty filter keeps every Note in order', () => {
    expect(filterAudioNotes(notes, { query: '', chapterId: null }, chapters).map((n) => n.id)).toEqual(['n1', 'n2', 'n3', 'n4'])
    expect(isAudioNoteFilterActive({ query: '  ', chapterId: null })).toBe(false)
  })

  it('matches Vietnamese text without accents and in any case', () => {
    // Marks are ignored (ạ, à); đ stays its own letter, exactly as in the reader's search.
    expect(filterAudioNotes(notes, { query: 'đoan nay', chapterId: null }, chapters).map((n) => n.id)).toEqual(['n1'])
    expect(filterAudioNotes(notes, { query: 'rat hay', chapterId: null }, chapters).map((n) => n.id)).toEqual(['n1'])
    expect(filterAudioNotes(notes, { query: 'NHỚ', chapterId: null }, chapters).map((n) => n.id)).toEqual(['n2'])
  })

  it('matches the chapter title too', () => {
    expect(filterAudioNotes(notes, { query: 'ha noi', chapterId: null }, chapters).map((n) => n.id)).toEqual(['n2', 'n3'])
  })

  it('filters by chapter, and both rules together', () => {
    expect(filterAudioNotes(notes, { query: '', chapterId: 'c2' }, chapters).map((n) => n.id)).toEqual(['n2', 'n3'])
    expect(filterAudioNotes(notes, { query: 'nhớ', chapterId: 'c2' }, chapters).map((n) => n.id)).toEqual(['n2'])
    expect(filterAudioNotes(notes, { query: 'hay', chapterId: 'c2' }, chapters)).toEqual([])
  })

  it('uses the track title for multi-track Notes', () => {
    const tn = [{ ...note('t1', 'x'), trackId: 'trk' }]
    const tracks = [{ id: 'trk', title: 'Phần một' }] as never
    expect(filterAudioNotes(tn, { query: 'phan mot', chapterId: null }, [], tracks).map((n) => n.id)).toEqual(['t1'])
  })

  it('never mutates the input', () => {
    const copy = structuredClone(notes)
    filterAudioNotes(notes, { query: 'hay', chapterId: 'c1' }, chapters)
    expect(notes).toEqual(copy)
  })
})

describe('groupNotesByChapter', () => {
  it('groups in book order, leaves empty chapters out, keeps Notes without a chapter last', () => {
    const groups = groupNotesByChapter(notes, chapters)
    expect(groups.map((g) => [g.chapter?.id ?? null, g.notes.map((n) => n.id)])).toEqual([
      ['c1', ['n1']],
      ['c2', ['n2', 'n3']],
      [null, ['n4']],
    ])
  })
})
