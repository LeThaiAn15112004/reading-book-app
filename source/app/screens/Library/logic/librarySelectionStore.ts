import { create } from 'zustand'
import { toggleSelected } from '@core'

/**
 * Select mode of the Library: the picked book ids, in pick order.
 * - Phone: a long press starts it with that book; unpicking the last book leaves it.
 * - Desktop: the "Select" button starts it with nothing picked (`sticky`); it stays until Done / Esc.
 * Session-only; cleared when the Library hub goes away.
 */
type LibrarySelectionState = {
  active: boolean
  /** Started by the Desktop button: stays open with no book picked. */
  sticky: boolean
  ids: string[]
  /** Desktop "Select": select mode with nothing picked yet. */
  start: () => void
  /** Long press on a book: start select mode with it (or toggle it when already selecting). */
  press: (id: string) => void
  toggle: (id: string) => void
  setIds: (ids: string[]) => void
  clear: () => void
}

export const useLibrarySelectionStore = create<LibrarySelectionState>((set) => {
  const withIds = (ids: string[], sticky: boolean) => ({ ids, active: ids.length > 0 || sticky })
  return {
    active: false,
    sticky: false,
    ids: [],
    start: () => set({ active: true, sticky: true, ids: [] }),
    press: (id) => set(({ ids, sticky }) => withIds(toggleSelected(ids, id), sticky)),
    toggle: (id) => set(({ ids, sticky }) => withIds(toggleSelected(ids, id), sticky)),
    setIds: (ids) => set(({ sticky }) => withIds(ids, sticky)),
    clear: () => set({ active: false, sticky: false, ids: [] }),
  }
})
