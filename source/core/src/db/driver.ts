/**
 * SQL driver ports (spec 009, contracts/sql-drivers.md). The core holds the SQL and the row codecs; each platform
 * supplies a driver. No driver package, `node:*`, Electron or React Native is imported here.
 */

/** A value that can be bound to a statement parameter or read from a column. */
export type SqlValue = string | number | bigint | null | Uint8Array

/** One SQL statement with its positional (`?`) parameters. */
export interface Statement {
  readonly sql: string
  readonly params: readonly SqlValue[]
}

/** Desktop: better-sqlite3 in Electron Main. Every call is synchronous. */
export interface SyncSqlDriver {
  run(statement: Statement): { changes: number; lastInsertRowid: number | bigint }
  all<Row>(statement: Statement): Row[]
  get<Row>(statement: Statement): Row | undefined
  /**
   * Runs `work` inside one transaction (`BEGIN` / `BEGIN IMMEDIATE` … `COMMIT`; `ROLLBACK` when it throws).
   * `work` must be synchronous: no `await` inside, ever, or another handler's writes would land in the transaction.
   */
  transaction<T>(work: () => T, mode?: 'deferred' | 'immediate'): T
}

/** Mobile: host services over postMessage. */
export interface AsyncSqlDriver {
  run(statement: Statement): Promise<{ changes: number; lastInsertRowId: number }>
  all<Row>(statement: Statement): Promise<Row[]>
  /** All statements or none: the host applies them in one transaction. */
  transaction(statements: readonly Statement[]): Promise<void>
}
