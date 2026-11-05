import * as SQLite from 'expo-sqlite'

/** M2 check (T023): which SQLite the device really runs, and whether JSON functions work. */
export async function checkSqlite(): Promise<string> {
  const db = await SQLite.openDatabaseAsync(':memory:')
  try {
    const row = await db.getFirstAsync<{ version: string; valid: number; extracted: number; fts5: number }>(
      `SELECT sqlite_version() AS version,
              json_valid('{"a":1}') AS valid,
              json_extract('{"a":1}', '$.a') AS extracted,
              sqlite_compileoption_used('ENABLE_FTS5') AS fts5`,
    )
    return `SQLite ${row?.version} | json_valid=${row?.valid} json_extract=${row?.extracted} | fts5=${row?.fts5}`
  } catch (error) {
    return `SQLite check failed: ${String(error)}`
  } finally {
    await db.closeAsync()
  }
}
