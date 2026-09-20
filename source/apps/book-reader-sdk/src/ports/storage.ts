import type { LibraryStore } from '../domain-ports/library-store.js'
import type { OverlayStore } from '../domain-ports/overlay-store.js'

export type { LibraryStore } from '../domain-ports/library-store.js'
export type { OverlayStore, SaveBookmarkInput, SaveHighlightInput } from '../domain-ports/overlay-store.js'

/**
 * The storage bundle a host injects — the same `LibraryStore` / `OverlayStore` contracts the
 * real desktop SQLite store implements (see `packages/domain` §2.6 class diagram), so one
 * adapter can serve both the app and the SDK.
 */
export interface StorageAdapter {
  library: LibraryStore
  overlays: OverlayStore
}
