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
import { type LibraryBook, type MessageRef } from '@core'
import { importApi, libraryApi } from '../../../bridge'
import { useAppNav, useOpenReading, type AppStubNavId } from '../../../components/chrome'
import type { BootLocationState } from '../../boot'
import type {
  BookMenuPoint,
  BookMetadataValues,
  ShelfDetailItemData,
} from '../components'
import { toShelfDetailItem } from './toShelfDetailItem'
import { canGenerateCover, generateBookCover, markCoverAttempted } from './generateBookCover'
import { useLibraryBrowseStore } from './libraryBrowseStore'
import { useCloudSources } from './useCloudSources'

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
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(
    null,
  )
  const [pendingCollectionDeleteId, setPendingCollectionDeleteId] = useState<
    string | null
  >(null)
  const [pendingCollectionBookId, setPendingCollectionBookId] = useState<
    string | null
  >(null)
  /** Grid / list toggle of the collection detail view (top-nav Collections). */
  const [collectionViewMode, setCollectionViewMode] = useState<'grid' | 'list'>('grid')

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
        if (await generateBookCover(book.id, book.format)) await refreshLibrary()
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function handleRemoveFromCollection(
    collectionId: string,
    bookId: string,
  ) {
    try {
      const removed = await removeBookFromCollection(collectionId, bookId)
      showToast(
        { key: removed ? 'library.toast.removedFromCollection' : 'library.toast.removeFromCollectionFailed' },
        removed ? 'success' : 'error',
      )
    } catch {
      showToast({ key: 'library.toast.removeFromCollectionFailed' }, 'error')
    }
  }

  async function confirmPendingRemoval() {
    if (!pendingRemoval) return
    const action = pendingRemoval
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
    handleToggleFavorite,
    handleMarkCompleted,
    handleReadAgain,
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
    cloudSources,
    books,
    bookList,
  }
}
