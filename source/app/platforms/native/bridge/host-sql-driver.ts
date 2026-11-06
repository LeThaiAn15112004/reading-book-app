/** `SqlDriver` over the host's `sql.*` services (spec 008, T043, T056): what the Mobile stores run on in the app. */
import type { AsyncSqlDriver, SqlValue, Statement } from '@core'
import type { SqlDriver, SqlRunResult, SqlStatement } from '../db/sql-driver'
import type { HostClient } from './host-client'

/** What the host's sql.* services bind. */
type HostParam = string | number | null

export function createHostSqlDriver(client: HostClient): SqlDriver {
  return {
    query: <Row>(sql: string, params: readonly SqlValue[] = []) => client.call<Row[]>('sql', 'query', { sql, params: params.map(toHostParam) }),
    run: (sql: string, params: readonly SqlValue[] = []) => client.call<SqlRunResult>('sql', 'run', { sql, params: params.map(toHostParam) }),
    transaction: (statements: readonly SqlStatement[]) =>
      client.call<SqlRunResult[]>('sql', 'transaction', { statements: statements.map((s) => ({ sql: s.sql, params: (s.params ?? []).map(toHostParam) })) }),
  }
}

/**
 * The same host services as the core's `AsyncSqlDriver` port (spec 009 T028, contracts/sql-drivers.md). The host takes
 * `string | number | null` only, so a `bigint` outside the safe integer range or a `Uint8Array` is refused here, before
 * any RPC. `createHostSqlDriver` above stays for the stores until they move onto core statements (T032+).
 */
export function createHostAsyncSqlDriver(client: HostClient): AsyncSqlDriver {
  const params = (statement: Statement): HostParam[] => statement.params.map(toHostParam)
  return {
    run: (statement) => client.call<SqlRunResult>('sql', 'run', { sql: statement.sql, params: params(statement) }),
    all: <Row>(statement: Statement) => client.call<Row[]>('sql', 'query', { sql: statement.sql, params: params(statement) }),
    async transaction(statements) {
      await client.call<SqlRunResult[]>('sql', 'transaction', {
        statements: statements.map((s) => ({ sql: s.sql, params: params(s) })),
      })
    },
  }
}

function toHostParam(value: SqlValue): HostParam {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new TypeError('The Mobile host cannot bind a bigint outside the safe integer range')
    }
    return Number(value)
  }
  if (value instanceof Uint8Array) throw new TypeError('The Mobile host cannot bind binary parameters (sql.* takes string, number or null)')
  return value
}
