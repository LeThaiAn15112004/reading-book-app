import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  useCollections,
  useLibraryBooks,
  useLibraryImport,
  useLibraryView,
} from '@reading-book/shared/hooks/library'
import {
  NAV_FILTERS,
  filterByNav,
  filterByShelf,
  matchesSearch,
  pickContinueReading,
  type LibraryBook,
} from '@reading-book/shared/models'
import { importApi, libraryApi } from '../../../bridge'
import { useAppNav, useOpenReading, type AppStubNavId } from '../../../chrome'
import type { BootLocationState } from '../../boot'
import { LIBRARY_SHELVES } from '../components'
import type { ShelfDetailItemData } from '../components'
import { toShelfDetailItem } from './toShelfDetailItem'

type LibraryLocationState = BootLocationState & {
  openNav?: AppStubNavId
}

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

  const bookInfoBook =
    bookInfoId != null
      ? (books?.find((b) => b.id === bookInfoId) ?? null)
      : null

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

  const shelfRailBooks = {
    reading: filterByShelf(searchedBooks, 'reading'),
    completed: filterByShelf(searchedBooks, 'completed'),
    'not-started': filterByShelf(searchedBooks, 'not-started'),
  } as const

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
  }
}
