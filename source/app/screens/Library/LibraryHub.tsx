import { useEffect, useMemo, useState } from 'react'
import { allSelected, bulkFavoriteTarget, pruneSelection } from '@core'
import { useLibrarySelectionStore } from './logic/librarySelectionStore'
import { DesktopSelectionBar } from './components/browse/DesktopSelectionBar'
import { BulkCollectionChooser, type BookSelection } from './components/browse'
import type { CollectionSummary, LibraryBook } from '@core'
import { useSearchHistoryStore } from '../../hooks/library/index.js'
import { useT } from '../../i18n'
import { ImportAddedNote, ImportPlaceholderItems } from '../../components/import/LibraryImportPlaceholders'
import { useImportSlot } from '../../components/import/useImportSlot'
import {
  BootErrorBanner,
  ContinueReading,
  LibraryBookDetailPanel,
  LibraryBookGrid,
  LibraryBookTable,
  LibraryBrowseToolbar,
  LibraryEmptyState,
  LibrarySidebar,
  LibraryTopBar,
  type BookMenuPoint,
} from './components'
import {
  LIBRARY_BROWSE_FILTERS,
  LIBRARY_FILTER_EMPTY,
  useLibraryBrowse,
  useLibraryBrowseStore,
} from './logic'

export type LibraryHubProps = {
  /** null while the first load is in flight. */
  books: LibraryBook[] | null
  searchQuery: string
  onSearchChange: (value: string) => void
  onFromDevice: () => void
  onFromUrl: () => void
  bootError?: string
  onRetryBoot: () => void
  onOpenBook: (bookId: string) => void
  onBookMenu: (bookId: string, point: BookMenuPoint) => void
  onToggleFavorite: (book: LibraryBook) => void
  /** Select mode (Desktop "Select" button, phone long press): the collections to add to, and the bulk actions. */
  collections: CollectionSummary[]
  onBulkFavorite: (ids: string[]) => Promise<void>
  onBulkAddToCollection: (collectionId: string, ids: string[]) => Promise<boolean>
  /** Opens the removal confirmation for these books. */
  onBulkRemove: (ids: string[]) => void
}

/**
 * SCR-01 Library home (layout A + B + D): sidebar filters | top bar · Continue Reading (All
 * books only) · toolbar · Grid or Table — and, in Table, a detail panel for the selected row.
 */
