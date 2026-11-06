import type { ExternalLibraryProvider } from '@reading-book/book-reader-sdk'
import type { NavFilterId } from '@reading-book/book-reader-sdk'

/** Sidebar ids that Library view can highlight / navigate. */
export type LibraryNavId =
  | 'library'
  | 'favorites'
  | 'completed'
  | 'to-read'
  | 'reading'
  | 'collections'
  | 'cloud-sources'

/** One dropdown destination per supported cloud provider (SDS Cloud Sources nav). */
export type LibraryCloudStubNavId =
  | 'cloud-google-drive'
  | 'cloud-dropbox'
  | 'cloud-onedrive'

/** Stub destinations from sidebar (filters + placeholders). */
export type LibraryStubNavId =
  | NavFilterId
  | 'collections'
  | LibraryCloudStubNavId
  /** Parent "Cloud Sources" tab click only toggles its dropdown — never dispatched itself. */
  | 'cloud-sources'
  | 'faq'
  | 'support'
  | 'about'
  | 'privacy'

export const CLOUD_STUB_NAV_PROVIDER: Record<LibraryCloudStubNavId, ExternalLibraryProvider> = {
  'cloud-google-drive': 'google_drive',
  'cloud-dropbox': 'dropbox',
  'cloud-onedrive': 'onedrive',
}

/**
 * Top-level Library destinations. Status filters (Reading, Favorites…) are not views: they are the
 * sidebar filter of the `hub` browse area (`libraryBrowseStore`).
 */
export type LibraryView =
  | { kind: 'hub' }
  | { kind: 'collections' }
  | { kind: 'collection'; collectionId: string }
  | { kind: 'cloud-sources'; provider: ExternalLibraryProvider }

export function navIdForView(view: LibraryView): LibraryNavId {
  switch (view.kind) {
    case 'hub':
      return 'library'
    case 'collections':
    case 'collection':
      return 'collections'
    case 'cloud-sources':
      return 'cloud-sources'
  }
}
