/**
 * SQL of the audiobook Notes store as `Statement` builders (spec 009 T035). The Notes live in
 * `books.reading_state_json.audioBookmarks` (no table), so these are `books` / `book_audio_chapters` statements.
 * Desktop only. No driver, no I/O.
 */
import type { SqlValue, Statement } from '../driver.js'

const s = (sql: string, ...params: SqlValue[]): Statement => ({ sql, params })

export const selectFormatAndReadingState = (bookId: string) => s('SELECT file_format, reading_state_json FROM books WHERE id = ?', bookId)

/** Track ids of a multi-track book (none for a single-file one). */
export const selectChapterIdsOfBook = (bookId: string) => s('SELECT id FROM book_audio_chapters WHERE book_id = ?', bookId)

/** `json_patch` of the Notes list, restricted to audio books in SQL itself. */
export const patchAudioBookmarks = (bookId: string, patchJson: string, now: string) =>
  s(
    `UPDATE books
     SET reading_state_json = json_patch(reading_state_json, ?),
         updated_at = ?
     WHERE id = ? AND file_format IN ('mp3', 'm4a', 'm4b', 'aac', 'wav', 'flac', 'ogg', 'opus')`,
    patchJson,
    now,
    bookId,
  )
