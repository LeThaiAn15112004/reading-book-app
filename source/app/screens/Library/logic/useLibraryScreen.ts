// @refresh reset
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  useCollections,
  useLibraryBooks,
  useLibraryImport,
  useLibraryView,
  useZipImportStore,
} from '../../../hooks/library/index.js'
import {
  bulkAddSummary,
  bulkFavoriteTarget,
  bulkResult,
  favoriteChanges,
  removalKindOf,
  type LibraryBook,
  type MessageRef,
} from '@core'
import { importApi, libraryApi } from '../../../bridge'
import { useAppNav, useOpenReading, type AppStubNavId } from '../../../components/chrome'
import type { BootLocationState } from '../../boot'
import type {
  BookMenuPoint,
  BookMetadataValues,
  CollectionMenuPoint,
  ShelfDetailItemData,
} from '../components'
import { useAddBooksPickerStore } from './addBooksPickerStore'
import { sortLibraryBooks } from './libraryBrowse'
import { toShelfDetailItem } from './toShelfDetailItem'
import { canGenerateCover, generateBookCover, markCoverAttempted } from './generateBookCover'
import { useLibraryBrowseStore } from './libraryBrowseStore'
import { useLibrarySelectionStore } from './librarySelectionStore'
import { useCloudSources } from './useCloudSources'
import { audioSessionBookId, endAudioSession } from '../../AudioBook/logic/audioPlayerStore'

type LibraryLocationState = BootLocationState & {
  openNav?: AppStubNavId
}

export type PendingBookRemoval = {
  bookId: string
  kind: 'remove' | 'delete-file' | 'remove-audiobook'
}

/**
 * Desktop Library screen controller — book data, import, mutations, collections and top-level
 * view. Browse concerns (sidebar filter, sort, Grid ⇄ Table, selection) live in
 * `useLibraryBrowse` / `useLibraryBrowseStore`, not here.
 */
