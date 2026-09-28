import { create } from 'zustand'
import type { MutableRefObject } from 'react'
import {
  DEFAULT_TEXT_SEARCH_OPTIONS,
  createTextMatcher,
  parseTextSearchQuery,
  type TextSearchOptions,
} from '@reading-book/book-reader-sdk'
import {
  searchApi,
  type BookSearchMatch,
  type BookSearchOrder,
  type BookSearchResult,
} from '../../../../bridge'
import type { EpubRendererApi } from '../../../../reader/renderers/epub'
import { clampPanelSize, type PanelPosition, type PanelSize } from '../floatingPanel/panelGeometry'

/** Matches per IPC page; the total count is always exact regardless. */
const PAGE_SIZE = 200
/** Searches answered faster than this never flash the "Searching entire book…" indicator. */
const BUSY_AFTER_MS = 150

/**
 * - idle: nothing searched (or the query has no searchable word)
 * - searching: request in flight (`busy` flips on after BUSY_AFTER_MS)
 * - indexing: the book's text is still being chunked; re-run automatically when that finishes
 * - ready / unsupported / error: final
 */
export type BookSearchStatus = 'idle' | 'searching' | 'indexing' | 'ready' | 'unsupported' | 'error'

/** Dragged panel position in px, relative to its positioning container (its `offsetParent`). */
export type SearchPanelPosition = PanelPosition

const PANEL_POSITION_STORAGE_KEY = 'reading-book.searchPanelPosition'

