import { create } from 'zustand'

/** Chunking that finishes faster than this never shows an indicator (avoids a flash). */
const SHOW_AFTER_MS = 800

type BookIndexState = {
  /** Books whose background chunking has been running long enough to be worth showing. */
  visible: Record<string, true>
  begin: (bookId: string) => void
  finish: (bookId: string) => void
}

/** Pending "show after delay" timers — plain timers, not render state. */
const showTimers = new Map<string, ReturnType<typeof setTimeout>>()

function clearShowTimer(bookId: string): void {
  const timer = showTimers.get(bookId)
  if (timer === undefined) return
  clearTimeout(timer)
  showTimers.delete(bookId)
}

/**
 * UI state of the silent "optimising search" chunking (see electron/chunking). Kept in zustand
 * so any reader chrome can subscribe without prop-drilling the IPC status through the screen.
 */
export const useBookIndexStore = create<BookIndexState>()((set) => ({
  visible: {},

  begin: (bookId) => {
    if (showTimers.has(bookId)) return
    showTimers.set(
      bookId,
      setTimeout(() => {
        showTimers.delete(bookId)
        set((state) => ({ visible: { ...state.visible, [bookId]: true } }))
      }, SHOW_AFTER_MS),
    )
  },

  finish: (bookId) => {
    clearShowTimer(bookId)
    set((state) => {
      if (!(bookId in state.visible)) return state
      const rest = { ...state.visible }
      delete rest[bookId]
      return { visible: rest }
    })
  },
}))
