/** What every bridge group is built from (spec 008, M4). One instance per page load. */
import type { BootValues } from '../host/protocol'
import type { SqlDriver } from '../db/sql-driver'
import type { MobileLibraryStore } from '../stores/library-store'
import type { MobileOverlayStore } from '../stores/overlay-store'
import type { BookContentSource } from './book-content'
import type { HostClient, WriteQueue } from './host-client'

export interface BridgeContext {
  client: HostClient
  boot: BootValues
  db: SqlDriver
  library: MobileLibraryStore
  overlay: MobileOverlayStore
  content: BookContentSource
  /** Every write goes through it (`contracts/mobile-bridge.md`, Rules). */
  writes: WriteQueue
  newId: () => string
}

/** A non-blank trimmed string, or undefined. The renderer is not trusted with types, as on Desktop's Main. */
export function idOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