export function useLibraryScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const { registerLibraryNav } = useAppNav()
  const { openBook, closeBook } = useOpenReading()
  const locState = location.state as LibraryLocationState | null
  const bootError = locState?.bootError
  const [searchQuery, setSearchQuery] = useState('')
  const [bookInfoId, setBookInfoId] = useState<string | null>(null)
  const [editMetadataId, setEditMetadataId] = useState<string | null>(null)
  const [bookMenu, setBookMenu] = useState<{
    bookId: string
    point: BookMenuPoint
  } | null>(null)
  const [pendingRemoval, setPendingRemoval] =
    useState<PendingBookRemoval | null>(null)
  /** Phone select mode: the books waiting for the "Remove" confirmation. */
  const [pendingBulkRemoval, setPendingBulkRemoval] = useState<string[] | null>(null)
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(
    null,
  )
  const [pendingCollectionDeleteId, setPendingCollectionDeleteId] = useState<
    string | null
  >(null)
  const [pendingCollectionBookId, setPendingCollectionBookId] = useState<
    string | null
  >(null)
  /** Grid / list of every collection page — remembered and reset with the Library prefs (spec 015 FR-021). */
  const collectionViewMode = useLibraryBrowseStore((s) => s.collectionView)
  const setCollectionViewMode = useLibraryBrowseStore((s) => s.setCollectionView)
  const librarySort = useLibraryBrowseStore((s) => s.sort)
  /** The open collection ⋮ menu (spec 015 FR-004): which collection, and where (null = phone sheet / keyboard). */
  const [collectionMenu, setCollectionMenu] = useState<{
    collectionId: string
    point: CollectionMenuPoint | null
  } | null>(null)

  const { books, refreshLibrary } = useLibraryBooks({
    client: libraryApi,
  })

  // Books without a cover (everything but EPUB) get their first page rendered once, one at a time.
  useEffect(() => {
    if (!books) return
    const pending = books.filter(
      (b) => !b.coverUrl && canGenerateCover(b.format) && markCoverAttempted(b.id),
    )
    if (pending.length === 0) return
    void (async () => {
      for (const book of pending) {
        // Spec 016 (FR-006): a saved cover patches that one book in libraryBooksStore; the list is not reloaded.
        await generateBookCover(book.id, book.format)
      }
    })()
  }, [books])

  function openReader(bookId: string) {
    const title = books?.find((b) => b.id === bookId)?.title
    openBook(bookId, title)
  }

  function handleOpenNotes(bookId: string) {
    openReader(bookId)
  }

  function handleBookInfo(bookId: string) {
    setBookInfoId(bookId)
  }

  function handleOpenBookMenu(bookId: string, point: BookMenuPoint) {
    setBookMenu({ bookId, point })
  }

  const bookInfoBook =
    bookInfoId != null
      ? (books?.find((b) => b.id === bookInfoId) ?? null)
      : null

  const {
    toast,
    clearToast,
    showToast,
    progress,
    canCancel,
    conflict,
    showConflict,
    urlDialog,
    closeUrlDialog,
    handleFromDevice,
    handleFromUrl,
    handleUrlSubmit,
    handleCancelImport,
    handleConflictDiscard,
    handleConflictOpenExisting,
  } = useLibraryImport({
    client: importApi,
    onImported: refreshLibrary,
    onOpenBook: openReader,
  })

  const {
    view,
    sidebarActive,
    handleStubNav,
    goHub,
    goCollections,
    openCollection,
  } = useLibraryView({
    onComingSoon: () => showToast({ key: 'library.toast.comingSoon' }, 'info'),
    onFilterNav: (filter) =>
      useLibraryBrowseStore.getState().setFilter(filter === 'to-read' ? 'not-started' : filter),
  })

  const cloudSources = useCloudSources({
    showToast,
    onDownloaded: refreshLibrary,
    onDuplicate: showConflict,
    onOpenBook: openReader,
  })

  // An audiobook ZIP import finished (its dialog lives outside this hook): reload the list once per success.
  const zipImportedNonce = useZipImportStore((s) => s.importedNonce)
  useEffect(() => {
    if (zipImportedNonce > 0) void refreshLibrary()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh only when the counter changes
  }, [zipImportedNonce])

  const libraryNavRef = useRef({
    activeId: sidebarActive,
    onStubNav: handleStubNav,
    onLibraryNav: goHub,
  })
  libraryNavRef.current = {
    activeId: sidebarActive,
    onStubNav: handleStubNav,
    onLibraryNav: goHub,
  }

  useEffect(() => {
    registerLibraryNav({
      activeId: sidebarActive,
      onStubNav: (id) => libraryNavRef.current.onStubNav(id),
      onLibraryNav: () => libraryNavRef.current.onLibraryNav(),
    })
    return () => registerLibraryNav(null)
  }, [sidebarActive, registerLibraryNav])

  useEffect(() => {
    const openNav = locState?.openNav
    if (!openNav) return
    libraryNavRef.current.onStubNav(openNav)
    navigate('/library', {
      replace: true,
      state: bootError ? { bootError } : null,
    })
  }, [locState?.openNav, navigate, bootError])

  const {
    collections,
    newCollectionOpen,
    setNewCollectionOpen,
    handleCreateCollection,
    updateCollection,
    deleteCollection,
    addBookToCollection,
    addBooksToCollection,
    removeBookFromCollection,
    refreshCollections,
  } = useCollections({
    client: libraryApi,
    onCreated: (created) =>
      showToast({ key: 'library.toast.collectionCreated', params: { name: created.name } }, 'success'),
  })

  const bookList = books ?? []
  const menuBook = bookMenu
    ? (bookList.find((book) => book.id === bookMenu.bookId) ?? null)
    : null
  const editMetadataBook = editMetadataId
    ? (bookList.find((book) => book.id === editMetadataId) ?? null)
    : null
  const pendingRemovalBook = pendingRemoval
    ? (bookList.find((book) => book.id === pendingRemoval.bookId) ?? null)
    : null

  async function runBookMutation(
    action: () => Promise<{ ok: boolean }>,
    successMessage: MessageRef,
  ) {
    try {
      const result = await action()
      if (!result.ok) {
        showToast({ key: 'library.toast.actionFailed' }, 'error')
        return false
      }
      await refreshLibrary()
      showToast(successMessage, 'success')
      return true
    } catch {
      showToast({ key: 'library.toast.actionFailed' }, 'error')
      return false
    }
  }

  async function handleToggleFavorite(book: LibraryBook) {
    await runBookMutation(
      () => libraryApi.setFavorite(book.id, !book.isFavorite),
      { key: book.isFavorite ? 'library.toast.favoriteRemoved' : 'library.toast.favoriteAdded' },
    )
  }

  /**
   * "Read again" (spec 013 US1): close the book's Reading tab if one is open (the Reader re-reads the restarted
   * state instead of an old position), restart it (status reading, no position, 0 %), then open it at the
   * beginning. On failure the Reader is not opened.
   */
  async function handleReadAgain(bookId: string) {
    closeBook(bookId)
    try {
      const result = await libraryApi.restartBook(bookId)
      if (!result.ok) {
        showToast({ key: 'library.toast.actionFailed' }, 'error')
        return
      }
    } catch {
      showToast({ key: 'library.toast.actionFailed' }, 'error')
      return
    }
    await refreshLibrary()
    openReader(bookId)
  }

  async function handleMarkCompleted(bookId: string) {
    await runBookMutation(
      () => libraryApi.markAsCompleted(bookId),
      { key: 'library.toast.markedCompleted' },
    )
  }

  /** Phone sheet (spec 013 R9): a completed book back to `reading`; its last position is kept. */
  async function handleMarkReading(bookId: string) {
    await runBookMutation(
      () => libraryApi.markAsReading(bookId),
      { key: 'library.toast.markedReading' },
    )
  }

  async function handleSaveMetadata(values: BookMetadataValues) {
    await runBookMutation(
      () => libraryApi.updateMetadata(values),
      { key: 'library.toast.metadataUpdated' },
    )
  }

  async function handleOpenFileLocation(bookId: string) {
    await runBookMutation(
      () => libraryApi.showInFolder(bookId),
      { key: 'library.toast.fileLocationOpened' },
    )
  }

  async function handleCopyFilePath(bookId: string) {
    try {
      const result = await libraryApi.copyFilePath(bookId)
      showToast(
        { key: result.ok ? 'library.toast.pathCopied' : 'library.toast.pathCopyFailed' },
        result.ok ? 'success' : 'error',
      )
    } catch {
      showToast({ key: 'library.toast.pathCopyFailed' }, 'error')
    }
  }

  async function handleAddToCollection(collectionId: string, bookId: string) {
    try {
      const added = await addBookToCollection(collectionId, bookId)
      const collection = collections.find((item) => item.id === collectionId)
      showToast(
        added
          ? collection
            ? { key: 'library.toast.addedToNamed', params: { name: collection.name } }
            : { key: 'library.toast.addedToCollection' }
          : { key: 'library.toast.addToCollectionFailed' },
        added ? 'success' : 'error',
      )
    } catch {
      showToast({ key: 'library.toast.addToCollectionFailed' }, 'error')
    }
  }

  function openNewCollection(bookId?: string) {
    setEditingCollectionId(null)
    setPendingCollectionBookId(bookId ?? null)
    setNewCollectionOpen(true)
  }

  function openEditCollection(collectionId: string) {
    setPendingCollectionBookId(null)
    setEditingCollectionId(collectionId)
    setNewCollectionOpen(true)
  }

  function closeCollectionDialog() {
    setNewCollectionOpen(false)
    setEditingCollectionId(null)
    setPendingCollectionBookId(null)
  }

  async function submitCollection(input: {
    name: string
    description?: string
  }) {
    try {
      if (editingCollectionId) {
        const updated = await updateCollection(editingCollectionId, input)
        showToast(
          { key: updated ? 'library.toast.collectionUpdated' : 'library.toast.collectionUpdateFailed' },
          updated ? 'success' : 'error',
        )
        return updated
      }
      const created = await handleCreateCollection(input)
      if (pendingCollectionBookId) {
        const added = await addBookToCollection(
          created.id,
          pendingCollectionBookId,
        )
        if (!added) {
          showToast(
            { key: 'library.toast.createdButNotAdded', params: { name: created.name } },
            'error',
          )
        }
      }
      return true
    } catch {
      showToast({ key: 'library.toast.collectionSaveFailed' }, 'error')
      return false
    }
  }

  async function confirmCollectionDelete() {
    if (!pendingCollectionDeleteId) return
    try {
      const deleted = await deleteCollection(pendingCollectionDeleteId)
      showToast(
        { key: deleted ? 'library.toast.collectionDeleted' : 'library.toast.collectionDeleteFailed' },
        deleted ? 'success' : 'error',
      )
      if (deleted) {
        if (
          view.kind === 'collection' &&
          view.collectionId === pendingCollectionDeleteId
        ) {
          goCollections()
        }
        setPendingCollectionDeleteId(null)
      }
    } catch {
      showToast({ key: 'library.toast.collectionDeleteFailed' }, 'error')
    }
  }

  /**
   * Remove a book from a collection — from the collection page or the book menu's toggle (spec 015 FR-015): at once,
   * no confirmation, with "Undo" in the toast that puts the book back at the same place.
   */
  async function handleRemoveFromCollection(
    collectionId: string,
    bookId: string,
  ) {
    const name = collections.find((item) => item.id === collectionId)?.name
    try {
      const removed = await removeBookFromCollection(collectionId, bookId)
      if (!removed.ok) {
        showToast({ key: 'library.toast.removeFromCollectionFailed' }, 'error')
        return
      }
      showToast(
        name ? { key: 'library.toast.removedFromNamed', params: { name } } : { key: 'library.toast.removedFromCollection' },
        'success',
        {
          label: { key: 'library.toast.undo' },
          run: () => void undoRemoveFromCollection(collectionId, bookId, removed.sortOrder),
        },
      )
    } catch {
      showToast({ key: 'library.toast.removeFromCollectionFailed' }, 'error')
    }
  }

  /** Undo: harmless after the collection or the book is gone — it then says it can no longer be undone. */
  async function undoRemoveFromCollection(collectionId: string, bookId: string, sortOrder: number | undefined) {
    let restored = false
    try {
      restored = await addBookToCollection(collectionId, bookId, sortOrder)
    } catch {
      restored = false
    }
    const name = collectionsRef.current.find((item) => item.id === collectionId)?.name
    if (restored && name) showToast({ key: 'library.toast.restored', params: { name } }, 'success')
    else showToast({ key: 'library.toast.undoUnavailable' }, 'info')
  }

  /**
   * "Add (n)" of the picker (spec 015 FR-010): one call, one transaction. Resolves false when nothing was added — the
   * picker then stays open with its selection; otherwise it closes and the toast says how many were added / skipped.
   */
  async function handleAddBooksToCollection(collectionId: string, bookIds: string[]): Promise<boolean> {
    const name = collections.find((item) => item.id === collectionId)?.name ?? ''
    let summary: ReturnType<typeof bulkAddSummary>
    try {
      summary = bulkAddSummary(await addBooksToCollection(collectionId, bookIds))
    } catch {
      summary = bulkAddSummary({ ok: false, added: [], skipped: [] })
    }
    if (summary.kind === 'failed' || summary.added === 0) {
      if (summary.kind !== 'failed') showToast({ key: 'library.toast.addManyFailed' }, 'error')
      return false
    }
    useAddBooksPickerStore.getState().close()
    showToast(
      summary.kind === 'partial'
        ? { key: 'library.toast.addedSomeSkipped', params: { added: summary.added, skipped: summary.skipped, name } }
        : { key: 'library.toast.addedMany', params: { count: summary.added, name } },
      'success',
    )
    return true
  }

  function openCollectionMenu(collectionId: string, point: CollectionMenuPoint | null) {
    setCollectionMenu({ collectionId, point })
  }

  function closeCollectionMenu() {
    setCollectionMenu(null)
  }

  /** "Add books" in the picker's empty state: close it and start the ordinary import. */
  function importBooksFromPicker() {
    useAddBooksPickerStore.getState().close()
    void handleFromDevice()
  }

  /** The toast after a bulk action (phone select mode). */
  function showBulkToast(
    done: number,
    failed: number,
    doneKey: 'library.selection.favoriteAdded' | 'library.selection.favoriteRemoved' | 'library.selection.removed',
  ) {
    const result = bulkResult(done, failed)
    if (result.kind === 'failed') showToast({ key: 'library.toast.actionFailed' }, 'error')
    else if (result.kind === 'partial')
      showToast({ key: 'library.selection.partial', params: { done: result.done, failed: result.failed } }, 'info')
    else showToast({ key: doneKey, params: { count: result.count } }, 'success')
  }

  /** Favourite for the selection: all become favourites unless every one already is (then all are removed). */
  async function handleBulkFavorite(ids: string[]) {
    const target = bulkFavoriteTarget(bookList, ids)
    const changes = favoriteChanges(bookList, ids, target)
    let done = 0
    for (const id of changes) {
      try {
        if ((await libraryApi.setFavorite(id, target)).ok) done += 1
      } catch {
        // counted as failed
      }
    }
    await refreshLibrary().catch(() => {})
    showBulkToast(done, changes.length - done, target ? 'library.selection.favoriteAdded' : 'library.selection.favoriteRemoved')
    if (done > 0) useLibrarySelectionStore.getState().clear()
  }

  /** "Add to collection" for the selection: one call, one transaction (same rules and toast as the picker). */
  async function handleBulkAddToCollection(collectionId: string, ids: string[]): Promise<boolean> {
    const added = await handleAddBooksToCollection(collectionId, ids)
    if (added) useLibrarySelectionStore.getState().clear()
    return added
  }

  /** "Remove" for the selection, after its confirmation: one book at a time, the list reloaded once at the end. */
  async function confirmBulkRemoval() {
    const ids = pendingBulkRemoval
    if (!ids) return
    let done = 0
    for (const id of ids) {
      const book = bookList.find((b) => b.id === id)
      if (!book) continue
      try {
        // Spec 018 (edge case): the playing audiobook's session ends (progress saved) before the book goes.
        if (audioSessionBookId() === id) await endAudioSession()
        const result =
          removalKindOf(book) === 'remove-audiobook' ? await libraryApi.removeAudiobook(id) : await libraryApi.removeBook(id)
        if (result.ok) done += 1
      } catch {
        // counted as failed
      }
    }
    await refreshLibrary().catch(() => {})
    await refreshCollections().catch(() => {})
    setPendingBulkRemoval(null)
    showBulkToast(done, ids.length - done, 'library.selection.removed')
    useLibrarySelectionStore.getState().clear()
  }

  async function confirmPendingRemoval() {
    if (!pendingRemoval) return
    const action = pendingRemoval
    // Spec 018 (edge case): end the listening session of the book first, so nothing keeps playing a removed file.
    if (audioSessionBookId() === action.bookId) await endAudioSession()
    const removed = await runBookMutation(
      () =>
        action.kind === 'remove'
          ? libraryApi.removeBook(action.bookId)
          : action.kind === 'remove-audiobook'
            ? libraryApi.removeAudiobook(action.bookId)
            : libraryApi.deleteBookFile(action.bookId),
      {
        key:
          action.kind === 'remove'
            ? 'library.toast.removedFromLibrary'
            : action.kind === 'remove-audiobook'
              ? 'library.toast.audiobookRemoved'
              : 'library.toast.fileDeleted',
      },
    )
    if (removed) {
      await refreshCollections()
      setPendingRemoval(null)
    }
  }
  const isEmpty = books !== null && books.length === 0

  const activeCollection =
    view.kind === 'collection'
      ? collections.find((c) => c.id === view.collectionId)
      : undefined
  const editingCollection = editingCollectionId
    ? collections.find((collection) => collection.id === editingCollectionId)
    : undefined
  const pendingCollectionDelete = pendingCollectionDeleteId
    ? collections.find(
      (collection) => collection.id === pendingCollectionDeleteId,
    )
    : undefined
  const collectionsRef = useRef(collections)
  collectionsRef.current = collections
  const menuCollection = collectionMenu
    ? collections.find((collection) => collection.id === collectionMenu.collectionId)
    : undefined
  /** Library books in the Library's current sort order (the picker lists them like the Library, T027). */
  const pickerBooks = sortLibraryBooks(bookList, librarySort)

  // R13: the collection open on its page was deleted elsewhere (or from its own page) → back to the list.
  const seenActiveCollection = useRef<string | null>(null)
  useEffect(() => {
    if (view.kind !== 'collection') {
      seenActiveCollection.current = null
      return
    }
    if (activeCollection) seenActiveCollection.current = activeCollection.id
    else if (seenActiveCollection.current === view.collectionId) {
      seenActiveCollection.current = null
      goCollections()
    }
  })

  // The picker belongs to one collection page: leaving it (or the collection vanishing) closes the picker.
  const pickerCollectionId = useAddBooksPickerStore((s) => (s.open ? s.collectionId : null))
  useEffect(() => {
    if (pickerCollectionId && pickerCollectionId !== activeCollection?.id) useAddBooksPickerStore.getState().close()
  }, [pickerCollectionId, activeCollection?.id])

  // A menu whose collection no longer exists closes.
  useEffect(() => {
    if (collectionMenu && !menuCollection) setCollectionMenu(null)
  }, [collectionMenu, menuCollection])

  const collectionItems: ShelfDetailItemData[] = activeCollection
    ? activeCollection.bookIds
      .map((id) => bookList.find((b) => b.id === id))
      .filter((b): b is LibraryBook => Boolean(b))
      .map((b) => toShelfDetailItem(b))
    : []

  return {
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
    editMetadataId,
    setEditMetadataId,
    editMetadataBook,
    bookMenu,
    menuBook,
    setBookMenu,
    handleOpenBookMenu,
    pendingRemoval,
    pendingRemovalBook,
    setPendingRemoval,
    confirmPendingRemoval,
    pendingBulkRemoval,
    setPendingBulkRemoval,
    confirmBulkRemoval,
    handleBulkFavorite,
    handleBulkAddToCollection,
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
    isEmpty,
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
  }
}
