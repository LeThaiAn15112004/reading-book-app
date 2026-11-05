/**
 * `sql.query`, `sql.run`, `sql.transaction` (spec 008, T051; `contracts/host-services.md`). The rules are checked
 * here, over an `SqlEngine` port: `expo-sqlite-engine.ts` in the app, `node:sqlite` in the vitest suite.
 *
 *   - `query` is read only (`SELECT`, or a `WITH` that writes nothing) and its result is capped;
 *   - `run` is exactly one statement;
 *   - `transaction` runs a batch all or nothing. On the device it is `withExclusiveTransactionAsync`, which runs on
 *     its own connection, so `PRAGMA foreign_keys` does not apply inside it: Mobile's stores delete dependent rows
 *     explicitly and never rely on cascades.
 *
 * Parameters are positional and only `string | number | null`.
 */
import { argsObject } from './rpc'
import { HostServiceError } from './protocol'

export type SqlParam = string | number | null
export type SqlRow = Record<string, unknown>

export interface SqlRunResult {
  changes: number
  lastInsertRowId: number
}

export interface SqlEngineConnection {
  all(sql: string, params: SqlParam[]): Promise<SqlRow[]>
  run(sql: string, params: SqlParam[]): Promise<SqlRunResult>
}

export interface SqlEngine extends SqlEngineConnection {
  /** Commits when `task` resolves, rolls back when it rejects. Only `txn` statements belong to it. */
  exclusiveTransaction<T>(task: (txn: SqlEngineConnection) => Promise<T>): Promise<T>
}

export const SQL_LIMITS = {
  maxRows: 20_000,
  maxSqlChars: 100_000,
  maxParams: 999,
  maxStatements: 2_000,
} as const

const WRITE_KEYWORD = /\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX|PRAGMA)\b/i

/** SQL text with string literals, quoted identifiers and comments blanked, so keywords and `;` can be found. */
export function stripSqlLiterals(sql: string): string {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]!
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c
      i++
      while (i < sql.length) {
        if (sql[i] === close) {
          if (close !== ']' && sql[i + 1] === close) {
            i += 2
            continue
          }
          break
        }
        i++
      }
      i++
      out += ' '
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      out += ' '
    } else if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end < 0 ? sql.length : end + 2
      out += ' '
    } else {
      out += c
      i++
    }
  }
  return out
}

/** One statement: no `;` except a trailing one. A trigger body would need `;`, and triggers come only from migrations
 *  through `sql.transaction`, which also takes single statements, so `BEGIN … END` is accepted there. */
export function isSingleStatement(sql: string, allowTriggerBody = false): boolean {
  const bare = stripSqlLiterals(sql).trim().replace(/;\s*$/, '')
  if (!bare) return false
  if (!bare.includes(';')) return true
  return allowTriggerBody && /^CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(bare) && /\bEND$/i.test(bare)
}

export function isReadOnlyQuery(sql: string): boolean {
  const bare = stripSqlLiterals(sql).trim()
  if (/^SELECT\b/i.test(bare)) return !WRITE_KEYWORD.test(bare)
  if (/^WITH\b/i.test(bare)) return !WRITE_KEYWORD.test(bare)
  return false
}

function readStatement(raw: unknown, where: string): { sql: string; params: SqlParam[] } {
  const value = argsObject(raw)
  const sql = value.sql
  if (typeof sql !== 'string' || !sql.trim()) throw new HostServiceError('INVALID_ARGUMENT', `${where}: sql is required`)
  if (sql.length > SQL_LIMITS.maxSqlChars) throw new HostServiceError('INVALID_ARGUMENT', `${where}: sql is too long`)
  const params = value.params ?? []
  if (!Array.isArray(params) || params.length > SQL_LIMITS.maxParams) throw new HostServiceError('INVALID_ARGUMENT', `${where}: params must be an array`)
  for (const p of params) {
    const ok = p === null || typeof p === 'string' || (typeof p === 'number' && Number.isFinite(p))
    if (!ok) throw new HostServiceError('INVALID_ARGUMENT', `${where}: a parameter must be a string, a finite number or null`)
  }
  return { sql, params: params as SqlParam[] }
}

function sqlFailure(error: unknown): HostServiceError {
  if (error instanceof HostServiceError) return error
  const text = error instanceof Error ? error.message : String(error)
  // Constraint names are useful to the stores (duplicate sha256), and SQLite messages carry no file paths.
  return new HostServiceError('SQL_FAILED', text.slice(0, 500))
}

export function createSqlService(engine: SqlEngine) {
  return {
    async query(raw: unknown): Promise<SqlRow[]> {
      const { sql, params } = readStatement(raw, 'sql.query')
      if (!isSingleStatement(sql) || !isReadOnlyQuery(sql)) throw new HostServiceError('NOT_ALLOWED', 'sql.query runs one read-only statement')
      let rows: SqlRow[]
      try {
        rows = await engine.all(sql, params)
      } catch (error) {
        throw sqlFailure(error)
      }
      if (rows.length > SQL_LIMITS.maxRows) throw new HostServiceError('RESULT_TOO_LARGE', `sql.query returned more than ${SQL_LIMITS.maxRows} rows`)
      return rows
    },

    async run(raw: unknown): Promise<SqlRunResult> {
      const { sql, params } = readStatement(raw, 'sql.run')
      if (!isSingleStatement(sql)) throw new HostServiceError('NOT_ALLOWED', 'sql.run runs exactly one statement')
      try {
        return await engine.run(sql, params)
      } catch (error) {
        throw sqlFailure(error)
      }
    },

    async transaction(raw: unknown): Promise<SqlRunResult[]> {
      const list = argsObject(raw).statements
      if (!Array.isArray(list) || list.length === 0 || list.length > SQL_LIMITS.maxStatements) {
        throw new HostServiceError('INVALID_ARGUMENT', 'sql.transaction needs 1 to 2000 statements')
      }
      const statements = list.map((s, i) => readStatement(s, `sql.transaction[${i}]`))
      for (const [i, s] of statements.entries()) {
        if (!isSingleStatement(s.sql, true)) throw new HostServiceError('NOT_ALLOWED', `sql.transaction[${i}] must be one statement`)
        if (/^\s*(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(stripSqlLiterals(s.sql))) {
          throw new HostServiceError('NOT_ALLOWED', 'sql.transaction manages the transaction itself')
        }
      }
      try {
        return await engine.exclusiveTransaction(async (txn) => {
          const results: SqlRunResult[] = []
          for (const s of statements) results.push(await txn.run(s.sql, s.params))
          return results
        })
      } catch (error) {
        throw sqlFailure(error)
      }
    },
  }
}
