// Spec 010 (contracts/store-import.md "Steps" 1, data-model §6) — which entries of the installer build's userData are
// copied, and whether the import must be refused before anything is copied.
import { STORE_IMPORT_ALLOWLIST, STORE_IMPORT_DB, allowEntryFor, type StoreImportEntryKind } from './allowlist.js'

export interface StoreImportSourceEntry {
  readonly name: string
  readonly kind: StoreImportEntryKind
  /** Total bytes (recursive for a folder). */
  readonly bytes: number
}

export interface StoreImportSource {
  readonly root: string
  readonly entries: readonly StoreImportSourceEntry[]
  /** `reading-book.db-wal` exists: the installer build is running (or did not close properly). */
  readonly hasWal: boolean
}

export type StoreImportRefusal = 'source_busy' | 'no_space' | 'newer_schema' | 'integrity'

export interface StoreImportPlan {
  /** Entry names to copy, in allowlist order. */
  readonly copy: readonly string[]
  /** Entry names left behind (not allowlisted, or of the wrong kind). */
  readonly skip: readonly string[]
  readonly totalBytes: number
  /** Bytes that must be free on the target volume: total + 10 %. */
  readonly neededBytes: number
  readonly refuse?: StoreImportRefusal
}

/** Free space must cover the copy plus this margin, in percent (research R8 step 3). */
export const FREE_SPACE_MARGIN_PERCENT = 10

/**
 * The copy plan, or `null` when the source has no library database (nothing to import).
 * `source_busy` wins over `no_space` (the user closes the other app first, then the space is measured again).
 */
export function planStoreImport(source: StoreImportSource, { freeBytes }: { freeBytes: number }): StoreImportPlan | null {
  const copy: string[] = []
  const skip: string[] = []
  let totalBytes = 0
  let hasDb = false
  for (const entry of source.entries) {
    const allowed = allowEntryFor(entry.name, entry.kind)
    if (!allowed) {
      skip.push(entry.name)
      continue
    }
    if (allowed.name === STORE_IMPORT_DB) hasDb = true
    copy.push(entry.name)
    totalBytes += Math.max(0, entry.bytes)
  }
  if (!hasDb) return null
  const order = (name: string) => STORE_IMPORT_ALLOWLIST.findIndex((e) => e.name.toLowerCase() === name.toLowerCase())
  copy.sort((a, b) => order(a) - order(b))
  skip.sort()
  // Integer arithmetic: 6600 * 1.1 is 7260.000000000001 in floating point.
  const neededBytes = Math.ceil((totalBytes * (100 + FREE_SPACE_MARGIN_PERCENT)) / 100)
  const refuse: StoreImportRefusal | undefined = source.hasWal ? 'source_busy' : freeBytes < neededBytes ? 'no_space' : undefined
  return refuse ? { copy, skip, totalBytes, neededBytes, refuse } : { copy, skip, totalBytes, neededBytes }
}
