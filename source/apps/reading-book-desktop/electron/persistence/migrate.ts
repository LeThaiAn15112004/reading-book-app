import type { Database } from 'better-sqlite3'
import migration001 from './migrations/001_initial.sql?raw'

interface Migration {
  name: string
  sql: string
}

const MIGRATIONS: Migration[] = [
  { name: '001_initial.sql', sql: migration001 },
]

/**
 * Apply pending SQL migrations in order. Idempotent via schema_migrations.
 */
export function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `)

  const applied = new Set(
    (db.prepare('SELECT name FROM schema_migrations').all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  )

  const insert = db.prepare(
    'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)',
  )

  const runPending = db.transaction(() => {
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.name)) continue
      db.exec(migration.sql)
      insert.run(migration.name, new Date().toISOString())
    }
  })

  runPending()
}
