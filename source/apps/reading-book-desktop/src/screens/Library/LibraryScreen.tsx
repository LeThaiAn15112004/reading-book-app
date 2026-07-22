import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ImportConflictDialog,
  ImportProgressDialog,
  ImportToast,
  ImportUrlDialog,
  type ImportToastVariant,
} from '../../components/import'
import { importApi, libraryApi } from '../../bridge'
import { AppSidebar, type AppNavId } from '../../utils'
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
import type { ShelfDetailItemData, ShelfId, ShelfRailContent } from './components'
import {
  NAV_FILTERS,
  filterByNav,
  filterByShelf,
  mapBookSummary,
  matchesSearch,
  pickContinueReading,
  toShelfDetailItem,
  type CollectionSummary,
  type LibraryBook,
  type NavFilterId,
} from './libraryModel'

type LibraryView =
  | { kind: 'hub' }
  | { kind: 'shelf'; shelfId: ShelfId }
  | { kind: 'filter'; filterId: NavFilterId }
  | { kind: 'collections' }
  | { kind: 'collection'; collectionId: string }

type ProgressState = {
  status: string
  filename?: string
} | null

type ToastState = {
  message: string
  variant: ImportToastVariant
} | null

function navIdForView(view: LibraryView): AppNavId {
  switch (view.kind) {
    case 'hub':
    case 'shelf':
      return 'library'
    case 'filter':
      return view.filterId
    case 'collections':
    case 'collection':
      return 'collections'
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `col-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function filenameFromUrl(url: string): string | undefined {
  try {
    const base = url.split('?')[0]?.split('#')[0] ?? url
    const name = base.split('/').pop()
    return name && name.includes('.') ? decodeURIComponent(name) : undefined
  } catch {
    return undefined
  }
}

/** SCR-01 — Library hub shell (sidebar + top bar + format hint). */
export function LibraryScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const bootError = (location.state as BootLocationState | null)?.bootError
  const [searchQuery, setSearchQuery] = useState('')
  const [books, setBooks] = useState<LibraryBook[] | null>(null)
  const [toast, setToast] = useState<ToastState>(null)
  const [progress, setProgress] = useState<ProgressState>(null)
  const [view, setView] = useState<LibraryView>({ kind: 'hub' })
  const [collections, setCollections] = useState<CollectionSummary[]>([])
  const [newCollectionOpen, setNewCollectionOpen] = useState(false)
  const [urlDialogOpen, setUrlDialogOpen] = useState(false)
  const [conflict, setConflict] = useState<{
    bookId: string
    message?: string
  } | null>(null)

  const clearToast = useCallback(() => setToast(null), [])

  async function refreshLibrary() {
    try {
      const rows = await libraryApi.listBooks()
      setBooks(rows.map(mapBookSummary))
    } catch {
      setBooks([])
    }
  }

  useEffect(() => {
    let cancelled = false
    libraryApi
      .listBooks()
      .then((rows) => {
        if (!cancelled) setBooks(rows.map(mapBookSummary))
      })
      .catch(() => {
        if (!cancelled) setBooks([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleFromDevice() {
    setProgress({ status: 'Importing…' })
    try {
      const result = await importApi.fromFile()
      if (result.ok && result.bookId) {
        await refreshLibrary()
        setToast({
          message: 'Successfully imported to local library',
          variant: 'success',
        })
      } else if (result.errorCode === 'duplicate' && result.bookId) {
        setConflict({
          bookId: result.bookId,
          message: result.errorMessage,
        })
      } else if (result.errorMessage) {
        setToast({ message: result.errorMessage, variant: 'error' })
      }
      // Cancel: no errorCode / errorMessage — silent.
    } catch {
      setToast({ message: 'Could not import file.', variant: 'error' })
    } finally {
      setProgress(null)
    }
  }

  function handleFromUrl() {
    setUrlDialogOpen(true)
  }

  async function handleUrlSubmit(url: string) {
    setUrlDialogOpen(false)
    setProgress({
      status: 'Downloading…',
      filename: filenameFromUrl(url),
    })
    try {
      const result = await importApi.fromUrl(url)
      if (result.ok && result.bookId) {
        await refreshLibrary()
        setToast({
          message: 'Successfully imported to local library',
          variant: 'success',
        })
      } else if (result.errorCode === 'duplicate' && result.bookId) {
        setConflict({
          bookId: result.bookId,
          message: result.errorMessage,
        })
      } else {
        setToast({
          message: result.errorMessage ?? 'Could not download from URL.',
          variant: 'error',
        })
      }
    } catch {
      setToast({ message: 'Could not start URL import.', variant: 'error' })
    } finally {
      setProgress(null)
    }
  }

  function handleConflictDiscard() {
    setConflict(null)
  }

  function handleConflictOpenExisting() {
    const bookId = conflict?.bookId
    setConflict(null)
    if (bookId) handleOpenBook(bookId)
  }

  function handleOpenShelf(id: ShelfId) {
    setView({ kind: 'shelf', shelfId: id })
  }

  function handleCloseShelf() {
    setView({ kind: 'hub' })
  }

  function handleOpenBook(bookId: string) {
    navigate(`/reader/${bookId}`)
  }

  function handleOpenNotes(bookId: string) {
    // Notes tab wiring lands with Reader chrome (G5); open book for now.
    navigate(`/reader/${bookId}`)
  }

  function handleStubNav(id: Exclude<AppNavId, 'library' | 'settings'>) {
    if (id === 'favorites' || id === 'completed' || id === 'to-read') {
      setView({ kind: 'filter', filterId: id })
      return
    }
    if (id === 'collections') {
      setView({ kind: 'collections' })
      return
    }
    setToast({ message: 'Coming soon.', variant: 'info' })
  }

  function handleCreateCollection(input: {
    name: string
    description?: string
  }) {
    const now = new Date().toISOString()
    const created: CollectionSummary = {
      id: newId(),
      name: input.name,
      description: input.description,
      bookIds: [],
      createdAt: now,
      updatedAt: now,
    }
    setCollections((prev) => [created, ...prev])
    setToast({
      message: `Created “${created.name}” (session stub).`,
      variant: 'info',
    })
  }

  // SDS SCR-01a: Esc → Library hub (also closes collection detail).
  useEffect(() => {
    if (view.kind !== 'shelf' && view.kind !== 'collection') return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (view.kind === 'collection') setView({ kind: 'collections' })
        else setView({ kind: 'hub' })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [view])

  const bookList = books ?? []
  const isEmpty = books !== null && books.length === 0
  const showHubChrome = view.kind === 'hub'
  const continueBook = pickContinueReading(bookList)
  const searchedBooks = bookList.filter((b) => matchesSearch(b, searchQuery))
  const searchActive = searchQuery.trim().length > 0
  const noSearchMatches =
    showHubChrome && searchActive && !isEmpty && searchedBooks.length === 0
  // Shelves visible when library has books and search still has matches (or no query).
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
      <ShelfRailCard key={b.id} book={b} onOpen={handleOpenBook} />
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

  const sidebarActive = navIdForView(view)

  return (
    <div className="lib-chrome relative flex h-screen w-full select-none overflow-hidden bg-[radial-gradient(ellipse_80%_50%_at_20%_-10%,rgba(245,158,11,0.08),transparent_55%),radial-gradient(circle_at_80%_100%,rgba(30,58,138,0.18),transparent_45%),radial-gradient(circle,#1e293b_0%,#0f172a_100%)] font-[system-ui,'Segoe_UI',sans-serif] text-lib-text antialiased">
      <AppSidebar
        activeId={sidebarActive}
        onStubNav={handleStubNav}
        onLibraryNav={() => setView({ kind: 'hub' })}
      />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {activeShelf ? (
          <ShelfDetailView
            title={activeShelf.title}
            items={shelfItems}
            onBack={handleCloseShelf}
            onOpenItem={handleOpenBook}
          />
        ) : view.kind === 'filter' && filterConfig ? (
          <FilteredListView
            title={filterConfig.title}
            emptyMessage={filterConfig.empty}
            items={filterItems}
            onOpenItem={handleOpenBook}
          />
        ) : view.kind === 'collections' ? (
          <CollectionsHub
            collections={collections}
            onNewCollection={() => setNewCollectionOpen(true)}
            onOpenCollection={(id) =>
              setView({ kind: 'collection', collectionId: id })
            }
          />
        ) : activeCollection ? (
          <ShelfDetailView
            title={activeCollection.name}
            items={collectionItems}
            onBack={() => setView({ kind: 'collections' })}
            onOpenItem={handleOpenBook}
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
                    onResume={handleOpenBook}
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
