// Types for dump-desktop-schema.mjs, used by web/tests/contract-conformance.test.ts.
import type { DatabaseSync } from 'node:sqlite'

export interface SchemaEntry {
  type: string
  name: string
  tbl_name: string
  sql: string
}
export interface ColumnInfo {
  name: string
  type: string
  notnull: number
  dflt: string | null
  pk: number
}
export function migratedDesktopDatabase(): { db: DatabaseSync; applied: string[]; skipped: string[] }
export function schemaOf(db: DatabaseSync, tables?: readonly string[]): SchemaEntry[]
export function columnsOf(db: DatabaseSync, table: string): ColumnInfo[]
