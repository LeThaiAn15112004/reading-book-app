// @refresh reset
import {
  ImportConflictDialog,
  ImportProgressDialog,
  ImportToast,
  ImportUrlDialog,
} from '../../components/import'
import {
  BootErrorBanner,
  BookItemMenu,
  CollectionsHub,
  ConfirmBookActionDialog,
  ContinueReading,
  EditBookMetadataDialog,
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
    editMetadataBook,
    setEditMetadataId,
    bookMenu,
    menuBook,
    setBookMenu,
    handleOpenBookMenu,
    pendingRemoval,
    pendingRemovalBook,
    setPendingRemoval,
    confirmPendingRemoval,
    handleToggleFavorite,
    handleMarkCompleted,
    handleSaveMetadata,
    handleOpenFileLocation,
    handleCopyFilePath,
    handleAddToCollection,
    handleRemoveFromCollection,
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
    openNewCollection,
    openEditCollection,
    closeCollectionDialog,
    submitCollection,
    editingCollection,
    pendingCollectionDelete,
    setPendingCollectionDeleteId,
    confirmCollectionDelete,
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
      <ShelfRailCard
        key={b.id}
        book={b}
        onOpen={openReader}
        onBookMenu={handleOpenBookMenu}
      />
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
            onBookMenu={handleOpenBookMenu}
          />
        ) : view.kind === 'filter' && filterConfig ? (
          <FilteredListView
            title={filterConfig.title}
            emptyMessage={filterConfig.empty}
            items={filterItems}
            onOpenItem={openReader}
            onBookMenu={handleOpenBookMenu}
          />
        ) : view.kind === 'collections' ? (
          <CollectionsHub
            collections={collections}
            onNewCollection={() => openNewCollection()}
            onOpenCollection={openCollection}
            onEditCollection={openEditCollection}
            onDeleteCollection={setPendingCollectionDeleteId}
          />
        ) : activeCollection ? (
          <ShelfDetailView
            title={activeCollection.name}
            items={collectionItems}
            onBack={goCollections}
            onOpenItem={openReader}
            onBookMenu={handleOpenBookMenu}
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
                    onBookMenu={handleOpenBookMenu}
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
        collection={editingCollection}
        onClose={closeCollectionDialog}
        onSubmit={submitCollection}
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

      {bookMenu && menuBook ? (
        <BookItemMenu
          book={menuBook}
          point={bookMenu.point}
          collections={collections}
          onClose={() => setBookMenu(null)}
          onResume={openReader}
          onAddToCollection={handleAddToCollection}
          activeCollectionId={activeCollection?.id}
          onRemoveFromCollection={handleRemoveFromCollection}
          onNewCollection={() => openNewCollection(menuBook.id)}
          onToggleFavorite={handleToggleFavorite}
          onMarkCompleted={handleMarkCompleted}
          onDetails={handleBookInfo}
          onEditMetadata={setEditMetadataId}
          onOpenFileLocation={handleOpenFileLocation}
          onCopyFilePath={handleCopyFilePath}
          onRemove={(bookId) =>
            setPendingRemoval({ bookId, kind: 'remove' })
          }
          onDeleteFile={(bookId) =>
            setPendingRemoval({ bookId, kind: 'delete-file' })
          }
        />
      ) : null}

      <EditBookMetadataDialog
        book={editMetadataBook}
        onClose={() => setEditMetadataId(null)}
        onSave={handleSaveMetadata}
      />

      {pendingRemoval && pendingRemovalBook ? (
        <ConfirmBookActionDialog
          title={
            pendingRemoval.kind === 'remove'
              ? 'Remove from library?'
              : 'Delete file permanently?'
          }
          message={
            pendingRemoval.kind === 'remove'
              ? `“${pendingRemovalBook.title}” will disappear from the library. Its imported file will be kept.`
              : `“${pendingRemovalBook.title}” and its imported file will be permanently deleted. This cannot be undone.`
          }
          confirmLabel={
            pendingRemoval.kind === 'remove' ? 'Remove' : 'Delete file'
          }
          destructive={pendingRemoval.kind === 'delete-file'}
          onCancel={() => setPendingRemoval(null)}
          onConfirm={confirmPendingRemoval}
        />
      ) : null}

      {pendingCollectionDelete ? (
        <ConfirmBookActionDialog
          title="Delete collection?"
          message={`“${pendingCollectionDelete.name}” will be deleted. Books in it will remain in your library.`}
          confirmLabel="Delete collection"
          destructive
          onCancel={() => setPendingCollectionDeleteId(null)}
          onConfirm={confirmCollectionDelete}
        />
      ) : null}
    </div>
  )
}
