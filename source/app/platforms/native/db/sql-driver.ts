/**
 * The only thing Mobile's stores need from SQLite (spec 008, T043): the host's `sql.query`, `sql.run` and
 * `sql.transaction` (`contracts/host-services.md`). In the app the WebView reaches the host's `expo-sqlite` through
 * the bridge (M4); in tests `web/tests/node-sqlite-driver.ts` implements it on `node:sqlite`.
 *
 * Parameters are positional (`?`). A transaction is a batch of statements run all or nothing: nothing can be read
 * in the middle, so a store that must read before it writes does so before the batch, and relies on the bridge's
 * single write queue (T056) for ordering, as Desktop relies on its single Main process.
 */
import type { SqlValue } from '@reading-book/book-reader-sdk'

/** The core's `SqlValue`; the host takes `string | number | null` only, and `createHostSqlDriver` refuses the rest. */
export type SqlParam = SqlValue

export interface SqlStatement {
  sql: string
  params?: readonly SqlParam[]
}

export interface SqlRunResult {
  changes: number
  lastInsertRowId: number
}

export interface SqlDriver {
  /** Read only. Rows as plain objects keyed by column name. */
  query<Row = Record<string, unknown>>(sql: string, params?: readonly SqlParam[]): Promise<Row[]>
  /** Exactly one statement. */
  run(sql: string, params?: readonly SqlParam[]): Promise<SqlRunResult>
  /** All or nothing, in order; one result per statement. */
  transaction(statements: readonly SqlStatement[]): Promise<SqlRunResult[]>
}

/** First row of a query, or undefined. */
export async function queryOne<Row = Record<string, unknown>>(driver: SqlDriver, sql: string, params?: readonly SqlParam[]): Promise<Row | undefined> {
  return (await driver.query<Row>(sql, params))[0]
}
