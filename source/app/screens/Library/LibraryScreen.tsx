// @refresh reset
import {
  AudiobookZipImportDialog,
  AudiobookZipJobPanel,
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
import { annotationTransferApi } from '../../bridge'
import { ImportPreviewDialog } from '../../components/annotation-transfer/ImportPreviewDialog'
import { useAnnotationTransferStore } from '../Reader/logic/annotationTransferStore'
import { useLibraryImportStore } from '../../hooks/library'
import { annotationExportMessage } from '../../utils/annotationTransferMessages'
import { useShortcutAction } from '../../shortcuts'
import { uiText, useT } from '../../i18n'
import { Suspense, lazy } from 'react'
import { isMobileHost } from '../../platforms/host'
import { LibraryHub, type LibraryHubProps } from './LibraryHub'
import { useLibraryScreen } from './logic'

/**
 * The phone Library home (spec 013). A separate chunk: `isMobileHost()` is false in Electron, so `lazy` never starts
 * loading it on Desktop.
 */
const MobileLibraryHub = lazy(() => import('./phone/MobileLibraryHub'))

/** Desktop hub, or the phone hub on the Mobile host — same props (FR-029: one Library, two presentations). */
function LibraryHome(props: LibraryHubProps) {
  if (!isMobileHost()) return <LibraryHub {...props} />
  return (
    <Suspense fallback={<div className="flex-1" aria-busy="true" />}>
      <MobileLibraryHub {...props} />
    </Suspense>
  )
}

/**
 * SCR-01 — Library shell. `hub` = the browse home (sidebar + grid/table, `LibraryHub`); the top
 * navigation's Collections / Cloud Sources replace it with their own views.
 */
export function LibraryScreen() {
  const t = useT()
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
            countLabel={t('library.bookCount', { count: collectionItems.length })}
            emptyMessage={t('library.shelf.emptyCollection')}
            backAriaLabel={t('library.shelf.backToCollections')}
            viewMode={collectionViewMode}
            onViewModeChange={setCollectionViewMode}
          />
        ) : (
          <LibraryHome
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
        message={toast ? uiText(t, toast.message) : ''}
        variant={toast?.variant ?? 'info'}
        action={toast?.action ? { label: uiText(t, toast.action.label), run: toast.action.run } : undefined}
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

      <AudiobookZipImportDialog />
      <AudiobookZipJobPanel onOpenBook={openReader} />

      <ImportProgressDialog
        open={progress !== null}
        status={progress?.stage === 'downloading' ? t('library.progressDialog.downloading') : t('library.progressDialog.importing')}
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
              chapterCount: bookInfoBook.chapterCount,
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
          onRemoveAudiobook={(bookId) =>
            setPendingRemoval({ bookId, kind: 'remove-audiobook' })
          }
          onExportAnnotations={async (bookId) => {
            const shown = annotationExportMessage(await annotationTransferApi.exportRestore(bookId))
            if (shown) useLibraryImportStore.getState().showToast(shown.message, shown.variant)
          }}
          onImportAnnotations={(bookId) => void useAnnotationTransferStore.getState().startImport(bookId)}
          onExportReadable={async (bookId) => {
            const shown = annotationExportMessage(await annotationTransferApi.exportReadable(bookId), 'readable copy')
            if (shown) useLibraryImportStore.getState().showToast(shown.message, shown.variant)
          }}
        />
      ) : null}

      <ImportPreviewDialog
        onToast={(message) => message && useLibraryImportStore.getState().showToast(message, 'success')}
        bookChoices={(books ?? []).map((b) => ({ id: b.id, title: b.title, format: b.format }))}
      />

      <EditBookMetadataDialog
        book={editMetadataBook}
        onClose={() => setEditMetadataId(null)}
        onSave={handleSaveMetadata}
      />

      {pendingRemoval && pendingRemovalBook ? (
        <ConfirmBookActionDialog
          title={
            pendingRemoval.kind === 'remove'
              ? t('library.confirm.removeTitle')
              : pendingRemoval.kind === 'remove-audiobook'
                ? t('library.confirm.removeAudiobookTitle')
                : t('library.confirm.deleteFileTitle')
          }
          message={
            pendingRemoval.kind === 'remove-audiobook'
              ? pendingRemovalBook.chapterCount
                ? t('library.confirm.removeAudiobookBody', {
                    title: pendingRemovalBook.title,
                    chapters: pendingRemovalBook.chapterCount,
                  })
                : t('library.confirm.removeAudiobookBodyUnknown', { title: pendingRemovalBook.title })
              : pendingRemoval.kind === 'remove'
                ? pendingRemovalBook.fileStorage === 'referenced'
                  ? t('library.confirm.removeReferencedBody', { title: pendingRemovalBook.title })
                  : t('library.confirm.removeManagedBody', { title: pendingRemovalBook.title })
                : t('library.confirm.deleteFileBody', { title: pendingRemovalBook.title })
          }
          confirmLabel={
            pendingRemoval.kind === 'remove'
              ? t('library.confirm.remove')
              : pendingRemoval.kind === 'remove-audiobook'
                ? t('library.confirm.removeAudiobook')
                : t('library.confirm.deleteFile')
          }
          destructive={pendingRemoval.kind !== 'remove'}
          onCancel={() => setPendingRemoval(null)}
          onConfirm={confirmPendingRemoval}
        />
      ) : null}

      {pendingCollectionDelete ? (
        <ConfirmBookActionDialog
          title={t('library.confirm.deleteCollectionTitle')}
          message={t('library.confirm.deleteCollectionBody', { name: pendingCollectionDelete.name })}
          confirmLabel={t('library.confirm.deleteCollection')}
          destructive
          onCancel={() => setPendingCollectionDeleteId(null)}
          onConfirm={confirmCollectionDelete}
        />
      ) : null}
    </div>
  )
}
