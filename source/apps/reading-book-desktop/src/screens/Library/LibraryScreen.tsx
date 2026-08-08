import {
  ImportConflictDialog,
  ImportProgressDialog,
  ImportToast,
  ImportUrlDialog,
} from '../../components/import'
import {
  BootErrorBanner,
  CollectionsHub,
  ContinueReading,
  FilteredListView,
  LibraryBookInfoDialog,
  LibraryEmptyState,
  LibraryHint,
  LibraryShelves,
  LibraryTopBar,
  NewCollectionDialog,
  ShelfDetailView,
  ShelfRailCard,
} from './components'
import type { ShelfRailContent } from './components'
import { useLibraryScreen } from './logic'

/** SCR-01 — Library hub shell (menubar + top bar + format hint). */
export function LibraryScreen() {
  const {
    navigate,
    bootError,
    searchQuery,
    setSearchQuery,
    bookInfoId,
    setBookInfoId,
    bookInfoBook,
    openReader,
    handleOpenNotes,
    handleBookInfo,
    toast,
    clearToast,
    progress,
    conflict,
    urlDialogOpen,
    setUrlDialogOpen,
    handleFromDevice,
    handleFromUrl,
    handleUrlSubmit,
    handleConflictDiscard,
    handleConflictOpenExisting,
    view,
    handleOpenShelf,
    handleCloseShelf,
    goCollections,
    openCollection,
    collections,
    newCollectionOpen,
    setNewCollectionOpen,
    handleCreateCollection,
    isEmpty,
    continueBook,
    searchActive,
    noSearchMatches,
    showShelves,
    shelfCounts,
    activeShelf,
    shelfItems,
    shelfRailBooks,
    filterConfig,
    filterItems,
    activeCollection,
    collectionItems,
  } = useLibraryScreen()

  const shelfRailContent: ShelfRailContent = {}
  for (const shelfId of ['reading', 'completed', 'not-started'] as const) {
    const rows = shelfRailBooks[shelfId]
    if (rows.length === 0) continue
    shelfRailContent[shelfId] = rows.map((b) => (
      <ShelfRailCard key={b.id} book={b} onOpen={openReader} />
    ))
  }

  return (
    <div className="lib-chrome relative flex h-full w-full select-none overflow-hidden font-[system-ui,'Segoe_UI',sans-serif] text-lib-text antialiased">
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {activeShelf ? (
          <ShelfDetailView
            title={activeShelf.title}
            items={shelfItems}
            onBack={handleCloseShelf}
            onOpenItem={openReader}
            onBookInfo={handleBookInfo}
          />
        ) : view.kind === 'filter' && filterConfig ? (
          <FilteredListView
            title={filterConfig.title}
            emptyMessage={filterConfig.empty}
            items={filterItems}
            onOpenItem={openReader}
            onBookInfo={handleBookInfo}
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
            onBookInfo={handleBookInfo}
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

                {!isEmpty && continueBook ? (
                  <ContinueReading
                    book={continueBook}
                    onResume={openReader}
                    onOpenNotes={handleOpenNotes}
                  />
                ) : null}

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

      <LibraryBookInfoDialog
        open={bookInfoId !== null}
        book={
          bookInfoBook
            ? {
                id: bookInfoBook.id,
                title: bookInfoBook.title,
                author: bookInfoBook.author,
                fileName: bookInfoBook.fileName,
                format: bookInfoBook.format,
                coverUrl: bookInfoBook.coverUrl,
                genre: bookInfoBook.genre,
                genres: bookInfoBook.genres,
                fileSizeBytes: bookInfoBook.fileSizeBytes,
                pageCount: bookInfoBook.pageCount,
                description: bookInfoBook.description,
              }
            : null
        }
        onClose={() => setBookInfoId(null)}
      />
    </div>
  )
}
