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
  AddBooksPicker,
  BookItemMenu,
  CloudSourcesHub,
  CollectionCovers,
  CollectionItemMenu,
  CollectionsHub,
  ConfirmBookActionDialog,
  EditBookMetadataDialog,
  LibraryBookInfoDialog,
  MoreVertIcon,
  NewCollectionDialog,
  PlusIcon,
  ShelfDetailView,
} from './components'
import { menuPointFromButton } from './components/collections/menuPoint'
import { useAddBooksPickerStore } from './logic/addBooksPickerStore'
import { collectionCoverSlots, type CollectionSummary } from '@core'
import { annotationTransferApi } from '../../bridge'
import { ImportPreviewDialog } from '../../components/annotation-transfer/ImportPreviewDialog'
import { useAnnotationTransferStore } from '../Reader/logic/annotationTransferStore'
import { useLibraryImportStore } from '../../hooks/library'
import { annotationExportMessage } from '../../utils/annotationTransferMessages'
import { useShortcutAction } from '../../shortcuts'
import { uiText, useT } from '../../i18n'
import { Suspense, lazy, useMemo } from 'react'
import { isMobileHost } from '../../platforms/host'
import { LibraryHub, type LibraryHubProps } from './LibraryHub'
import { useLibraryScreen } from './logic'

/**
 * The phone Library home (spec 013). A separate chunk: `isMobileHost()` is false in Electron, so `lazy` never starts
 * loading it on Desktop.
 */
const MobileLibraryHub = lazy(() => import('./phone/MobileLibraryHub'))

/** Desktop hub, or the phone hub on the Mobile host — same props (FR-029: one Library, two presentations). */
function LibraryHome({ onReadAgain, ...props }: LibraryHubProps & { onReadAgain: (bookId: string) => void }) {
  if (!isMobileHost()) return <LibraryHub {...props} />
  return (
    <Suspense fallback={<div className="flex-1" aria-busy="true" />}>
      <MobileLibraryHub {...props} onReadAgain={onReadAgain} />
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
    handleReadAgain,
    handleMarkReading,
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
    collectionMenu,
    menuCollection,
    openCollectionMenu,
    closeCollectionMenu,
    handleAddBooksToCollection,
    importBooksFromPicker,
    pickerBooks,
    cloudSources,
    books,
    bookList,
  } = useLibraryScreen()
  useShortcutAction('general.openBook', () => void handleFromDevice())
  const phone = isMobileHost()
  const openPicker = useAddBooksPickerStore((s) => s.openFor)
  const booksById = useMemo(() => new Map(bookList.map((book) => [book.id, book])), [bookList])

  /** Spec 015 US3: the covers of the first three books of a collection (cards and phone rows). */
  function renderCovers(collection: CollectionSummary, variant: 'card' | 'stack') {
    return (
      <CollectionCovers
        variant={variant}
        booksById={booksById}
        slots={collectionCoverSlots(collection.bookIds, (id) => booksById.has(id))}
      />
    )
  }

  /** "Add books" on the collection page (FR-007): label on Desktop, icon-only 44 px on the phone. */
  const addBooksButton = (collectionId: string, inEmptyState = false) => (
    <button
      type="button"
      className={`inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border-none bg-lib-accent text-[13px] font-semibold text-lib-on-accent transition-colors hover:bg-lib-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lib-accent ${
        inEmptyState ? 'h-11 px-5' : phone ? 'size-11' : 'h-9 px-3.5'
      }`}
      aria-label={!inEmptyState && phone ? t('library.collections.addBooks') : undefined}
      onClick={() => openPicker(collectionId)}
    >
      <PlusIcon className="size-4" />
      {!inEmptyState && phone ? null : <span>{t('library.collections.addBooks')}</span>}
    </button>
  )

  return (
    <div className="lib-chrome relative flex h-full w-full select-none overflow-hidden font-[system-ui,'Segoe_UI',sans-serif] text-lib-text antialiased">
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {view.kind === 'collections' ? (
          <CollectionsHub
            collections={collections}
            menuCollectionId={collectionMenu?.collectionId ?? null}
            onNewCollection={() => openNewCollection()}
            onOpenCollection={openCollection}
            onOpenMenu={openCollectionMenu}
            renderCovers={renderCovers}
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
            description={activeCollection.description}
            items={collectionItems}
            onBack={goCollections}
            onOpenItem={openReader}
            onBookMenu={handleOpenBookMenu}
            countLabel={t('library.bookCount', { count: collectionItems.length })}
            emptyMessage={t('library.shelf.emptyCollection')}
            emptyState={
              <div className="mx-auto flex max-w-md flex-col items-center gap-2 py-14 text-center">
                <p className="m-0 text-base font-semibold text-lib-text-strong">{t('library.shelf.emptyCollection')}</p>
                <p className="m-0 mb-4 text-sm text-lib-muted">{t('library.collections.emptyAddHint')}</p>
                {addBooksButton(activeCollection.id, true)}
              </div>
            }
            headerActions={
              <>
                {addBooksButton(activeCollection.id)}
                <button
                  type="button"
                  className={`inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent text-lib-muted transition-colors hover:bg-lib-surface-hover hover:text-lib-text-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-lib-accent ${
                    phone ? 'size-11' : 'size-9'
                  }`}
                  aria-haspopup="menu"
                  aria-expanded={collectionMenu?.collectionId === activeCollection.id}
                  aria-label={t('library.collections.moreActionsAria', { name: activeCollection.name })}
                  title={t('library.menu.moreActions')}
                  onClick={(event) =>
                    openCollectionMenu(activeCollection.id, phone ? null : menuPointFromButton(event.currentTarget))
                  }
                >
                  <MoreVertIcon className="size-5" />
                </button>
              </>
            }
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
            onReadAgain={(bookId) => void handleReadAgain(bookId)}
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

      {collectionMenu && menuCollection ? (
        <CollectionItemMenu
          collection={menuCollection}
          point={collectionMenu.point}
          onClose={closeCollectionMenu}
          onEdit={() => openEditCollection(menuCollection.id)}
          onDelete={() => setPendingCollectionDeleteId(menuCollection.id)}
        />
      ) : null}

      {activeCollection ? (
        <AddBooksPicker
          books={pickerBooks}
          collection={activeCollection}
          onConfirm={(bookIds) => handleAddBooksToCollection(activeCollection.id, bookIds)}
          onImportBooks={importBooksFromPicker}
        />
      ) : null}

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
          onReadAgain={(bookId) => void handleReadAgain(bookId)}
          onMarkReading={(bookId) => void handleMarkReading(bookId)}
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
                ? isMobileHost()
                  ? // Mobile keeps its own copy of every book and deletes it with the book (spec 013 FR-018).
                    t('library.confirm.removePhoneBody', { title: pendingRemovalBook.title })
                  : pendingRemovalBook.fileStorage === 'referenced'
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
