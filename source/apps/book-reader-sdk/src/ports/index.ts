import type { ArchiveAdapter } from './archive.js'
import type { FileSystemAdapter } from './file-system.js'
import type { Clock, HashAdapter, IdGenerator, Logger, Scheduler } from './platform.js'
import type { StorageAdapter } from './storage.js'

export type { ArchiveAdapter, ArchiveReader } from './archive.js'
export type { FileRef, FileSystemAdapter } from './file-system.js'
export type { Clock, HashAdapter, IdGenerator, Logger, Scheduler, TimerHandle } from './platform.js'
export type { ReaderSurface, ReaderMarkup } from './reader-surface.js'
export type {
  LibraryStore,
  OverlayStore,
  SaveBookmarkInput,
  SaveHighlightInput,
  StorageAdapter,
} from './storage.js'

/**
 * Everything the host injects at `createBookReaderSdk`. Only `storage` is mandatory; the rest
 * either have portable defaults or are required lazily by the one operation that needs them
 * (e.g. `fileSystem` only when importing a file), failing with `ADAPTER_MISSING` at that point.
 */
export interface BookReaderAdapters {
  storage: StorageAdapter
  /** Needed by `library.importFile`. */
  fileSystem?: FileSystemAdapter
  /** Needed to read EPUB metadata/cover on import; otherwise file-name fallback. */
  archive?: ArchiveAdapter
  /** Default: WebCrypto `crypto.subtle` (Node ≥ 18, Electron, browsers). Required on React Native. */
  hash?: HashAdapter
  /** Default: `Date`. */
  clock?: Clock
  /** Default: `crypto.randomUUID` / `crypto.getRandomValues`. */
  ids?: IdGenerator
  /** Default: global `setTimeout`. */
  scheduler?: Scheduler
  /** Default: `console` with a `[book-reader-sdk]` prefix. */
  logger?: Logger
}
