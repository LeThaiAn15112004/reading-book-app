import type { LibraryStore } from '../domain-ports/library-store.js'
import type { OverlayStore } from '../domain-ports/overlay-store.js'

export type { LibraryStore } from '../domain-ports/library-store.js'
export type { OverlayStore, SaveBookmarkInput, SaveHighlightInput } from '../domain-ports/overlay-store.js'

/**
 * The storage bundle a host injects — the `LibraryStore` / `OverlayStore` domain ports (SDS §2.6 class diagram).
 * Desktop's `sqlite-library-store.ts` / `sqlite-overlay-store.ts` implement only a narrow subset of what the SDK's
 * services call, so one adapter does NOT serve both today (spec 008 audit §5); a host that wants the SDK services
 * needs an adapter checked against the contract fixtures (`tests/contracts/`).
 */
export interface StorageAdapter {
  library: LibraryStore
  overlays: OverlayStore
}
