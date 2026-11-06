/**
 * Mobile's migration runner (spec 008, T042). Mobile has its own numbered migrations starting at `001_baseline`,
 * unrelated to Desktop's numbers (data-model.md); a Mobile database file is never a Desktop one.
 *
 * Each migration runs as ONE `sql.transaction` batch together with its `schema_migrations` row, so a failed
 * migration leaves nothing behind and is retried on the next start. The batch holds single statements only (the
 * host's `sql.run` rule), so a migration file is split by `splitSqlStatements`.
 */
import baseline001 from '../../../../core/src/db/mobile/migrations/001_baseline.sql?raw'
import { planMigrations, splitSqlStatements, type Migration } from '@reading-book/book-reader-sdk'
import type { SqlDriver, SqlStatement } from './sql-driver'

// The planning and the statement splitter live in core (spec 009 T031); re-exported for the tests that import them here.
export { splitSqlStatements }
export type { Migration }

export const MOBILE_MIGRATIONS: readonly Migration[] = [{ name: '001_baseline.sql', sql: baseline001 }]

const MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
)`

export interface MigrateResult {
  applied: string[]
  alreadyApplied: string[]
}

export async function migrate(driver: SqlDriver, migrations: readonly Migration[] = MOBILE_MIGRATIONS, now: () => string = () => new Date().toISOString()): Promise<MigrateResult> {
  await driver.run(MIGRATIONS_TABLE)
  const recorded = (await driver.query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name)
  const plan = planMigrations(recorded, migrations)
  if (plan.unknown.length) throw new Error(`This database has migrations this app does not know (${plan.unknown.join(', ')}); it was written by a newer version`)
  const result: MigrateResult = { applied: [], alreadyApplied: plan.alreadyApplied }
  for (const migration of plan.pending) {
    const statements: SqlStatement[] = splitSqlStatements(migration.sql).map((sql) => ({ sql }))
    statements.push({ sql: 'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', params: [migration.name, now()] })
    await driver.transaction(statements)
    result.applied.push(migration.name)
  }
  return result
}
