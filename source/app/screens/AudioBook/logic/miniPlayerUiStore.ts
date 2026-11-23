import { create } from 'zustand'

/** Spec 018 (contracts/player-ui.md): the in-app mini player bar is this tall; content is laid out above it. */
export const MINI_PLAYER_BAR_HEIGHT_PX = 56

/**
 * UI state of the mini player surfaces in the MAIN window (spec 018 US5): whether the floating window is open (the
 * in-app bar hides meanwhile), whether the bar is shown, and where the text reader wants it (above its footer).
 */
type MiniPlayerUiState = {
  /** Main says the floating window is open. */
  windowOpen: boolean
  /** The in-app bar is on screen right now (decided by `MiniPlayerBar`). */
  barVisible: boolean
  /** Text reader only: px from the bottom edge (its footer's height, or 0 while the footer is hidden). */
  readerBottomOffset: number | null
  setWindowOpen: (open: boolean) => void
  setBarVisible: (visible: boolean) => void
  setReaderBottomOffset: (px: number | null) => void
}

export const useMiniPlayerUiStore = create<MiniPlayerUiState>((set) => ({
  windowOpen: false,
  barVisible: false,
  readerBottomOffset: null,
  setWindowOpen: (windowOpen) => set({ windowOpen }),
  setBarVisible: (barVisible) => set({ barVisible }),
  setReaderBottomOffset: (readerBottomOffset) => set({ readerBottomOffset }),
}))

/** Height the content under / beside the bar has to keep free (0 when the bar is hidden). */
export function miniPlayerReservedHeight(state: Pick<MiniPlayerUiState, 'barVisible'>): number {
  return state.barVisible ? MINI_PLAYER_BAR_HEIGHT_PX : 0
}
