import type { NavFilterId, ShelfId } from '../../models/library-book.js'

/** Sidebar ids that Library view can highlight / navigate. */
export type LibraryNavId =
  | 'library'
  | 'favorites'
  | 'completed'
  | 'to-read'
  | 'collections'

/** Stub destinations from sidebar (filters + placeholders). */
export type LibraryStubNavId =
  | NavFilterId
  | 'collections'
  | 'cloud-sources'
  | 'faq'
  | 'support'
  | 'about'
  | 'privacy'

export type LibraryView =
  | { kind: 'hub' }
  | { kind: 'shelf'; shelfId: ShelfId }
  | { kind: 'filter'; filterId: NavFilterId }
  | { kind: 'collections' }
  | { kind: 'collection'; collectionId: string }

export function navIdForView(view: LibraryView): LibraryNavId {
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
