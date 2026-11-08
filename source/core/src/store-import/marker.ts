// Spec 010 (data-model §5) — the Store build's `store-import.json` marker and what one launch does about the import.

export type StoreImportState = 'pending' | 'declined' | 'done'

export interface StoreImportMarker {
  readonly version: 1
  readonly state: StoreImportState
  /** ISO-8601 time the state was written. */
  readonly at: string
  /** `done` only. */
  readonly source?: { readonly schemaMigrations: number; readonly lastMigration: string }
  /** `done` only. */
  readonly copied?: { readonly books: number; readonly notes: number; readonly files: number; readonly bytes: number }
}

const STATES: readonly StoreImportState[] = ['pending', 'declined', 'done']

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

/** The marker from its JSON text or parsed value; anything malformed (or another `version`) counts as absent. */
export function parseMarker(input: unknown): StoreImportMarker | null {
  let value = input
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input)
    } catch {
      return null
    }
  }
  if (typeof value !== 'object' || value === null) return null
  const m = value as Record<string, unknown>
  if (m.version !== 1 || !STATES.includes(m.state as StoreImportState) || typeof m.at !== 'string' || m.at === '') return null
  const marker: { -readonly [K in keyof StoreImportMarker]: StoreImportMarker[K] } = {
    version: 1,
    state: m.state as StoreImportState,
    at: m.at,
  }
  const s = m.source as Record<string, unknown> | undefined
  if (s && isCount(s.schemaMigrations) && typeof s.lastMigration === 'string') {
    marker.source = { schemaMigrations: s.schemaMigrations, lastMigration: s.lastMigration }
  }
  const c = m.copied as Record<string, unknown> | undefined
  if (c && isCount(c.books) && isCount(c.notes) && isCount(c.files) && isCount(c.bytes)) {
    marker.copied = { books: c.books, notes: c.notes, files: c.files, bytes: c.bytes }
  }
  return marker
}

export type LaunchDecision = 'none' | 'offer' | 'importWithoutAsking'

export interface LaunchFacts {
  /** The Store build's own `reading-book.db` exists (the commit point of an earlier import or an earlier start). */
  readonly storeDbExists: boolean
  readonly marker: StoreImportMarker | null
  /** The installer build's `reading-book.db` exists. */
  readonly sourceDbExists: boolean
  /** The Store library has no book (only meaningful when `storeDbExists`). */
  readonly storeLibraryEmpty: boolean
}

/**
 * What this launch does, before the first window (data-model §5):
 * - no source → `none`;
 * - `pending` (chosen in Settings) and the Store library is still empty → `importWithoutAsking`, whether or not the
 *   Store database exists (after "Start empty" the Store build has created an empty one);
 * - Store database exists → `none` (never asked again);
 * - `declined` / `done` → `none` (final for the automatic offer);
 * - otherwise → `offer`.
 */
export function decideOnLaunch({ storeDbExists, marker, sourceDbExists, storeLibraryEmpty }: LaunchFacts): LaunchDecision {
  if (!sourceDbExists) return 'none'
  if (marker?.state === 'pending') return !storeDbExists || storeLibraryEmpty ? 'importWithoutAsking' : 'none'
  if (storeDbExists) return 'none'
  if (marker?.state === 'declined' || marker?.state === 'done') return 'none'
  return 'offer'
}