/** Remembers where the user last dragged the panel, same as `useSidebarPanelResize`'s width. */
function readStoredPanelPosition(): SearchPanelPosition | null {
  try {
    const raw = localStorage.getItem(PANEL_POSITION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SearchPanelPosition> | null
    if (typeof parsed?.top === 'number' && typeof parsed.left === 'number') {
      return { top: parsed.top, left: parsed.left }
    }
    return null
  } catch {
    return null
  }
}

function writeStoredPanelPosition(position: SearchPanelPosition | null): void {
  try {
    if (position) localStorage.setItem(PANEL_POSITION_STORAGE_KEY, JSON.stringify(position))
    else localStorage.removeItem(PANEL_POSITION_STORAGE_KEY)
  } catch {
    /* ignore quota / private mode */
  }
}

/** User-resized panel size in px. Null = default CSS size (`w-[min(360px,...)]`, content-height). */
export type SearchPanelSize = PanelSize

const PANEL_SIZE_STORAGE_KEY = 'reading-book.searchPanelSize'

function readStoredPanelSize(): SearchPanelSize | null {
  try {
    const raw = localStorage.getItem(PANEL_SIZE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SearchPanelSize> | null
    if (typeof parsed?.width === 'number' && typeof parsed.height === 'number') {
      return clampPanelSize({ width: parsed.width, height: parsed.height })
    }
    return null
  } catch {
    return null
  }
}

function writeStoredPanelSize(size: SearchPanelSize | null): void {
  try {
    if (size) localStorage.setItem(PANEL_SIZE_STORAGE_KEY, JSON.stringify(size))
    else localStorage.removeItem(PANEL_SIZE_STORAGE_KEY)
  } catch {
    /* ignore quota / private mode */
  }
}

/** Values `useReaderSearch` syncs in from ReaderScreen — read via `get()`, never rendered. */
type BookSearchContext = {
  bookId: string | undefined
  isEpubSurface: boolean
  epubApiRef: MutableRefObject<EpubRendererApi | null> | null
  /** Live text of the search box; `submit()` searches it. */
  inputQuery: string
  /** Results can arrive while the panel is closed (indexing retry) — don't jump/paint then. */
  panelOpen: boolean
}

const emptyContext: BookSearchContext = {
  bookId: undefined,
  isEpubSurface: false,
  epubApiRef: null,
  inputQuery: '',
  panelOpen: false,
}

type BookSearchState = BookSearchContext & {
  /** Query of the results shown (the input's live text lives in AppTitleContext). */
  query: string
  options: TextSearchOptions
  order: BookSearchOrder
  status: BookSearchStatus
  /** A search has been running long enough to show the loading indicator. */
  busy: boolean
  totalMatches: number
  /** Words in the book — denominator of "word 1,250 of 98,400". */
  totalWords: number
  /** Loaded page(s) of matches, in `order`. */
  matches: BookSearchMatch[]
  hasMore: boolean
  loadingMore: boolean
  /** Index into `matches` of the current hit; -1 before the first jump. */
  activeIndex: number
  errorMessage: string | null
  /** Section labels by real spine index, snapshotted per result set (TOC walk is not free). */
  chapterLabels: string[]
  /** Where the user dragged the floating panel to — null = default CSS-anchored corner. Not a
   *  per-book value (a layout preference, like sidebar width), so `resetForNewBook` leaves it. */
  panelPosition: SearchPanelPosition | null
  /** True while the header drag handle is being dragged — drives the grabbing cursor. */
  panelDragging: boolean
  /** User-resized panel size — null = default CSS size. Not per-book, like `panelPosition`. */
  panelSize: SearchPanelSize | null
  /** True while the resize handle is being dragged — drives the resize cursor. */
  panelResizing: boolean

  setContext: (patch: Partial<BookSearchContext>) => void
  /** Enter in the search box: a new query searches; the same query again steps to the next hit. */
  submit: () => void
  search: (rawQuery: string) => Promise<void>
  setOptions: (patch: Partial<TextSearchOptions>) => void
  setOrder: (order: BookSearchOrder) => void
  loadMore: () => Promise<void>
  goTo: (index: number) => void
  next: () => Promise<void>
  previous: () => void
  /** `bookIndex:status` done/error for a book — resumes a search parked in `indexing`. */
  handleIndexStatus: (bookId: string, state: 'indexing' | 'done' | 'error') => void
  /** Panel open/close: paint or hide the hits in the book, results are kept. */
  setPanelOpen: (open: boolean) => void
  /** Persists to localStorage; `null` drops back to the default corner anchor. */
  setPanelPosition: (position: SearchPanelPosition | null) => void
  setPanelDragging: (dragging: boolean) => void
  /** Persists to localStorage; `null` drops back to the default CSS-driven size. */
  setPanelSize: (size: SearchPanelSize | null) => void
  setPanelResizing: (resizing: boolean) => void
  resetForNewBook: () => void
}

/** Monotonic id of the latest search; responses for older ones are dropped. */
let requestSeq = 0
let busyTimer: ReturnType<typeof setTimeout> | null = null
/** Jumps run one at a time; while one runs only the LATEST request is kept (rapid next/next). */
let jumpInFlight = false
let pendingJump: BookSearchMatch | null = null

function clearBusyTimer(): void {
  if (busyTimer === null) return
  clearTimeout(busyTimer)
  busyTimer = null
}

function errorMessageOf(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Search failed.'
}

const emptyResults: Pick<
  BookSearchState,
  | 'status'
  | 'busy'
  | 'totalMatches'
  | 'totalWords'
  | 'matches'
  | 'hasMore'
  | 'loadingMore'
  | 'activeIndex'
  | 'errorMessage'
> = {
  status: 'idle',
  busy: false,
  totalMatches: 0,
  totalWords: 0,
  matches: [],
  hasMore: false,
  loadingMore: false,
  activeIndex: -1,
  errorMessage: null,
}

/**
 * In-book full-text search for the open book (FTS5 in Main, see electron/search). Owns the UI
 * state of the search panel and the side effects around it: the IPC round-trips, the delayed
 * loading indicator, painting hits and jumping through the `EpubRendererApi` handle threaded in
 * via `setContext`. One Reader route is mounted at a time, so one shared store is safe
 * (`resetForNewBook` on every book switch), same as `useHighlightsStore`.
 */
export const useBookSearchStore = create<BookSearchState>()((set, get) => {
  /** Paint every hit of the current query in the book, or clear them. */
  const paintHits = (): void => {
    const { epubApiRef, isEpubSurface, panelOpen, status, query, options } = get()
    const api = isEpubSurface ? epubApiRef?.current : null
    if (!api) return
    const parsed = panelOpen && status === 'ready' ? parseTextSearchQuery(query, options) : null
    api.setSearchHighlights(parsed ? createTextMatcher(parsed) : null)
  }

  const drainJumps = async (): Promise<void> => {
    if (jumpInFlight) return
    jumpInFlight = true
    try {
      while (pendingJump) {
        const match = pendingJump
        pendingJump = null
        const api = get().epubApiRef?.current
        if (!api) break
        try {
          await api.goToSearchMatch({
            spineIndex: match.chapterIndex,
            occurrence: match.chapterOccurrence,
            count: match.chapterMatchCount,
          })
        } catch {
          // A failed jump leaves the reader where it was; the next click just tries again.
        }
      }
    } finally {
      jumpInFlight = false
    }
  }

  const request = (offset: number): Promise<BookSearchResult> => {
    const { bookId, query, options, order } = get()
    return searchApi
      .searchBook({ bookId: bookId ?? '', query, ...options, order, offset, limit: PAGE_SIZE })
      .catch((err: unknown): BookSearchResult => ({ state: 'error', message: errorMessageOf(err) }))
  }

  return {
    ...emptyContext,
    ...emptyResults,
    query: '',
    options: { ...DEFAULT_TEXT_SEARCH_OPTIONS },
    order: 'position',
    chapterLabels: [],
    panelPosition: readStoredPanelPosition(),
    panelDragging: false,
    panelSize: readStoredPanelSize(),
    panelResizing: false,

    setContext: (patch) => set(patch),

    submit: () => {
      const { inputQuery, query, status, totalMatches } = get()
      if (inputQuery.trim() === query && status === 'ready' && totalMatches > 0) {
        void get().next()
        return
      }
      void get().search(inputQuery)
    },

    search: async (rawQuery) => {
      const seq = ++requestSeq
      clearBusyTimer()
      const query = rawQuery.trim()
      const { bookId, options } = get()
      if (!bookId || !parseTextSearchQuery(query, options)) {
        set({ ...emptyResults, query })
        paintHits()
        return
      }

      set({ ...emptyResults, query, status: 'searching' })
      busyTimer = setTimeout(() => {
        busyTimer = null
        if (seq === requestSeq) set({ busy: true })
      }, BUSY_AFTER_MS)

      const result = await request(0)
      if (seq !== requestSeq) return
      clearBusyTimer()

      switch (result.state) {
        case 'indexing':
          // Keep the indicator up: handleIndexStatus re-runs this search when chunking is done.
          set({ status: 'indexing', busy: true })
          break
        case 'unsupported':
          set({ status: 'unsupported', busy: false })
          break
        case 'error':
          set({ status: 'error', busy: false, errorMessage: result.message })
          break
        case 'ok':
          set({
            status: 'ready',
            busy: false,
            totalMatches: result.totalMatches,
            totalWords: result.totalWords,
            matches: result.matches,
            hasMore: result.hasMore,
            chapterLabels: get().epubApiRef?.current?.getSpineSectionLabels() ?? [],
          })
          break
      }
      paintHits()
      // Instant jump: land on the first result right away so reading can start without a click.
      if (result.state === 'ok' && result.matches.length > 0 && get().panelOpen) get().goTo(0)
    },

    setOptions: (patch) => {
      set((state) => ({ options: { ...state.options, ...patch } }))
      if (get().query) void get().search(get().query)
    },

    setOrder: (order) => {
      if (order === get().order) return
      set({ order })
      if (get().query) void get().search(get().query)
    },

    loadMore: async () => {
      const { status, hasMore, loadingMore, matches } = get()
      if (status !== 'ready' || !hasMore || loadingMore) return
      const seq = requestSeq
      set({ loadingMore: true })
      const result = await request(matches.length)
      if (seq !== requestSeq) return
      if (result.state === 'ok') {
        set((state) => ({
          matches: [...state.matches, ...result.matches],
          hasMore: result.hasMore,
          loadingMore: false,
        }))
      } else {
        set({ loadingMore: false })
      }
    },

    goTo: (index) => {
      const match = get().matches[index]
      if (!match) return
      set({ activeIndex: index })
      if (!get().isEpubSurface) return
      pendingJump = match
      void drainJumps()
    },

    next: async () => {
      const { activeIndex, matches, hasMore } = get()
      if (matches.length === 0) return
      if (activeIndex + 1 < matches.length) {
        get().goTo(activeIndex + 1)
        return
      }
      if (hasMore) {
        await get().loadMore()
        if (get().matches.length > activeIndex + 1) get().goTo(activeIndex + 1)
        return
      }
      get().goTo(0) // past the last occurrence: wrap to the first, like Foxit
    },

    previous: () => {
      const { activeIndex, matches, hasMore } = get()
      if (matches.length === 0) return
      if (activeIndex > 0) get().goTo(activeIndex - 1)
      // Wrap to the last occurrence only when it is loaded — never to "last of this page".
      else if (!hasMore) get().goTo(matches.length - 1)
    },

    handleIndexStatus: (bookId, state) => {
      if (bookId !== get().bookId || get().status !== 'indexing') return
      if (state === 'done') {
        void get().search(get().query)
      } else if (state === 'error') {
        set({ status: 'error', busy: false, errorMessage: 'This book could not be prepared for search.' })
      }
    },

    setPanelOpen: (open) => {
      if (open === get().panelOpen) return
      set({ panelOpen: open })
      paintHits()
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

    resetForNewBook: () => {
      ++requestSeq
      clearBusyTimer()
      pendingJump = null
      set({ ...emptyResults, query: '', chapterLabels: [] })
    },
  }
})
