import type { SdkError } from './errors.js'

export type SdkScope = 'library' | 'annotations' | 'bookmarks' | 'session'

/**
 * Events a host subscribes to with `sdk.events.on(...)`. The typical use is mapping `error` to a
 * toast and `*:changed` to cache invalidation / sync triggers. A type alias (not an interface) so
 * it satisfies `Record<string, unknown>`.
 */
export type SdkEventMap = {
  /** An operation failed after optimistic state was already rolled back. */
  error: { scope: SdkScope; operation: string; error: SdkError }
  'library:changed': { reason: 'imported' | 'updated' | 'removed'; bookId: string }
  'annotations:changed': {
    reason: 'created' | 'updated' | 'deleted' | 'restored'
    bookId: string
    annotationId: string
  }
  'bookmarks:changed': { reason: 'created' | 'updated' | 'deleted'; bookId: string; bookmarkId: string }
  'session:saved': { bookId: string; updatedAt: string }
}
