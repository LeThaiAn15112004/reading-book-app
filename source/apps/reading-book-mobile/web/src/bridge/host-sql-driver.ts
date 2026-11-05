/** `SqlDriver` over the host's `sql.*` services (spec 008, T043, T056): what the Mobile stores run on in the app. */
import type { SqlDriver, SqlParam, SqlRunResult, SqlStatement } from '../db/sql-driver'
import type { HostClient } from './host-client'

export function createHostSqlDriver(client: HostClient): SqlDriver {
  return {
    query: <Row>(sql: string, params: readonly SqlParam[] = []) => client.call<Row[]>('sql', 'query', { sql, params }),
    run: (sql: string, params: readonly SqlParam[] = []) => client.call<SqlRunResult>('sql', 'run', { sql, params }),
    transaction: (statements: readonly SqlStatement[]) =>
      client.call<SqlRunResult[]>('sql', 'transaction', { statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })) }),
  }
}
