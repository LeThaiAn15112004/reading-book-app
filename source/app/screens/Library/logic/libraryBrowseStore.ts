import { create } from 'zustand'
import {
  LIBRARY_SORTS,
  type LibraryBrowseFilter,
  type LibraryLayout,
  type LibrarySortId,
} from './libraryBrowse'

const PREFS_STORAGE_KEY = 'reading-book.library.browse-prefs.v1'

type BrowsePrefs = { sort: LibrarySortId; layout: LibraryLayout }

/** Single source of the Library view defaults (first run and Settings → Reset App Settings). */
export const DEFAULT_LIBRARY_BROWSE_PREFS: Readonly<BrowsePrefs> = { sort: 'recently-added', layout: 'grid' }

function loadPrefs(): BrowsePrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) ?? 'null') as
      | Partial<BrowsePrefs>
      | null
    return {
      sort: LIBRARY_SORTS.some((s) => s.id === parsed?.sort)
        ? (parsed?.sort as LibrarySortId)
        : DEFAULT_LIBRARY_BROWSE_PREFS.sort,
      layout: parsed?.layout === 'table' || parsed?.layout === 'grid' ? parsed.layout : DEFAULT_LIBRARY_BROWSE_PREFS.layout,
    }
  } catch {
    return { ...DEFAULT_LIBRARY_BROWSE_PREFS }
  }
}

/** Returns false when the write failed (quota / private mode) — the choice just won't persist. */
function savePrefs(prefs: BrowsePrefs): boolean {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs))
    return true
  } catch {
    return false
  }
}

type LibraryBrowseState = BrowsePrefs & {
  /** Sidebar filter; starts at All books each session. */
  filter: LibraryBrowseFilter
  /** Table row shown in the detail panel (table layout only). */
  selectedBookId: string | null
  setFilter: (filter: LibraryBrowseFilter) => void
  setSort: (sort: LibrarySortId) => void
  setLayout: (layout: LibraryLayout) => void
  selectBook: (bookId: string | null) => void
  /**
   * Settings → Advanced → Reset App Settings: sort + layout back to `DEFAULT_LIBRARY_BROWSE_PREFS`.
   * Returns false when the write failed (state is still reset for this session).
   */
  reset: () => boolean
}

/**
 * Library browse view state (sidebar filter, sort, Grid ⇄ Table, table selection). Sort and
 * layout are remembered — the last choice is the default, so there is no Settings page for them.
 */
export const useLibraryBrowseStore = create<LibraryBrowseState>()((set, get) => ({
  ...loadPrefs(),
  filter: 'all',
  selectedBookId: null,
  setFilter: (filter) => set({ filter, selectedBookId: null }),
  setSort: (sort) => {
    set({ sort })
    savePrefs({ sort, layout: get().layout })
  },
  setLayout: (layout) => {
    set({ layout, selectedBookId: layout === 'grid' ? null : get().selectedBookId })
    savePrefs({ sort: get().sort, layout })
  },
  selectBook: (selectedBookId) => set({ selectedBookId }),
  reset: () => {
    const { sort, layout } = DEFAULT_LIBRARY_BROWSE_PREFS
    set({ sort, layout, selectedBookId: null })
    return savePrefs({ sort, layout })
  },
}))
