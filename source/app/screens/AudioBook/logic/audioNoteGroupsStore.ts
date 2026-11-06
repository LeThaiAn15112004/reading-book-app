import { create } from 'zustand'
import { useAudioPlayerStore } from './audioPlayerStore'

/**
 * Which track rows of the multi-track Notes tab are open. Session-only (memory, never saved), and for ONE audiobook at a time:
 * it is cleared whenever the player's `bookId` changes, so nothing carries over to another audiobook or to a reopened one.
 *
 * It lives outside React on purpose: the sidebar panel unmounts when it is closed and the tab body swaps with the tab, so
 * component state would forget the choices the listener made. It does NOT follow the playing track: only `ensureSeeded`
 * (the first time the tab is shown) and a Note being added open a row by themselves.
 */
type NoteGroupsState = {
  /** Track ids whose row is open. */
  open: Record<string, true>
  /** The default (the playing track's row open) has been applied for this audiobook. */
  seeded: boolean
  /** First time the Notes tab is shown for this audiobook: open the playing track's row. Later calls do nothing. Only adds. */
  ensureSeeded: (currentTrackId: string | undefined) => void
  toggle: (trackId: string) => void
  reset: () => void
}

export const useNoteGroupsStore = create<NoteGroupsState>()((set, get) => ({
  open: {},
  seeded: false,

  ensureSeeded: (currentTrackId) => {
    if (get().seeded) return
    set({ seeded: true, ...(currentTrackId ? { open: { ...get().open, [currentTrackId]: true as const } } : {}) })
  },

  toggle: (trackId) => {
    const next = { ...get().open }
    if (next[trackId]) delete next[trackId]
    else next[trackId] = true
    set({ open: next })
  },

  reset: () => set({ open: {}, seeded: false }),
}))

/** Selector: is this track's row open? */
export const selectNoteGroupOpen = (trackId: string) => (s: NoteGroupsState) => s.open[trackId] === true

// One module-level subscription. It reads only `bookId` (another audiobook ⇒ start clean) and `lastAddedNote` (a Note was
// added ⇒ show its row). It deliberately ignores `trackIndex`, `positionSeconds`, `notes` and `tracks`.
useAudioPlayerStore.subscribe((state, previous) => {
  if (state.bookId !== previous.bookId) useNoteGroupsStore.getState().reset()
  const added = state.lastAddedNote
  if (added && added !== previous.lastAddedNote && !useNoteGroupsStore.getState().open[added.trackId]) {
    useNoteGroupsStore.setState({ open: { ...useNoteGroupsStore.getState().open, [added.trackId]: true } })
  }
})
