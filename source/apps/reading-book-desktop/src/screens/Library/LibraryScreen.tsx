import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { libraryApi } from '../../bridge'
import { AppSidebar } from '../../utils'
import type { BootLocationState } from '../boot'
import {
  BootErrorBanner,
  LibraryEmptyState,
  LibraryHint,
  LibraryShelves,
  LibraryTopBar,
} from './components'
import type { ShelfId } from './components'

/** SCR-01 — Library hub shell (sidebar + top bar + format hint). */
export function LibraryScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const bootError = (location.state as BootLocationState | null)?.bootError
  const [searchQuery, setSearchQuery] = useState('')
  const [bookCount, setBookCount] = useState<number | null>(null)
  const [stubNotice, setStubNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    libraryApi
      .listBooks()
      .then((books) => {
        if (!cancelled) setBookCount(books.length)
      })
      .catch(() => {
        if (!cancelled) setBookCount(0)
      })
    return () => {
      cancelled = true
    }
  }, [])

  /** G1 stub — UX-IMP (picker / URL overlay) lands in G2. */
  function handleAddFile() {
    setStubNotice('Import opens here in the next phase.')
  }

  /** G1 stub — SCR-01a shelf detail lands in T1.6. */
  function handleOpenShelf(id: ShelfId) {
    setStubNotice(`Shelf detail for “${id}” opens here next.`)
  }

  useEffect(() => {
    if (!stubNotice) return
    const id = window.setTimeout(() => setStubNotice(null), 2800)
    return () => window.clearTimeout(id)
  }, [stubNotice])

  const isEmpty = bookCount === 0
  const showShelves = bookCount !== null && bookCount > 0

  return (
    <div
      className="lib-chrome flex h-screen w-full select-none overflow-hidden bg-[radial-gradient(ellipse_80%_50%_at_20%_-10%,rgba(245,158,11,0.08),transparent_55%),radial-gradient(circle_at_80%_100%,rgba(30,58,138,0.18),transparent_45%),radial-gradient(circle,#1e293b_0%,#0f172a_100%)] font-[system-ui,'Segoe_UI',sans-serif] text-lib-text antialiased"
    >
      <AppSidebar activeId="library" />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <LibraryTopBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onAddFile={handleAddFile}
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

            {isEmpty ? <LibraryEmptyState onAddFile={handleAddFile} /> : null}

            {showShelves ? <LibraryShelves onOpenShelf={handleOpenShelf} /> : null}

            {stubNotice ? (
              <p
                className="mt-4 text-center text-sm text-lib-muted"
                role="status"
                aria-live="polite"
              >
                {stubNotice}
              </p>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  )
}
