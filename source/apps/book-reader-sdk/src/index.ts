/**
 * @reading-book/book-reader-sdk — public API.
 *
 * Everything here is platform-agnostic: no `fs`, no SQLite driver, no DOM, no React, no
 * Electron. The host injects I/O through `createBookReaderSdk({ adapters })`.
 */

// Composition root
export {
  createBookReaderSdk,
  type BookReaderSdk,
  type BookReaderSdkConfig,
  type BookReaderSdkOptions,
} from './core/create-sdk.js'
export { SDK_VERSION } from './core/version.js'
export { SdkError, isSdkError, type SdkErrorCode } from './core/errors.js'
export type { SdkEventMap, SdkScope } from './core/events.js'
export type { EventListener, EventSource, Unsubscribe } from './core/event-bus.js'
export {
  bytesToHex,
  createConsoleLogger,
  detectHashAdapter,
  detectIdGenerator,
  detectScheduler,
  silentLogger,
  systemClock,
  uuidV4FromBytes,
} from './core/defaults.js'

// Ports (interfaces the host implements)
export type * from './ports/index.js'

// Domain — models + value objects (packages/domain)
export * from './domain/index.js'
export type * from './domain-ports/index.js'
export { NoOpAiProvider, NoOpExternalLibraryConnector } from './domain-ports/index.js'

// Pure logic
export * from './cfi/index.js'
export * from './annotations/colors.js'
export * from './annotations/history.js'
export * from './annotations/citation.js'
export {
  compareAnchors,
  sortByDocumentOrder,
  groupByChapter,
  filterMarkups,
  collectTags,
  findMarkupsOverlapping,
  findBookmarksAt,
  type MarkupFilter,
} from './annotations/query.js'
export {
  hydrateLocator,
  toNoteLocator,
  packLocator,
  chapterIndexOf,
  anchorFromLocator,
  unpackLocator,
  chapterAnchorLocation,
} from './annotations/locator.js'
export * from './epub/index.js'
export * from './persistence/index.js'

// Use cases
export type {
  AnnotationService,
  BookmarkService,
  CreateBookmarkInput,
  CreateMarkupInput,
  MarkupPatch,
} from './services/annotation-service.js'
export type { BookUpdate, ImportFileInput, ImportOutcome, LibraryService } from './services/library-service.js'
export type { SessionService } from './services/session-service.js'

// State
export { createStoreHook, type LoadStatus, type ReadonlyStore, type UseSyncExternalStore } from './stores/store-types.js'
export type { AnnotationsState } from './stores/annotations-store.js'
export { selectBookmarksAt, type BookmarksState, type ToggleBookmarkResult } from './stores/bookmarks-store.js'
export type { SessionState, SessionPrefs } from './stores/session-store.js'
export type { LibraryImportResult, LibraryState } from './stores/library-store.js'

// App-level (packages/shared) — models, utils, use cases with no host-specific globals.
// Cloud-sync (Dropbox/Google Drive/OneDrive) lives in `host-adapters/` instead: it uses
// `fetch`/`window`/`Buffer` directly, which the SDK core's `types: []` tsconfig forbids.
export * from './app-models/index.js'
export * from './services/index.js'
export * from './app-utils/index.js'
export * from './constants/index.js'
export * from './readers/index.js'

// Reference adapters
export {
  createInMemoryFileSystem,
  createInMemoryStorage,
  type InMemoryFileSystem,
  type InMemoryStorage,
} from './testing/in-memory.js'
