import { create } from 'zustand'

/**
 * Spec 018 (research R8): which kind of screen the `/reader/:bookId` route is showing. Text books and audiobooks share
 * that route, but their keys differ (← / → turn pages in a book and skip in the player), so `ShortcutsBridge` picks
 * the `audiobook` context from here. Set by `ReaderRoute` once the book's format is known; `null` elsewhere.
 */
export type ReaderKind = 'text' | 'audio'

type ShortcutScreenState = {
  readerKind: ReaderKind | null
  setReaderKind: (kind: ReaderKind | null) => void
}

export const useShortcutScreenStore = create<ShortcutScreenState>((set) => ({
  readerKind: null,
  setReaderKind: (readerKind) => set({ readerKind }),
}))
