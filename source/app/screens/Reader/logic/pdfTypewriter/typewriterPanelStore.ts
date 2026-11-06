import { create } from 'zustand'

/**
 * What the Typewriter Properties sidebar edits: the defaults of the NEXT note, or one saved note. It holds an id only —
 * every value shown is read from the row or the prefs store, so switching target leaves nothing of the old one behind.
 */
export type TypewriterPanelTarget = { mode: 'defaults' } | { mode: 'note'; id: string }

type TypewriterPanelState = {
  target: TypewriterPanelTarget
  showDefaults: () => void
  showNote: (id: string) => void
}

export const useTypewriterPanelStore = create<TypewriterPanelState>()((set) => ({
  target: { mode: 'defaults' },
  showDefaults: () => set({ target: { mode: 'defaults' } }),
  showNote: (id) => set({ target: { mode: 'note', id } }),
}))
