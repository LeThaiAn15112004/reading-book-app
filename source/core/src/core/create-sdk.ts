import { DEFAULT_HIGHLIGHT_COLOR, isValidHexColor } from '../annotations/colors.js'
import type { BookReaderAdapters } from '../ports/index.js'
import type { ReaderSurface } from '../ports/reader-surface.js'
import type { LibraryStore, OverlayStore } from '../ports/storage.js'
import {
  createAnnotationService,
  createBookmarkService,
  type AnnotationService,
  type BookmarkService,
} from '../services/annotation-service.js'
import { createLibraryService, type LibraryService } from '../services/library-service.js'
import { createSessionService, type SessionService } from '../services/session-service.js'
import { createAnnotationsStore, type AnnotationsState } from '../stores/annotations-store.js'
import { createBookmarksStore, type BookmarksState } from '../stores/bookmarks-store.js'
import { createLibraryStore, type LibraryState } from '../stores/library-store.js'
import { createSessionStore, type SessionState } from '../stores/session-store.js'
import type { ReadonlyStore } from '../stores/store-types.js'
import { assertPort } from './adapter-guard.js'
import {
  createConsoleLogger,
  detectHashAdapter,
  detectIdGenerator,
  detectScheduler,
  systemClock,
} from './defaults.js'
import { SdkError } from './errors.js'
import { createEventBus, type EventSource } from './event-bus.js'
import type { SdkEventMap } from './events.js'
import {
  createLifecycle,
  createSurfaceSlot,
  type ResolvedSdkOptions,
  type SdkRuntime,
} from './runtime.js'
import { SDK_VERSION } from './version.js'

export interface BookReaderSdkOptions {
  /** Quiet period before a reading-position change is saved. Default 1000 ms. */
  autosaveDelayMs?: number
  /** Max undo steps per open book. Default 50. */
  undoLimit?: number
  /** Initial `lastUsedColorHex`. Default `#FFEB3B`. */
  defaultHighlightColor?: string
}

export interface BookReaderSdkConfig {
  adapters: BookReaderAdapters
  options?: BookReaderSdkOptions
}

export interface BookReaderSdk {
  readonly version: string
  readonly stores: {
    readonly library: ReadonlyStore<LibraryState>
    readonly annotations: ReadonlyStore<AnnotationsState>
    readonly bookmarks: ReadonlyStore<BookmarksState>
    readonly session: ReadonlyStore<SessionState>
  }
  /** Stateless use cases, for hosts that manage state themselves (e.g. the Electron main process). */
  readonly services: {
    readonly library: LibraryService
    readonly annotations: AnnotationService
    readonly bookmarks: BookmarkService
    readonly session: SessionService
  }
  readonly events: EventSource<SdkEventMap>
  /** Attach the rendering engine of the mounted reader. Returns a detach function. */
  attachSurface(surface: ReaderSurface): () => void
  /** Open a book in every per-book store at once (annotations, bookmarks, session). */
  openBook(bookId: string): Promise<void>
  /** Flush the session and reset every per-book store. */
  closeBook(): Promise<void>
  /** Flush pending writes, then make every further call throw `DISPOSED`. Idempotent. */
  dispose(): Promise<void>
}

function positiveInt(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < 0) {
    throw new SdkError('INVALID_CONFIG', `options.${name} must be a non-negative number`)
  }
  return Math.floor(value)
}

function resolveOptions(options: BookReaderSdkOptions = {}): ResolvedSdkOptions {
  const color = options.defaultHighlightColor ?? DEFAULT_HIGHLIGHT_COLOR
  if (!isValidHexColor(color)) {
    throw new SdkError('INVALID_CONFIG', `options.defaultHighlightColor "${color}" is not #RRGGBB(AA)`)
  }
  return {
    autosaveDelayMs: positiveInt(options.autosaveDelayMs, 1000, 'autosaveDelayMs'),
    undoLimit: Math.max(1, positiveInt(options.undoLimit, 50, 'undoLimit')),
    defaultHighlightColor: color,
  }
}

