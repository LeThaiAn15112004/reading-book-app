import { create } from 'zustand'
import {
  LIBRARY_SORTS,
  type LibraryBrowseFilter,
  type LibraryLayout,
  type LibrarySortId,
} from './libraryBrowse'

const PREFS_STORAGE_KEY = 'reading-book.library.browse-prefs.v1'

/** Grid / List of every collection page (spec 015 FR-021: one choice for all collections). */
export type CollectionView = 'grid' | 'list'

type BrowsePrefs = { sort: LibrarySortId; layout: LibraryLayout; collectionView: CollectionView }

/** Single source of the Library view defaults (first run and Settings → Reset App Settings). */
export const DEFAULT_LIBRARY_BROWSE_PREFS: Readonly<BrowsePrefs> = {
  sort: 'recently-added',
  layout: 'grid',
  collectionView: 'grid',
}

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
      collectionView:
        parsed?.collectionView === 'list' || parsed?.collectionView === 'grid'
          ? parsed.collectionView
          : DEFAULT_LIBRARY_BROWSE_PREFS.collectionView,
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
  setCollectionView: (collectionView: CollectionView) => void
  selectBook: (bookId: string | null) => void
  /**
   * Settings → Advanced → Reset App Settings: sort, layout and the collection view back to
   * `DEFAULT_LIBRARY_BROWSE_PREFS`.
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
    savePrefs({ sort, layout: get().layout, collectionView: get().collectionView })
  },
  setLayout: (layout) => {
    set({ layout, selectedBookId: layout === 'grid' ? null : get().selectedBookId })
    savePrefs({ sort: get().sort, layout, collectionView: get().collectionView })
  },
  setCollectionView: (collectionView) => {
    set({ collectionView })
    savePrefs({ sort: get().sort, layout: get().layout, collectionView })
  },
  selectBook: (selectedBookId) => set({ selectedBookId }),
  reset: () => {
    const { sort, layout, collectionView } = DEFAULT_LIBRARY_BROWSE_PREFS
    set({ sort, layout, collectionView, selectedBookId: null })
    return savePrefs({ sort, layout, collectionView })
  },
}))
