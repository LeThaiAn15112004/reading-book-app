import { create } from 'zustand'

/**
 * Which note's menu is open, and where. ONE store for every entry point — the sidebar's ⋮ button, a
 * timeline marker, the "+ Note" button — so they all open the same menu (rendered once by
 * `AudioNoteMenu`) on the same notes list (`audioPlayerStore.notes`).
 */
export type NoteMenuMode = 'menu' | 'edit' | 'confirm-delete'

export type NoteMenuAnchor = { left: number; top: number; right: number; bottom: number }

type NoteMenuState = {
  open: { noteId: string; anchor: NoteMenuAnchor; mode: NoteMenuMode } | null
  /** Open the menu for `noteId` next to `element` (a button or a marker). */
  openFor: (noteId: string, element: Element, mode?: NoteMenuMode) => void
  setMode: (mode: NoteMenuMode) => void
  close: () => void
}

export const useNoteMenuStore = create<NoteMenuState>()((set, get) => ({
  open: null,
  openFor: (noteId, element, mode = 'menu') => {
    const r = element.getBoundingClientRect()
    set({ open: { noteId, anchor: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, mode } })
  },
  setMode: (mode) => {
    const current = get().open
    if (current) set({ open: { ...current, mode } })
  },
  close: () => set({ open: null }),
}))
