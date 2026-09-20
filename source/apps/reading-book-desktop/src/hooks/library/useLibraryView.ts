import { useEffect, useState } from 'react'
import type { ShelfId } from '@reading-book/book-reader-sdk'
import {
  CLOUD_STUB_NAV_PROVIDER,
  navIdForView,
  type LibraryCloudStubNavId,
  type LibraryStubNavId,
  type LibraryView,
} from './libraryView.js'

function isCloudStubNavId(id: LibraryStubNavId): id is LibraryCloudStubNavId {
  return id === 'cloud-google-drive' || id === 'cloud-dropbox' || id === 'cloud-onedrive'
}

export type UseLibraryViewOptions = {
  /** Called for sidebar stubs not yet wired (e.g. tags). */
  onComingSoon?: () => void
}

/** SCR-01 / SCR-01a view machine: hub ↔ shelf ↔ filter ↔ collections. */
export function useLibraryView(options: UseLibraryViewOptions = {}) {
  const { onComingSoon } = options
  const [view, setView] = useState<LibraryView>({ kind: 'hub' })

  function handleOpenShelf(id: ShelfId) {
    setView({ kind: 'shelf', shelfId: id })
  }

  function handleCloseShelf() {
    setView({ kind: 'hub' })
  }

  function goHub() {
    setView({ kind: 'hub' })
  }

  function goCollections() {
    setView({ kind: 'collections' })
  }

  function openCollection(collectionId: string) {
    setView({ kind: 'collection', collectionId })
  }

  function handleStubNav(id: LibraryStubNavId) {
    if (id === 'favorites' || id === 'completed' || id === 'to-read' || id === 'reading') {
      setView({ kind: 'filter', filterId: id })
      return
    }
    if (id === 'collections') {
      setView({ kind: 'collections' })
      return
    }
    if (isCloudStubNavId(id)) {
      setView({ kind: 'cloud-sources', provider: CLOUD_STUB_NAV_PROVIDER[id] })
      return
    }
    onComingSoon?.()
  }

  // SDS SCR-01a: Esc → Library hub (also closes collection detail).
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (view.kind !== 'shelf' && view.kind !== 'collection' && view.kind !== 'cloud-sources') return
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

  return {
    view,
    sidebarActive: navIdForView(view),
    handleOpenShelf,
    handleCloseShelf,
    handleStubNav,
    goHub,
    goCollections,
    openCollection,
  }
}
