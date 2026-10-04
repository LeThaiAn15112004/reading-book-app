import { create } from 'zustand'

/**
 * Panels that can occupy the reader's docked right sidebar. Only one is shown at a time; add an
 * id here (and its content in `ReaderScreen`) to reuse the sidebar for another feature.
 */
export type RightPanelId = 'settings'

type RightPanelState = {
  /** Panel currently docked on the right, or null when the sidebar is closed. */
  panel: RightPanelId | null
  open: (panel: RightPanelId) => void
  close: () => void
  /** Open `panel`, or close the sidebar when `panel` is already the one shown. */
  toggle: (panel: RightPanelId) => void
}

export const useRightPanelStore = create<RightPanelState>()((set) => ({
  panel: null,
  open: (panel) => set({ panel }),
  close: () => set({ panel: null }),
  toggle: (panel) => set((s) => ({ panel: s.panel === panel ? null : panel })),
}))
