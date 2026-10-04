// @refresh reset
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  useCollections,
  useLibraryBooks,
  useLibraryImport,
  useLibraryView,
} from '../../../hooks/library/index.js'
import {
  NAV_FILTERS,
  filterByNav,
  filterByShelf,
  matchesSearch,
  pickContinueReading,
  type LibraryBook,
  type NavFilterId,
} from '@reading-book/book-reader-sdk'
import { importApi, libraryApi } from '../../../bridge'
import { useAppNav, useOpenReading, type AppStubNavId } from '../../../chrome'
import type { BootLocationState } from '../../boot'
import { LIBRARY_SHELVES } from '../components'
import type {
  BookMenuPoint,
  BookMetadataValues,
  ShelfDetailItemData,
} from '../components'
import { toShelfDetailItem } from './toShelfDetailItem'
import { useCloudSources } from './useCloudSources'
import { useSectionOrder } from './useSectionOrder'
import { useShelfOrder } from './useShelfOrder'

type LibraryLocationState = BootLocationState & {
  openNav?: AppStubNavId
}

export type PendingBookRemoval = {
  bookId: string
  kind: 'remove' | 'delete-file'
}

type LibraryFilterId = 'all' | NavFilterId

/** Desktop Library screen controller — shared hooks + IPC clients + derived lists. */
export function useLibraryScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const { registerLibraryNav } = useAppNav()
  const { openBook } = useOpenReading()
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
  const [activeFilter, setActiveFilter] = useState<LibraryFilterId>('all')

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  const { books, refreshLibrary } = useLibraryBooks({
    client: libraryApi,
  })

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
    handleOpenShelf: openShelfDetail,
    handleCloseShelf,
    handleStubNav,
    goHub,
    goCollections,
    openCollection,
  } = useLibraryView({
    onComingSoon: () => showToast('Coming soon.', 'info'),
  })

  const cloudSources = useCloudSources({
    showToast,
    onDownloaded: refreshLibrary,
    onDuplicate: showConflict,
    onOpenBook: openReader,
  })

  function handleFilterChange(filter: LibraryFilterId) {
    setActiveFilter(filter)
  }

  /** Section arrow/header click → dedicated full-page view for that section. */
  function handleOpenShelf(shelfId: string) {
    if (shelfId === 'favorites') {
      handleStubNav('favorites')
    } else if (
      shelfId === 'reading' ||
      shelfId === 'completed' ||
      shelfId === 'not-started'
    ) {
      openShelfDetail(shelfId)
    }
  }

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
      showToast(`Created “${created.name}”.`, 'success'),
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
    successMessage: string,
  ) {
    try {
      const result = await action()
      if (!result.ok) {
        showToast('The book action could not be completed.', 'error')
        return false
      }
      await refreshLibrary()
      showToast(successMessage, 'success')
      return true
    } catch {
      showToast('The book action could not be completed.', 'error')
      return false
    }
  }

  async function handleToggleFavorite(book: LibraryBook) {
    await runBookMutation(
      () => libraryApi.setFavorite(book.id, !book.isFavorite),
      book.isFavorite ? 'Removed from favorites.' : 'Added to favorites.',
    )
  }

  async function handleMarkCompleted(bookId: string) {
    await runBookMutation(
      () => libraryApi.markAsCompleted(bookId),
      'Marked as completed.',
    )
  }

  async function handleSaveMetadata(values: BookMetadataValues) {
    await runBookMutation(
      () => libraryApi.updateMetadata(values),
      'Book metadata updated.',
    )
  }

  async function handleOpenFileLocation(bookId: string) {
    await runBookMutation(
      () => libraryApi.showInFolder(bookId),
      'Opened file location.',
    )
  }

  async function handleCopyFilePath(bookId: string) {
    try {
      const result = await libraryApi.copyFilePath(bookId)
      showToast(
        result.ok ? 'File path copied.' : 'Could not copy the file path.',
        result.ok ? 'success' : 'error',
      )
    } catch {
      showToast('Could not copy the file path.', 'error')
    }
  }

  async function handleAddToCollection(collectionId: string, bookId: string) {
    try {
      const added = await addBookToCollection(collectionId, bookId)
      const collection = collections.find((item) => item.id === collectionId)
      showToast(
        added
          ? collection
            ? `Added to “${collection.name}”.`
            : 'Added to collection.'
          : 'Could not add the book to that collection.',
        added ? 'success' : 'error',
      )
    } catch {
      showToast('Could not add the book to that collection.', 'error')
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
          updated ? 'Collection updated.' : 'Could not update the collection.',
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
            `Created “${created.name}”, but the book could not be added.`,
            'error',
          )
        }
      }
      return true
    } catch {
      showToast('Could not save the collection.', 'error')
      return false
    }
  }

  async function confirmCollectionDelete() {
    if (!pendingCollectionDeleteId) return
    try {
      const deleted = await deleteCollection(pendingCollectionDeleteId)
      showToast(
        deleted ? 'Collection deleted.' : 'Could not delete the collection.',
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
      showToast('Could not delete the collection.', 'error')
    }
  }

  async function handleRemoveFromCollection(
    collectionId: string,
    bookId: string,
  ) {
    try {
      const removed = await removeBookFromCollection(collectionId, bookId)
      showToast(
        removed ? 'Removed from collection.' : 'Could not remove the book.',
        removed ? 'success' : 'error',
      )
    } catch {
      showToast('Could not remove the book.', 'error')
    }
  }

  async function confirmPendingRemoval() {
    if (!pendingRemoval) return
    const action = pendingRemoval
    const removed = await runBookMutation(
      () =>
        action.kind === 'remove'
          ? libraryApi.removeBook(action.bookId)
          : libraryApi.deleteBookFile(action.bookId),
      action.kind === 'remove'
        ? 'Removed from library.'
        : 'Book file deleted.',
    )
    if (removed) {
      await refreshCollections()
      setPendingRemoval(null)
    }
  }
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
    favorites: searchedBooks.filter((b) => b.isFavorite).length,
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

  const { orderShelf, reorderShelf } = useShelfOrder()
  const { sectionOrder, reorderSections } = useSectionOrder()

  /** Default rail order: most recently opened first (falls back below any saved drag order). */
  function sortByRecency(list: LibraryBook[]): LibraryBook[] {
    return [...list].sort((a, b) =>
      (b.lastReadAt ?? '').localeCompare(a.lastReadAt ?? ''),
    )
  }

  /** Hub rails show only the top N books; the section arrow opens the full list. */
  const SHELF_RAIL_LIMIT = 7

  const shelfRailBooks = {
    favorites: orderShelf(
      'favorites',
      sortByRecency(searchedBooks.filter((b) => b.isFavorite)),
    ).slice(0, SHELF_RAIL_LIMIT),
    reading: orderShelf(
      'reading',
      sortByRecency(filterByShelf(searchedBooks, 'reading')),
    ).slice(0, SHELF_RAIL_LIMIT),
    completed: orderShelf(
      'completed',
      sortByRecency(filterByShelf(searchedBooks, 'completed')),
    ).slice(0, SHELF_RAIL_LIMIT),
    'not-started': orderShelf(
      'not-started',
      sortByRecency(filterByShelf(searchedBooks, 'not-started')),
    ).slice(0, SHELF_RAIL_LIMIT),
  }

  const visibleShelfIds =
    activeFilter === 'all'
      ? sectionOrder
      : activeFilter === 'favorites'
        ? (['favorites'] as const)
        : activeFilter === 'to-read'
          ? (['not-started'] as const)
          : ([activeFilter] as const)
  const hideEmptyShelves = searchActive || activeFilter !== 'all'

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
    reorderShelf,
    reorderSections,
    visibleShelfIds,
    hideEmptyShelves,
    filterConfig,
    filterItems,
    activeCollection,
    collectionItems,
    viewMode,
    setViewMode,
    activeFilter,
    handleFilterChange,
    cloudSources,
    bookList,
  }
}
