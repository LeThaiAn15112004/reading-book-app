import { create } from 'zustand'
import {
  chapterIndexAt,
  filterAudioNotes,
  isAudioNoteFilterActive,
  resolveBookmarkTarget,
  type AudioBookmark,
  type AudioChapter,
} from '@core'
import { useAudioPlayerStore } from './audioPlayerStore'

/**
 * Spec 018 FR-033: the Notes tab's search text, chapter filter and "group by chapter" view. Session-only and outside
 * React, so closing and reopening the sidebar keeps it; cleared when the player's audiobook changes. `hiddenNoteId` is
 * a Note added while the filter hides it (the tab offers "Show", which clears the filter).
 */
type AudioNoteFilterState = {
  query: string
  chapterId: string | null
  groupByChapter: boolean
  hiddenNoteId: string | null
  setQuery: (query: string) => void
  setChapterId: (chapterId: string | null) => void
  setGroupByChapter: (on: boolean) => void
  setHiddenNoteId: (id: string | null) => void
  clear: () => void
  reset: () => void
}

const INITIAL = { query: '', chapterId: null, groupByChapter: false, hiddenNoteId: null }

export const useAudioNoteFilterStore = create<AudioNoteFilterState>((set) => ({
  ...INITIAL,
  setQuery: (query) => set({ query, hiddenNoteId: null }),
  setChapterId: (chapterId) => set({ chapterId, hiddenNoteId: null }),
  setGroupByChapter: (groupByChapter) => set({ groupByChapter }),
  setHiddenNoteId: (hiddenNoteId) => set({ hiddenNoteId }),
  clear: () => set({ query: '', chapterId: null, hiddenNoteId: null }),
  reset: () => set(INITIAL),
}))

/** The chapter a single-file Note is in, by its position (the same place the Notes list shows it). */
export function noteChapterOf(
  chapters: readonly AudioChapter[],
  duration: number | null,
): (note: AudioBookmark) => string | undefined {
  return (note) => chapters[chapterIndexAt(chapters, resolveBookmarkTarget(note, chapters, duration))]?.id
}

useAudioPlayerStore.subscribe((state, previous) => {
  if (state.bookId !== previous.bookId) {
    useAudioNoteFilterStore.getState().reset()
    return
  }
  if (state.notes === previous.notes) return
  // A Note was added while the search / filter would hide it: offer "Show" instead of letting it vanish.
  const filter = useAudioNoteFilterStore.getState()
  const active = isAudioNoteFilterActive(filter)
  if (!active) return
  const before = new Set(previous.notes.map((n) => n.id))
  const added = state.notes.filter((n) => !before.has(n.id))
  const last = added[added.length - 1]
  if (!last) return
  const known = state.chapterStatus === 'ok' ? state.chapters : []
  const shown = filterAudioNotes([last], filter, known, state.tracks, noteChapterOf(known, state.durationSeconds))
  if (shown.length === 0) filter.setHiddenNoteId(last.id)
})
