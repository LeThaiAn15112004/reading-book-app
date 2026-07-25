import type { Database } from 'better-sqlite3'
import migration001 from './migrations/001_initial.sql?raw'
import migration002 from './migrations/002_expand_file_formats.sql?raw'
import migration003 from './migrations/003_book_signatures.sql?raw'
import migration004 from './migrations/004_comments.sql?raw'
import migration005 from './migrations/005_drop_app_settings.sql?raw'

interface Migration {
  name: string
  sql: string
}

const MIGRATIONS: Migration[] = [
  { name: '001_initial.sql', sql: migration001 },
  { name: '002_expand_file_formats.sql', sql: migration002 },
  { name: '003_book_signatures.sql', sql: migration003 },
  { name: '004_comments.sql', sql: migration004 },
  { name: '005_drop_app_settings.sql', sql: migration005 },
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
