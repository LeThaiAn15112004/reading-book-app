/**
 * Reading activity the reminder needs, read from the library DB. Takes the minimal statement API
 * shared by better-sqlite3 (the app) and node:sqlite (spikes/reminders), and only runs prepared
 * read-only statements with bound parameters on the app's single open connection — nothing is opened
 * or left open here.
 *
 * "Read" = the book's reading state changed (`books.reading_state_json.updatedAt`, an ISO-8601 UTC
 * timestamp written by the Reader's session autosave and by opening a book). Comparing through
 * `julianday()` makes the check independent of the string's exact format / offset.
 */

export type SqlStatement = { get(...params: string[]): unknown }
export type SqlDatabase = { prepare(sql: string): SqlStatement }

/** Any book read at or after `since` (pass local midnight to ask "has the user read today?"). */
export function hasReadSince(db: SqlDatabase, since: Date): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS hit
       FROM books
       WHERE json_extract(reading_state_json, '$.updatedAt') IS NOT NULL
         AND julianday(json_extract(reading_state_json, '$.updatedAt')) >= julianday(?)
       LIMIT 1`,
    )
    .get(since.toISOString())
  return row !== undefined && row !== null
}

export type BookInProgress = { bookId: string; title: string }

/** The book in progress the user touched last (what "Continue reading …?" opens), or null. */
export function lastBookInProgress(db: SqlDatabase): BookInProgress | null {
  const row = db
    .prepare(
      `SELECT id, title
       FROM books
       WHERE reading_status = 'reading'
       ORDER BY COALESCE(julianday(json_extract(reading_state_json, '$.updatedAt')), 0) DESC,
                updated_at DESC
       LIMIT 1`,
    )
    .get() as { id?: unknown; title?: unknown } | undefined
  if (!row || typeof row.id !== 'string') return null
  return { bookId: row.id, title: typeof row.title === 'string' ? row.title : '' }
}