function validateAdapters(adapters: BookReaderAdapters): void {
  if (!adapters || typeof adapters !== 'object') {
    throw new SdkError('INVALID_CONFIG', 'createBookReaderSdk: `adapters` is required')
  }
  if (!adapters.storage || typeof adapters.storage !== 'object') {
    throw new SdkError('ADAPTER_MISSING', 'createBookReaderSdk: `adapters.storage` is required')
  }
  const { library, overlays } = adapters.storage
  assertPort<LibraryStore>('storage.library', library, [
    'findById',
    'findBySha256',
    'findByAuthor',
    'save',
    'linkAuthors',
    'linkGenres',
    'deleteCascade',
  ])
  assertPort<OverlayStore>('storage.overlays', overlays, [
    'getSessionState',
    'saveSessionState',
    'listBookmarks',
    'saveBookmark',
    'deleteBookmark',
    'listHighlights',
    'saveHighlight',
    'deleteHighlight',
  ])

  if (adapters.fileSystem !== undefined) {
    assertPort('fileSystem', adapters.fileSystem, ['readBytes', 'copyToSandbox', 'writeSandboxFile', 'removeSandboxFile', 'exists'])
  }
  if (adapters.archive !== undefined) assertPort('archive', adapters.archive, ['open'])
  if (adapters.hash !== undefined) assertPort('hash', adapters.hash, ['sha256Hex'])
  if (adapters.clock !== undefined) assertPort('clock', adapters.clock, ['nowIso'])
  if (adapters.ids !== undefined) assertPort('ids', adapters.ids, ['newId'])
  if (adapters.scheduler !== undefined) assertPort('scheduler', adapters.scheduler, ['setTimeout', 'clearTimeout'])
  if (adapters.logger !== undefined) assertPort('logger', adapters.logger, ['debug', 'info', 'warn', 'error'])
}

/**
 * Composition root. Validates injected adapters, fills portable defaults, and wires services
 * and stores for one isolated SDK instance (no module-level state: two instances — e.g. two
 * windows, or tests — never share stores).
 */
export function createBookReaderSdk(config: BookReaderSdkConfig): BookReaderSdk {
  if (!config || typeof config !== 'object') {
    throw new SdkError('INVALID_CONFIG', 'createBookReaderSdk: a config object is required')
  }
  validateAdapters(config.adapters)
  const { adapters } = config

  const logger = adapters.logger ?? createConsoleLogger()
  const ids = adapters.ids ?? detectIdGenerator()
  if (!ids) {
    throw new SdkError(
      'ADAPTER_MISSING',
      'No secure random source on this platform — pass `adapters.ids` (e.g. expo-crypto randomUUID)',
    )
  }

  const rt: SdkRuntime = {
    storage: adapters.storage,
    fileSystem: adapters.fileSystem,
    archive: adapters.archive,
    hash: adapters.hash ?? detectHashAdapter(),
    clock: adapters.clock ?? systemClock,
    ids,
    scheduler: adapters.scheduler ?? detectScheduler(),
    logger,
    events: createEventBus<SdkEventMap>(logger),
    surface: createSurfaceSlot(),
    lifecycle: createLifecycle(),
    options: resolveOptions(config.options),
  }

  const services = {
    library: createLibraryService(rt),
    annotations: createAnnotationService(rt),
    bookmarks: createBookmarkService(rt),
    session: createSessionService(rt),
  }

  const stores = {
    library: createLibraryStore(rt, services.library),
    annotations: createAnnotationsStore(rt, services.annotations),
    bookmarks: createBookmarksStore(rt, services.bookmarks),
    session: createSessionStore(rt, services.session),
  }

  const closeBook = async () => {
    await stores.session.getState().close()
    await Promise.all([stores.annotations.getState().whenIdle(), stores.bookmarks.getState().whenIdle()])
    stores.annotations.getState().close()
    stores.bookmarks.getState().close()
  }

  return {
    version: SDK_VERSION,
    stores,
    services,
    events: { on: rt.events.on },

    attachSurface(surface) {
      rt.lifecycle.assertAlive('attachSurface')
      const detach = rt.surface.attach(surface)
      stores.annotations.getState().repaintAll()
      return detach
    },

    async openBook(bookId) {
      rt.lifecycle.assertAlive('openBook')
      if (!bookId?.trim()) throw new SdkError('INVALID_ARGUMENT', 'openBook: bookId is required')
      await Promise.all([
        stores.session.getState().open(bookId),
        stores.annotations.getState().open(bookId),
        stores.bookmarks.getState().open(bookId),
      ])
    },

    closeBook,

    async dispose() {
      if (rt.lifecycle.disposed) return
      try {
        await closeBook()
      } finally {
        rt.lifecycle.markDisposed()
        rt.events.clear()
      }
    },
  }
}
