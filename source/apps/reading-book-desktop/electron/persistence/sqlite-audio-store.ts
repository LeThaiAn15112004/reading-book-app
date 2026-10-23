import type { Database as SqliteDatabase } from 'better-sqlite3'
import {
  isAudioFormat,
  parseReadingState,
  sanitizeAudioBookmarks,
  type AudioBookmark,
} from '@reading-book/book-reader-sdk'
import { getDatabase } from './db'

/**
 * Audiobook bookmarks, kept in `books.reading_state_json.audioBookmarks` (no table, no migration).
 * Written with `json_patch`, so the location, typography, `audioProgress` and any unknown key of the
 * reading state are left alone; limited to audio books in SQL itself. The whole list is replaced on
 * every save (a JSON array is replaced, not merged, by RFC 7396) after being re-validated here.
 */
export class SqliteAudioStore {
  constructor(private readonly db: SqliteDatabase = getDatabase()) {}

  getBookmarks(bookId: string): AudioBookmark[] {
    const id = bookId.trim()
    if (!id) return []
    const row = this.db
      .prepare('SELECT file_format, reading_state_json FROM books WHERE id = ?')
      .get(id) as { file_format: string; reading_state_json: string } | undefined
    if (!row || !isAudioFormat(row.file_format)) return []
    return sanitizeAudioBookmarks(parseReadingState(row.reading_state_json).audioBookmarks)
  }

  /** Replace the list; false when the book is not an audiobook. */
  saveBookmarks(bookId: string, bookmarks: unknown): boolean {
    const id = bookId.trim()
    if (!id) return false
    const clean = sanitizeAudioBookmarks(bookmarks)
    const result = this.db
      .prepare(
        `UPDATE books
         SET reading_state_json = json_patch(reading_state_json, @patch),
             updated_at = @now
         WHERE id = @id AND file_format = 'mp3'`,
      )
      .run({ id, patch: JSON.stringify({ audioBookmarks: clean }), now: new Date().toISOString() })
    return Number(result.changes) > 0
  }
}

let instance: SqliteAudioStore | undefined
export function getAudioStore(): SqliteAudioStore {
  instance ??= new SqliteAudioStore()
  return instance
}
