import type { AudioBookmark } from '../audio/audio-bookmarks.js'
import type { AudioChapter } from '../audio/audio-timeline.js'
import type { AudioTrack } from '../audio/audio-tracks.js'
import { createTextMatcher, parseTextSearchQuery } from '../search/text-search.js'

/**
 * Spec 018 FR-033: search and chapter filter of the audiobook Notes tab. A Note matches when its text or the title of
 * its chapter / track contains the words (case and Vietnamese marks ignored, the reader's search rules). Pure: never
 * changes, reorders or drops anything but non-matching Notes.
 */

export type AudioNoteFilter = {
  query: string
  /** Single-file books with chapters: only this chapter's Notes; `null` = every chapter. */
  chapterId: string | null
}

export const EMPTY_AUDIO_NOTE_FILTER: Readonly<AudioNoteFilter> = Object.freeze({ query: '', chapterId: null })

export function isAudioNoteFilterActive(filter: AudioNoteFilter): boolean {
  return filter.query.trim() !== '' || filter.chapterId !== null
}

/** Which chapter a Note is in; by default its stored `chapterId` (the UI may place it by its position instead). */
export type ChapterOf = (note: AudioBookmark) => string | undefined

const storedChapter: ChapterOf = (note) => note.chapterId

function placeTitle(
  note: AudioBookmark,
  chapters: readonly AudioChapter[],
  tracks: readonly AudioTrack[],
  chapterOf: ChapterOf,
): string {
  if (note.trackId) return tracks.find((t) => t.id === note.trackId)?.title ?? ''
  const chapterId = chapterOf(note)
  if (chapterId) return chapters.find((c) => c.id === chapterId)?.title ?? ''
  return ''
}

/** The Notes that pass `filter`, in their given order. */
export function filterAudioNotes(
  notes: readonly AudioBookmark[],
  filter: AudioNoteFilter,
  chapters: readonly AudioChapter[],
  tracks: readonly AudioTrack[] = [],
  chapterOf: ChapterOf = storedChapter,
): AudioBookmark[] {
  const query = parseTextSearchQuery(filter.query)
  const matcher = query ? createTextMatcher(query) : null
  return notes.filter((note) => {
    if (filter.chapterId !== null && chapterOf(note) !== filter.chapterId) return false
    if (!matcher) return true
    return matcher.find(note.note ?? '').length > 0 || matcher.find(placeTitle(note, chapters, tracks, chapterOf)).length > 0
  })
}

export type ChapterNoteGroup = {
  /** `null` = Notes without a (known) chapter. */
  chapter: AudioChapter | null
  notes: AudioBookmark[]
}

/** Notes grouped by chapter, chapters in book order, Notes in their given order; empty chapters left out. */
export function groupNotesByChapter(
  notes: readonly AudioBookmark[],
  chapters: readonly AudioChapter[],
  chapterOf: ChapterOf = storedChapter,
): ChapterNoteGroup[] {
  const groups: ChapterNoteGroup[] = chapters.map((chapter) => ({ chapter, notes: [] }))
  const outside: AudioBookmark[] = []
  for (const note of notes) {
    const chapterId = chapterOf(note)
    const group = chapterId ? groups.find((g) => g.chapter?.id === chapterId) : undefined
    if (group) group.notes.push(note)
    else outside.push(note)
  }
  const result = groups.filter((g) => g.notes.length > 0)
  if (outside.length > 0) result.push({ chapter: null, notes: outside })
  return result
}