export function LibraryHub({
  books,
  searchQuery,
  onSearchChange,
  onFromDevice,
  onFromUrl,
  bootError,
  onRetryBoot,
  onOpenBook,
  onBookMenu,
  onToggleFavorite,
  collections,
  onBulkFavorite,
  onBulkAddToCollection,
  onBulkRemove,
}: LibraryHubProps) {
  const bookList = books ?? []
  const { filter, sort, layout, searchActive, counts, visibleBooks, continueBooks, selectedBook } =
    useLibraryBrowse(bookList, searchQuery)
  const t = useT()
  // Spec 016 (FR-010): coming books in the same grid / table as the books, "All books" only.
  const visibleIds = useMemo(() => visibleBooks.map((b) => b.id), [visibleBooks])
  const slot = useImportSlot(visibleIds, sort, filter === 'all' && !searchActive)
  // Select mode ("Select" button): picked ids, kept to the books shown; Esc or Done leaves it.
  const selecting = useLibrarySelectionStore((s) => s.active)
  const selectedIds = useLibrarySelectionStore((s) => s.ids)
  const [chooserOpen, setChooserOpen] = useState(false)
  useEffect(() => () => useLibrarySelectionStore.getState().clear(), [])
  useEffect(() => {
    const { ids, setIds } = useLibrarySelectionStore.getState()
    const kept = pruneSelection(ids, visibleIds)
    if (kept.length !== ids.length) setIds(kept)
  }, [visibleIds])
  useEffect(() => {
    if (!selecting) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) useLibrarySelectionStore.getState().clear()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selecting])
  const selection = useMemo<BookSelection | undefined>(() => {
    if (!selecting) return undefined
    const picked = new Set(selectedIds)
    const store = useLibrarySelectionStore.getState()
    return { active: true, isSelected: (id) => picked.has(id), onPress: store.toggle, onToggle: store.toggle }
  }, [selecting, selectedIds])
  const everySelected = allSelected(selectedIds, visibleIds)
  const setFilter = useLibraryBrowseStore((s) => s.setFilter)
  const setSort = useLibraryBrowseStore((s) => s.setSort)
  const setLayout = useLibraryBrowseStore((s) => s.setLayout)
  const selectBook = useLibraryBrowseStore((s) => s.selectBook)
  const historyEnabled = useSearchHistoryStore((s) => s.enabled)
  const historyEntries = useSearchHistoryStore((s) => s.entries)
  const recordSearch = useSearchHistoryStore((s) => s.record)
  const removeRecentSearch = useSearchHistoryStore((s) => s.remove)

  const isEmpty = books !== null && books.length === 0
  const filterLabel = t(LIBRARY_BROWSE_FILTERS.find((f) => f.id === filter)?.labelKey ?? 'library.filters.all')

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <LibrarySidebar active={filter} counts={counts} onSelect={setFilter} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <LibraryTopBar
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          recentSearches={historyEnabled ? historyEntries : []}
          onCommitSearch={recordSearch}
          onRemoveRecentSearch={removeRecentSearch}
          onFromDevice={onFromDevice}
          onFromUrl={onFromUrl}
        />

        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto py-6">
            <div className="mx-auto w-full max-w-[1400px] px-6">
              {bootError ? <BootErrorBanner message={bootError} onRetry={onRetryBoot} /> : null}

              {isEmpty ? (
                <LibraryEmptyState onFromDevice={onFromDevice} onFromUrl={onFromUrl} />
              ) : books !== null ? (
                <>
                  {continueBooks.length > 0 ? (
                    <ContinueReading books={continueBooks} onResume={onOpenBook} onBookMenu={onBookMenu} />
                  ) : null}

                  {selecting ? (
                    <DesktopSelectionBar
                      count={selectedIds.length}
                      allSelected={everySelected}
                      favoriteTarget={bulkFavoriteTarget(bookList, selectedIds)}
                      onDone={() => useLibrarySelectionStore.getState().clear()}
                      onToggleAll={() => useLibrarySelectionStore.getState().setIds(everySelected ? [] : visibleIds.slice())}
                      onFavorite={() => void onBulkFavorite(selectedIds.slice())}
                      onAddToCollection={() => setChooserOpen(true)}
                      onRemove={() => onBulkRemove(selectedIds.slice())}
                    />
                  ) : (
                    <LibraryBrowseToolbar
                      title={searchActive ? `${filterLabel} · “${searchQuery.trim()}”` : filterLabel}
                      count={visibleBooks.length}
                      sort={sort}
                      onSortChange={setSort}
                      layout={layout}
                      onLayoutChange={setLayout}
                      onStartSelect={visibleBooks.length > 0 ? () => useLibrarySelectionStore.getState().start() : undefined}
                    />
                  )}
                  {chooserOpen && selecting ? (
                    <BulkCollectionChooser
                      layout="dialog"
                      collections={collections}
                      count={selectedIds.length}
                      onClose={() => setChooserOpen(false)}
                      onChoose={(collectionId) => onBulkAddToCollection(collectionId, selectedIds.slice())}
                    />
                  ) : null}

                  <ImportAddedNote slot={slot} />

                  {visibleBooks.length === 0 && slot.placeholders.length === 0 ? (
                    <p className="mt-10 text-center text-sm text-lib-faint" role="status">
                      {searchActive ? t('library.filterEmpty.noMatch') : t(LIBRARY_FILTER_EMPTY[filter])}
                    </p>
                  ) : layout === 'table' ? (
                    <LibraryBookTable
                      books={visibleBooks}
                      selectedBookId={selectedBook?.id ?? null}
                      onSelect={selectBook}
                      onOpen={onOpenBook}
                      onBookMenu={onBookMenu}
                      leadCount={slot.leadCount}
                      inserted={<ImportPlaceholderItems placeholders={slot.placeholders} as="tr" />}
                      selection={selection}
                    />
                  ) : (
                    <LibraryBookGrid
                      books={visibleBooks}
                      onOpen={onOpenBook}
                      onBookMenu={onBookMenu}
                      leadCount={slot.leadCount}
                      inserted={<ImportPlaceholderItems placeholders={slot.placeholders} as="tile" />}
                      selection={selection}
                    />
                  )}
                </>
              ) : null}
            </div>
          </div>

          {layout === 'table' && selectedBook && !selecting ? (
            <LibraryBookDetailPanel
              book={selectedBook}
              onClose={() => selectBook(null)}
              onOpen={onOpenBook}
              onToggleFavorite={onToggleFavorite}
              onBookMenu={onBookMenu}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
