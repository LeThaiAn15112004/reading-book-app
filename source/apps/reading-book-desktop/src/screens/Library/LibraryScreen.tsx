// @refresh reset
import {
  ImportConflictDialog,
  ImportProgressDialog,
  ImportToast,
  ImportUrlDialog,
} from '../../components/import'
import {
  BookItemMenu,
  CloudSourcesHub,
  CollectionsHub,
  ConfirmBookActionDialog,
  EditBookMetadataDialog,
  LibraryBookInfoDialog,
  NewCollectionDialog,
  ShelfDetailView,
} from './components'
import { useShortcutAction } from '../../shortcuts'
import { LibraryHub } from './LibraryHub'
import { useLibraryScreen } from './logic'

/**
 * SCR-01 — Library shell. `hub` = the browse home (sidebar + grid/table, `LibraryHub`); the top
 * navigation's Collections / Cloud Sources replace it with their own views.
 */
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
    canCancel,
    conflict,
    urlDialog,
    closeUrlDialog,
    handleFromDevice,
    handleFromUrl,
    handleUrlSubmit,
    handleCancelImport,
    handleConflictDiscard,
    handleConflictOpenExisting,
    view,
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
    activeCollection,
    collectionItems,
    collectionViewMode,
    setCollectionViewMode,
    cloudSources,
    books,
    bookList,
  } = useLibraryScreen()
  useShortcutAction('general.openBook', () => void handleFromDevice())

  return (
    <div className="lib-chrome relative flex h-full w-full select-none overflow-hidden font-[system-ui,'Segoe_UI',sans-serif] text-lib-text antialiased">
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {view.kind === 'collections' ? (
          <CollectionsHub
            collections={collections}
            onNewCollection={() => openNewCollection()}
            onOpenCollection={openCollection}
            onEditCollection={openEditCollection}
            onDeleteCollection={setPendingCollectionDeleteId}
          />
        ) : view.kind === 'cloud-sources' ? (
          <CloudSourcesHub
            key={view.provider}
            provider={view.provider}
            info={cloudSources.providers[view.provider]}
            entries={cloudSources.catalogs[view.provider] ?? []}
            folderPath={cloudSources.folderPaths[view.provider]}
            onFolderPathChange={(value) => cloudSources.setFolderPath(view.provider, value)}
            isConnecting={cloudSources.connectingProvider === view.provider}
            isSyncing={cloudSources.syncingProvider === view.provider}
            downloadingId={cloudSources.downloadingId}
            downloadProgress={cloudSources.downloadProgress}
            onConnect={() => cloudSources.connect(view.provider)}
            onDisconnect={() => cloudSources.disconnect(view.provider)}
            onSync={() => cloudSources.sync(view.provider)}
            onDownload={(entry) => void cloudSources.download(view.provider, entry)}
            onCancelDownload={cloudSources.cancelDownload}
            books={bookList}
            onOpenBook={openReader}
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
            viewMode={collectionViewMode}
            onViewModeChange={setCollectionViewMode}
          />
        ) : (
          <LibraryHub
            books={books}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onFromDevice={handleFromDevice}
            onFromUrl={handleFromUrl}
            bootError={bootError}
            onRetryBoot={() => navigate('/', { replace: true })}
            onOpenBook={openReader}
            onBookMenu={handleOpenBookMenu}
            onToggleFavorite={handleToggleFavorite}
          />
        )}
      </main>

      <ImportToast
        open={toast !== null}
        message={toast?.message ?? ''}
        variant={toast?.variant ?? 'info'}
        action={toast?.action}
        onClose={clearToast}
      />

      <NewCollectionDialog
        open={newCollectionOpen}
        collection={editingCollection}
        onClose={closeCollectionDialog}
        onSubmit={submitCollection}
      />

      <ImportUrlDialog
        open={urlDialog.open}
        initialUrl={urlDialog.initialUrl}
        submitError={urlDialog.error}
        onClose={closeUrlDialog}
        onSubmit={(url) => void handleUrlSubmit(url)}
      />

      <ImportProgressDialog
        open={progress !== null}
        status={progress?.stage === 'downloading' ? 'Downloading…' : 'Importing…'}
        filename={progress?.filename}
        receivedBytes={progress?.receivedBytes}
        totalBytes={progress?.totalBytes}
        onCancel={canCancel ? handleCancelImport : undefined}
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
              ? `“${pendingRemovalBook.title}” will disappear from the library. ${
                  pendingRemovalBook.fileStorage === 'referenced'
                    ? 'Your original file will not be touched.'
                    : 'Its imported file will be kept.'
                }`
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
