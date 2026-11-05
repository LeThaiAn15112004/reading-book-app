import type { ArchiveAdapter } from '../ports/archive.js'
import type { FileSystemAdapter } from '../ports/file-system.js'
import type { Clock, HashAdapter, IdGenerator, Logger, Scheduler } from '../ports/platform.js'
import type { ReaderSurface } from '../ports/reader-surface.js'
import type { StorageAdapter } from '../ports/storage.js'
import type { EventBus } from './event-bus.js'
import { SdkError } from './errors.js'
import type { SdkEventMap } from './events.js'

export interface ResolvedSdkOptions {
  autosaveDelayMs: number
  undoLimit: number
  defaultHighlightColor: string
}

/** Holds the one surface attached right now (a reader screen mounts / unmounts it). */
export interface SurfaceSlot {
  current(): ReaderSurface | null
  attach(surface: ReaderSurface): () => void
}

export function createSurfaceSlot(): SurfaceSlot {
  let current: ReaderSurface | null = null
  return {
    current: () => current,
    attach(surface) {
      current = surface
      return () => {
        // A later attach wins; detaching a stale surface must not clear the new one.
        if (current === surface) current = null
      }
    },
  }
}

export interface Lifecycle {
  readonly disposed: boolean
  assertAlive(operation: string): void
  markDisposed(): void
}

export function createLifecycle(): Lifecycle {
  let disposed = false
  return {
    get disposed() {
      return disposed
    },
    assertAlive(operation) {
      if (disposed) throw new SdkError('DISPOSED', `${operation}: the SDK instance has been disposed`)
    },
    markDisposed() {
      disposed = true
    },
  }
}

/** Resolved dependencies shared by every service and store of one SDK instance. Internal. */
export interface SdkRuntime {
  storage: StorageAdapter
  fileSystem: FileSystemAdapter | undefined
  archive: ArchiveAdapter | undefined
  hash: HashAdapter | undefined
  clock: Clock
  ids: IdGenerator
  scheduler: Scheduler | undefined
  logger: Logger
  events: EventBus<SdkEventMap>
  surface: SurfaceSlot
  lifecycle: Lifecycle
  options: ResolvedSdkOptions
}
