import { create } from 'zustand'
import { toggleSelected } from '@core'

/**
 * Select mode of the phone Library (long press a book): the picked book ids, in pick order. Empty = not selecting —
 * unpicking the last book leaves select mode. Session-only; cleared when the Library hub goes away.
 */
type LibrarySelectionState = {
  ids: string[]
  /** Long press on a book: start select mode with it (or toggle it when already selecting). */
  press: (id: string) => void
  toggle: (id: string) => void
  setIds: (ids: string[]) => void
  clear: () => void
}

export const useLibrarySelectionStore = create<LibrarySelectionState>((set) => ({
  ids: [],
  press: (id) => set(({ ids }) => ({ ids: toggleSelected(ids, id) })),
  toggle: (id) => set(({ ids }) => ({ ids: toggleSelected(ids, id) })),
  setIds: (ids) => set({ ids }),
  clear: () => set({ ids: [] }),
}))
