// Spec 010 (contracts/store-import.md "Allowlist") — what the one-time import copies from the installer (direct)
// build's userData into the Microsoft Store build's userData, and what it never copies.
//
// Main JSON prefs: confirmed by grep of the `json-prefs-file.ts` users on 2026-11-08 (T052):
// background-prefs.json (background/background-prefs.ts), notification-prefs.json (notifications/notification-prefs.ts),
// reading-reminder-state.json (reminders/). Table names of COUNTED_TABLES checked against
// source/core/src/db/desktop/migrations/*.sql the same day.

/** The SQLite library database; its presence in the Store userData is the import's commit point. */
export const STORE_IMPORT_DB = 'reading-book.db'
/** Its WAL file: present while the direct build runs (or after a crash) → the source is "busy". */
export const STORE_IMPORT_DB_WAL = 'reading-book.db-wal'
/** Staging folder inside the Store userData; never survives a failed or cancelled import. */
export const STORE_IMPORT_STAGING_DIR = 'store-import.partial'
/** Marker file inside the Store userData (data-model §5). */
export const STORE_IMPORT_MARKER_FILE = 'store-import.json'

export type StoreImportEntryKind = 'file' | 'dir'

export interface StoreImportAllowEntry {
  readonly name: string
  readonly kind: StoreImportEntryKind
  readonly what: string
}

/** Copied, in this order (the database is renamed into place LAST at commit, whatever its copy position). */
export const STORE_IMPORT_ALLOWLIST: readonly StoreImportAllowEntry[] = [
  { name: STORE_IMPORT_DB, kind: 'file', what: 'library, annotations, reading state, collections, transcripts' },
  { name: 'books', kind: 'dir', what: 'app-owned (managed) book copies' },
  { name: 'covers', kind: 'dir', what: 'cover images' },
  { name: 'txt-edits', kind: 'dir', what: 'TXT edited-copy revisions' },
  { name: 'background-prefs.json', kind: 'file', what: 'System Tray / Run in Background preferences' },
  { name: 'notification-prefs.json', kind: 'file', what: 'notification + reading reminder preferences' },
  { name: 'reading-reminder-state.json', kind: 'file', what: 'reading reminder state' },
  { name: 'Local Storage', kind: 'dir', what: 'renderer preferences (Appearance, Library browse, reading defaults …)' },
]

/** Never copied, with the reason (anything not in the allowlist is skipped too). */
export const STORE_IMPORT_NEVER: Readonly<Record<string, string>> = {
  'cloud-tokens': 'protected per app — linked cloud accounts are signed in again',
  models: 're-downloadable translation models',
  'transcription-models': 're-downloadable speech models',
  'attachment-tmp': 'temporary',
  'attachment-staging': 'temporary',
  'zip-import-tmp': 'temporary',
}

/** Tables whose row counts must be equal in the source and the prepared copy (spec SC-009). */
export const COUNTED_TABLES = ['books', 'notes', 'collections', 'book_audio_chapters', 'txt_documents', 'audio_transcripts'] as const

/** The allowlist entry for a source folder entry (Windows names: case-insensitive), or undefined. */
export function allowEntryFor(name: string, kind: StoreImportEntryKind): StoreImportAllowEntry | undefined {
  const lower = name.toLowerCase()
  return STORE_IMPORT_ALLOWLIST.find((e) => e.name.toLowerCase() === lower && e.kind === kind)
}
