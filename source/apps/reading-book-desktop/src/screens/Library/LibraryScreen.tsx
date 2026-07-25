import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  useCollections,
  useLibraryBooks,
  useLibraryImport,
  useLibraryView,
} from '@reading-book/shared/hooks/library'
import {
  ImportConflictDialog,
  ImportProgressDialog,
  ImportToast,
  ImportUrlDialog,
} from '../../components/import'
import { importApi, libraryApi } from '../../bridge'
import { AppSidebar } from '../../utils'
import type { BootLocationState } from '../boot'
import {
  BootErrorBanner,
  CollectionsHub,
  ContinueReading,
  FilteredListView,
  LIBRARY_SHELVES,
  LibraryEmptyState,
  LibraryHint,
  LibraryShelves,
  LibraryTopBar,
  NewCollectionDialog,
  ShelfDetailView,
  ShelfRailCard,
} from './components'
import type { ShelfDetailItemData, ShelfRailContent } from './components'
import {
  NAV_FILTERS,
  filterByNav,
  filterByShelf,
  matchesSearch,
  pickContinueReading,
  toShelfDetailItem,
  type LibraryBook,
} from './libraryModel'

/** SCR-01 — Library hub shell (sidebar + top bar + format hint). */
export function LibraryScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const bootError = (location.state as BootLocationState | null)?.bootError
  const [searchQuery, setSearchQuery] = useState('')

  const { books, refreshLibrary } = useLibraryBooks({
    client: libraryApi,
  })

  function openReader(bookId: string) {
    navigate(`/reader/${bookId}`)
  }

  function handleOpenNotes(bookId: string) {
    // Notes tab wiring lands with Reader chrome (G5); open book for now.
    openReader(bookId)
  }

  const {
    toast,
    clearToast,
    showToast,
    progress,
    conflict,
    urlDialogOpen,
    setUrlDialogOpen,
    handleFromDevice,
    handleFromUrl,
    handleUrlSubmit,
    handleConflictDiscard,
    handleConflictOpenExisting,
  } = useLibraryImport({
    client: importApi,
    onImported: refreshLibrary,
    onOpenExisting: openReader,
  })

  const {
    view,
    sidebarActive,
    handleOpenShelf,
    handleCloseShelf,
    handleStubNav,
    goHub,
    goCollections,
    openCollection,
  } = useLibraryView({
    onComingSoon: () => showToast('Coming soon.', 'info'),
  })

  const {
    collections,
    newCollectionOpen,
    setNewCollectionOpen,
    handleCreateCollection,
  } = useCollections({
    onCreated: (created) =>
      showToast(`Created “${created.name}” (session stub).`, 'info'),
  })

  const bookList = books ?? []
  const isEmpty = books !== null && books.length === 0
  const showHubChrome = view.kind === 'hub'
  const continueBook = pickContinueReading(bookList)
  const searchedBooks = bookList.filter((b) => matchesSearch(b, searchQuery))
  const searchActive = searchQuery.trim().length > 0
  const noSearchMatches =
    showHubChrome && searchActive && !isEmpty && searchedBooks.length === 0
  const showShelves =
    showHubChrome && books !== null && books.length > 0 && !noSearchMatches
  const shelfCounts = {
    reading: searchedBooks.filter((b) => b.status === 'reading').length,
    completed: searchedBooks.filter((b) => b.status === 'completed').length,
    'not-started': searchedBooks.filter((b) => b.status === 'not-started')
      .length,
  }

  const activeShelf =
    view.kind === 'shelf'
      ? LIBRARY_SHELVES.find((s) => s.id === view.shelfId)
      : undefined

  const shelfItems: ShelfDetailItemData[] =
    view.kind === 'shelf'
      ? filterByShelf(searchedBooks, view.shelfId).map((b) =>
          toShelfDetailItem(b),
        )
      : []

  const shelfRailContent: ShelfRailContent = {}
  for (const shelfId of ['reading', 'completed', 'not-started'] as const) {
    const rows = filterByShelf(searchedBooks, shelfId)
    if (rows.length === 0) continue
    shelfRailContent[shelfId] = rows.map((b) => (
      <ShelfRailCard key={b.id} book={b} onOpen={openReader} />
    ))
  }

  const filterConfig =
    view.kind === 'filter' ? NAV_FILTERS[view.filterId] : undefined
  const filterItems =
    view.kind === 'filter'
      ? filterByNav(bookList, view.filterId).map((b) =>
          toShelfDetailItem(b, {
            forceFavoriteStar: filterConfig?.showStar,
          }),
        )
      : []

  const activeCollection =
    view.kind === 'collection'
      ? collections.find((c) => c.id === view.collectionId)
      : undefined
  const collectionItems: ShelfDetailItemData[] = activeCollection
    ? activeCollection.bookIds
        .map((id) => bookList.find((b) => b.id === id))
        .filter((b): b is LibraryBook => Boolean(b))
        .map((b) => toShelfDetailItem(b))
    : []

  return (
    <div className="lib-chrome relative flex h-full w-full select-none overflow-hidden bg-[radial-gradient(ellipse_80%_50%_at_20%_-10%,rgba(245,158,11,0.08),transparent_55%),radial-gradient(circle_at_80%_100%,rgba(30,58,138,0.18),transparent_45%),radial-gradient(circle,#1e293b_0%,#0f172a_100%)] font-[system-ui,'Segoe_UI',sans-serif] text-lib-text antialiased">
      <AppSidebar
        activeId={sidebarActive}
        onStubNav={handleStubNav}
        onLibraryNav={goHub}
      />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {activeShelf ? (
          <ShelfDetailView
            title={activeShelf.title}
            items={shelfItems}
            onBack={handleCloseShelf}
            onOpenItem={openReader}
          />
        ) : view.kind === 'filter' && filterConfig ? (
          <FilteredListView
            title={filterConfig.title}
            emptyMessage={filterConfig.empty}
            items={filterItems}
            onOpenItem={openReader}
          />
        ) : view.kind === 'collections' ? (
          <CollectionsHub
            collections={collections}
            onNewCollection={() => setNewCollectionOpen(true)}
            onOpenCollection={openCollection}
          />
        ) : activeCollection ? (
          <ShelfDetailView
            title={activeCollection.name}
            items={collectionItems}
            onBack={goCollections}
            onOpenItem={openReader}
            countLabel={
              collectionItems.length === 1
                ? '1 book'
                : `${collectionItems.length} books`
            }
            emptyMessage="No books in this collection yet."
            backAriaLabel="Back to collections"
          />
        ) : (
          <>
            <LibraryTopBar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onFromDevice={handleFromDevice}
              onFromUrl={handleFromUrl}
            />

            <div className="flex-1 overflow-x-hidden overflow-y-auto py-7">
              <div className="mx-auto w-full max-w-[1180px] px-7">
                {bootError ? (
                  <BootErrorBanner
                    message={bootError}
                    onRetry={() => navigate('/', { replace: true })}
                  />
                ) : null}

                <LibraryHint />

                {isEmpty ? (
                  <LibraryEmptyState
                    onFromDevice={handleFromDevice}
                    onFromUrl={handleFromUrl}
                  />
                ) : null}

                {/* T1.7: only when a book has last_read (hidden for empty / never-opened). */}
                {!isEmpty && continueBook ? (
                  <ContinueReading
                    book={continueBook}
                    onResume={openReader}
                    onOpenNotes={handleOpenNotes}
                  />
                ) : null}

                {/* Shelves + book cover rails from listBooks. */}
                {showShelves ? (
                  <LibraryShelves
                    onOpenShelf={handleOpenShelf}
                    counts={shelfCounts}
                    railContent={shelfRailContent}
                    hideEmpty={searchActive}
                  />
                ) : null}

                {noSearchMatches ? (
                  <p
                    className="mt-6 text-center text-sm text-lib-faint"
                    role="status"
                  >
                    No matching imported files found.
                  </p>
                ) : null}
              </div>
            </div>
          </>
        )}
      </main>

      <ImportToast
        open={toast !== null}
        message={toast?.message ?? ''}
        variant={toast?.variant ?? 'info'}
        onClose={clearToast}
      />

      <NewCollectionDialog
        open={newCollectionOpen}
        onClose={() => setNewCollectionOpen(false)}
        onCreate={handleCreateCollection}
      />

      <ImportUrlDialog
        open={urlDialogOpen}
        onClose={() => setUrlDialogOpen(false)}
        onSubmit={handleUrlSubmit}
      />

      <ImportProgressDialog
        open={progress !== null}
        status={progress?.status ?? 'Importing…'}
        filename={progress?.filename}
      />

      <ImportConflictDialog
        open={conflict !== null}
        message={conflict?.message}
        onDiscard={handleConflictDiscard}
        onOpenExisting={handleConflictOpenExisting}
      />
    </div>
  )
}
