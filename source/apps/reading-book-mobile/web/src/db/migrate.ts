/**
 * Mobile's migration runner (spec 008, T042). Mobile has its own numbered migrations starting at `001_baseline`,
 * unrelated to Desktop's numbers (data-model.md); a Mobile database file is never a Desktop one.
 *
 * Each migration runs as ONE `sql.transaction` batch together with its `schema_migrations` row, so a failed
 * migration leaves nothing behind and is retried on the next start. The batch holds single statements only (the
 * host's `sql.run` rule), so a migration file is split by `splitSqlStatements`.
 */
import baseline001 from './migrations/001_baseline.sql?raw'
import type { SqlDriver, SqlStatement } from './sql-driver'

export interface Migration {
  /** `NNN_name.sql`; applied in this order, each once. */
  name: string
  sql: string
}

export const MOBILE_MIGRATIONS: readonly Migration[] = [{ name: '001_baseline.sql', sql: baseline001 }]

const MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
)`

/**
 * Splits a SQL script into single statements. Aware of quotes ('', "", ``, []), `--` and block comments, and of
 * `BEGIN … END` bodies (triggers), so a `;` inside any of them does not split. Empty statements are dropped.
 */
export function splitSqlStatements(script: string): string[] {
  const out: string[] = []
  let current = ''
  let depth = 0
  let word = ''
  const flushWord = () => {
    const w = word.toUpperCase()
    if (w === 'BEGIN' && /CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER/i.test(current)) depth++
    else if (w === 'END' && depth > 0) depth--
    word = ''
  }
  for (let i = 0; i < script.length; i++) {
    const c = script[i]!
    const next = script[i + 1]
    if (c === '-' && next === '-') {
      flushWord()
      const end = script.indexOf('\n', i)
      i = end < 0 ? script.length : end
      current += '\n'
      continue
    }
    if (c === '/' && next === '*') {
      flushWord()
      const end = script.indexOf('*/', i + 2)
      i = end < 0 ? script.length : end + 1
      current += ' '
      continue
    }
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      flushWord()
      const close = c === '[' ? ']' : c
      let j = i + 1
      while (j < script.length) {
        if (script[j] === close) {
          if (close !== ']' && script[j + 1] === close) j += 2
          else break
        } else j++
      }
      current += script.slice(i, j + 1)
      i = j
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      word += c
      current += c
      continue
    }
    flushWord()
    if (c === ';' && depth === 0) {
      if (current.trim()) out.push(current.trim())
      current = ''
      continue
    }
    current += c
  }
  flushWord()
  if (current.trim()) out.push(current.trim())
  return out
}

export interface MigrateResult {
  applied: string[]
  alreadyApplied: string[]
}

export async function migrate(driver: SqlDriver, migrations: readonly Migration[] = MOBILE_MIGRATIONS, now: () => string = () => new Date().toISOString()): Promise<MigrateResult> {
  const names = migrations.map((m) => m.name)
  if (names.some((n, i) => i > 0 && n <= names[i - 1]!)) throw new Error(`Migrations must be in strictly increasing order: ${names.join(', ')}`)
  await driver.run(MIGRATIONS_TABLE)
  const done = new Set((await driver.query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name))
  const unknown = [...done].filter((n) => !names.includes(n))
  if (unknown.length) throw new Error(`This database has migrations this app does not know (${unknown.join(', ')}); it was written by a newer version`)
  const result: MigrateResult = { applied: [], alreadyApplied: [] }
  for (const migration of migrations) {
    if (done.has(migration.name)) {
      result.alreadyApplied.push(migration.name)
      continue
    }
    const statements: SqlStatement[] = splitSqlStatements(migration.sql).map((sql) => ({ sql }))
    statements.push({ sql: 'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', params: [migration.name, now()] })
    await driver.transaction(statements)
    result.applied.push(migration.name)
  }
  return result
}
