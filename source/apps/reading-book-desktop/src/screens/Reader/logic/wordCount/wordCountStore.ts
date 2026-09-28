import { create } from 'zustand'
import { wordCountApi } from '../../../../bridge'
import { clampPanelSize, type PanelPosition, type PanelSize } from '../floatingPanel/panelGeometry'

const PANEL_POSITION_STORAGE_KEY = 'reading-book.wordCountPanelPosition'
const PANEL_SIZE_STORAGE_KEY = 'reading-book.wordCountPanelSize'

/** Remembers where/how big the user last dragged/resized the panel, same convention as the
 *  search panel's `panelPosition`/`panelSize`. */
function readStoredPanelPosition(): PanelPosition | null {
  try {
    const raw = localStorage.getItem(PANEL_POSITION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PanelPosition> | null
    if (typeof parsed?.top === 'number' && typeof parsed.left === 'number') {
      return { top: parsed.top, left: parsed.left }
    }
    return null
  } catch {
    return null
  }
}

function writeStoredPanelPosition(position: PanelPosition | null): void {
  try {
    if (position) localStorage.setItem(PANEL_POSITION_STORAGE_KEY, JSON.stringify(position))
    else localStorage.removeItem(PANEL_POSITION_STORAGE_KEY)
  } catch {
    /* ignore quota / private mode */
  }
}

function readStoredPanelSize(): PanelSize | null {
  try {
    const raw = localStorage.getItem(PANEL_SIZE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PanelSize> | null
    if (typeof parsed?.width === 'number' && typeof parsed.height === 'number') {
      return clampPanelSize({ width: parsed.width, height: parsed.height })
    }
    return null
  } catch {
    return null
  }
}

function writeStoredPanelSize(size: PanelSize | null): void {
  try {
    if (size) localStorage.setItem(PANEL_SIZE_STORAGE_KEY, JSON.stringify(size))
    else localStorage.removeItem(PANEL_SIZE_STORAGE_KEY)
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * - idle: nothing loaded yet
 * - loading: request in flight
 * - indexing: the book's text is still being chunked; re-run automatically when that finishes
 * - ready / unsupported / error: final
 */
export type WordCountStatus = 'idle' | 'loading' | 'ready' | 'indexing' | 'unsupported' | 'error'

/** Foxit-style breakdown — see `word-count-service.ts` (Main) for how each is derived. */
export interface WordCountStats {
  words: number
  charactersWithSpaces: number
  charactersNoSpaces: number
  lines: number
  nonAsianWords: number
  asianCharacters: number
}

const EMPTY_STATS: WordCountStats = {
  words: 0,
  charactersWithSpaces: 0,
  charactersNoSpaces: 0,
  lines: 0,
  nonAsianWords: 0,
  asianCharacters: 0,
}

type WordCountState = {
  bookId: string | undefined
  status: WordCountStatus
  stats: WordCountStats
  errorMessage: string | null
  /** Where the user last dragged the panel to — null = default CSS-anchored corner. Not a
   *  per-book value (a layout preference), so `resetForNewBook` leaves it. */
  panelPosition: PanelPosition | null
  /** True while the header drag handle is being dragged — drives the grabbing cursor. */
  panelDragging: boolean
  /** User-resized panel size — null = default CSS size. Not per-book, like `panelPosition`. */
  panelSize: PanelSize | null
  /** True while a resize handle is being dragged — drives the resize cursor. */
  panelResizing: boolean

  setContext: (bookId: string | undefined) => void
  load: () => Promise<void>
  /** `bookIndex:status` done/error for a book — resumes a load parked in `indexing`. */
  handleIndexStatus: (bookId: string, state: 'indexing' | 'done' | 'error') => void
  resetForNewBook: () => void
  setPanelPosition: (position: PanelPosition | null) => void
  setPanelDragging: (dragging: boolean) => void
  setPanelSize: (size: PanelSize | null) => void
  setPanelResizing: (resizing: boolean) => void
}

/** Monotonic id of the latest load; responses for older ones are dropped. */
let requestSeq = 0

/**
 * Word Count tool: Foxit-style Words/Characters/Lines/Asian-characters breakdown for the open
 * book, read straight from the same `book_chunks` index that in-book search uses (see
 * `word-count-service.ts` in Main) — never a separate scan of the book text. One Reader route is
 * mounted at a time, so one shared store is safe, same as `useBookSearchStore`.
 */
export const useWordCountStore = create<WordCountState>()((set, get) => ({
  bookId: undefined,
  status: 'idle',
  stats: EMPTY_STATS,
  errorMessage: null,
  panelPosition: readStoredPanelPosition(),
  panelDragging: false,
  panelSize: readStoredPanelSize(),
  panelResizing: false,

  setContext: (bookId) => set({ bookId }),

  load: async () => {
    const { bookId } = get()
    if (!bookId) return
    const seq = ++requestSeq
    set({ status: 'loading', errorMessage: null })
    const result = await wordCountApi.getStats(bookId)
    if (seq !== requestSeq) return

    switch (result.state) {
      case 'ok':
        set({
          status: 'ready',
          stats: {
            words: result.words,
            charactersWithSpaces: result.charactersWithSpaces,
            charactersNoSpaces: result.charactersNoSpaces,
            lines: result.lines,
            nonAsianWords: result.nonAsianWords,
            asianCharacters: result.asianCharacters,
          },
        })
        break
      case 'indexing':
        set({ status: 'indexing' })
        break
      case 'unsupported':
        set({ status: 'unsupported' })
        break
      case 'error':
        set({ status: 'error', errorMessage: result.message })
        break
    }
  },

  handleIndexStatus: (bookId, state) => {
    if (bookId !== get().bookId || get().status !== 'indexing') return
    if (state === 'done') {
      void get().load()
    } else if (state === 'error') {
      set({ status: 'error', errorMessage: 'This book could not be prepared for word count.' })
    }
  },

  resetForNewBook: () => {
    ++requestSeq
    set({ status: 'idle', stats: EMPTY_STATS, errorMessage: null })
  },

  setPanelPosition: (position) => {
    set({ panelPosition: position })
    writeStoredPanelPosition(position)
  },

  setPanelDragging: (dragging) => set({ panelDragging: dragging }),

  setPanelSize: (size) => {
    set({ panelSize: size })
    writeStoredPanelSize(size)
  },

  setPanelResizing: (resizing) => set({ panelResizing: resizing }),
}))
