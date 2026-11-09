import { useEffect, useState } from 'react'
import type { NavFilterId } from '@core'
import { useCloudProviderAvailabilityStore } from '../app/cloudProviderAvailabilityStore.js'
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
  /** A status-filter stub id arrived (e.g. via `openNav`): show the hub with that filter. */
  onFilterNav?: (filter: NavFilterId) => void
}

/** SCR-01 view machine: hub (browse with sidebar filters) ↔ collections ↔ cloud sources. */
export function useLibraryView(options: UseLibraryViewOptions = {}) {
  const { onComingSoon, onFilterNav } = options
  const [view, setView] = useState<LibraryView>({ kind: 'hub' })

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
      setView({ kind: 'hub' })
      onFilterNav?.(id)
      return
    }
    if (id === 'collections') {
      setView({ kind: 'collections' })
      return
    }
    if (isCloudStubNavId(id)) {
      const provider = CLOUD_STUB_NAV_PROVIDER[id]
      // Spec 010 KL-1: never open the screen (and its Connect button) of a provider this build does not offer.
      if (!useCloudProviderAvailabilityStore.getState().availability[provider].available) return
      setView({ kind: 'cloud-sources', provider })
      return
    }
    onComingSoon?.()
  }

  // SDS SCR-01a: Esc → Library hub (also closes collection detail).
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (view.kind !== 'collection' && view.kind !== 'cloud-sources') return
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
    handleStubNav,
    goHub,
    goCollections,
    openCollection,
  }
}
