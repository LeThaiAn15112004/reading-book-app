import { create } from 'zustand'
import type { HighlightStyleKind } from '@reading-book/book-reader-sdk'

export type NotesSortBy = 'readingOrder' | 'chronological'

/** Notes-panel type filter — a dropdown, not a multi-select, and deliberately scoped to the
 *  three annotation kinds the reader fully supports today (`highlight`, `underline`,
 *  `strikethrough`). `textbox` notes still show up under 'all', they just don't get their own
 *  filter option yet. */
export type NotesTypeFilter = 'all' | Exclude<HighlightStyleKind, 'textbox'>

/** Search terms longer than this are almost certainly a paste-in-the-wrong-box accident — clamp
 *  instead of letting an unbounded string flow into every `.toLowerCase()`/`.includes()` call on
 *  every render. */
const MAX_SEARCH_TERM_LENGTH = 200

type NotesFilterState = {
  searchTerm: string
  activeType: NotesTypeFilter
  sortBy: NotesSortBy
  /** Tag filter — exact (case-insensitive) tag name, '' = all tags. */
  activeTag: string
  /** Row 3 (type filter + sort) visibility — toggled by the row 2 filter icon. */
  filtersOpen: boolean
  /** Last input-validation problem, surfaced inline instead of thrown. */
  error: string | null
  setSearchTerm: (value: string) => void
  setActiveType: (type: NotesTypeFilter) => void
  setSortBy: (sortBy: NotesSortBy) => void
  setActiveTag: (tag: string) => void
  toggleFiltersOpen: () => void
  reset: () => void
}

const VALID_TYPE_FILTERS: ReadonlySet<NotesTypeFilter> = new Set([
  'all',
  'highlight',
  'underline',
  'squiggly',
  'strikethrough',
  'replace',
  'insert',
])

/**
 * UI-only state for the Notes sidebar's search/filter/sort row — kept in its own zustand store
 * (rather than component `useState`) so it survives the panel re-mounting and stays consistent
 * with how the rest of the reader's annotation state is managed (see `highlightsStore.ts`).
 */
export const useNotesFilterStore = create<NotesFilterState>()((set) => ({
  searchTerm: '',
  activeType: 'all',
  sortBy: 'readingOrder',
  activeTag: '',
  filtersOpen: true,
  error: null,

  setSearchTerm: (value) => {
    try {
      const safe = typeof value === 'string' ? value : ''
      if (safe.length > MAX_SEARCH_TERM_LENGTH) {
        set({
          searchTerm: safe.slice(0, MAX_SEARCH_TERM_LENGTH),
          error: `Search term truncated to ${MAX_SEARCH_TERM_LENGTH} characters.`,
        })
        return
      }
      set({ searchTerm: safe, error: null })
    } catch {
      set({ error: 'Could not update the search field.' })
    }
  },

  setActiveType: (type) => {
    if (!VALID_TYPE_FILTERS.has(type)) return
    set({ activeType: type })
  },

  setSortBy: (sortBy) => set({ sortBy }),

  setActiveTag: (tag) => set({ activeTag: typeof tag === 'string' ? tag : '' }),

  toggleFiltersOpen: () => set((s) => ({ filtersOpen: !s.filtersOpen })),

  reset: () => set({ searchTerm: '', activeType: 'all', sortBy: 'readingOrder', activeTag: '', error: null }),
}))
