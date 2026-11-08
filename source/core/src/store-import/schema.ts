// Spec 010 (FR-014a, contracts/store-import.md "Steps" 3–4) — refuse data from a newer app version, and prove that
// preparing the copy (migrations + path rewrite) lost no row.
import { COUNTED_TABLES } from './allowlist.js'

/** True when the source database has applied a migration this build does not know (it comes from a newer app). */
export function isNewerSchema(sourceNames: readonly string[], knownNames: readonly string[]): boolean {
  const known = new Set(knownNames)
  return sourceNames.some((name) => !known.has(name))
}

export type TableCounts = Readonly<Record<string, number>>

export type CountCheck = { readonly ok: true } | { readonly ok: false; readonly refuse: 'integrity'; readonly table: string }

/** Equal row counts for every table in `tables` (a table missing on one side counts as a difference). */
export function verifyCounts(
  before: TableCounts,
  after: TableCounts,
  tables: readonly string[] = COUNTED_TABLES,
): CountCheck {
  for (const table of tables) {
    if (before[table] !== after[table]) return { ok: false, refuse: 'integrity', table }
  }
  return { ok: true }
}
