import type { Database as SqliteDatabase } from 'better-sqlite3'
import { audioCodec, audioStatements as q, isAudioFormat, type AudioBookmark, type SyncSqlDriver } from '@reading-book/book-reader-sdk'
import { getDatabase } from './db'
import { createSyncSqlDriver } from './sql-driver'

/**
 * Audiobook Notes (storage key `audioBookmarks`), kept in `books.reading_state_json.audioBookmarks` (no table, no
 * migration). Written with `json_patch`, so the location, typography, `audioProgress` and any unknown key of the
 * reading state are left alone; limited to audio books in SQL itself. The whole list is replaced on every save (a JSON
 * array is replaced, not merged, by RFC 7396) after being re-validated here.
 *
 * Two kinds of audiobook:
 *  - single-file: Notes carry no `trackId`; a save that carries one is refused. Behaviour unchanged.
 *  - multi-track (it has `book_audio_chapters` rows): every Note names a track of THIS book (`trackId`) and its position
 *    is seconds inside that track. A save is refused as a whole unless every incoming Note names an owned track, or if
 *    it holds more than `MAX_AUDIO_BOOKMARKS` entries (nothing is truncated). Stored entries whose `trackId` is missing
 *    or not owned ("foreign" entries) are never returned, but they are carried over on every save, so an ordinary
 *    add / edit / delete cannot discard them.
 */
export class SqliteAudioStore {
  private readonly sql: SyncSqlDriver

  constructor(db: SqliteDatabase = getDatabase()) {
    this.sql = createSyncSqlDriver(db)
  }

  getBookmarks(bookId: string): AudioBookmark[] {
    const id = bookId.trim()
    if (!id) return []
    const row = this.sql.get<{ file_format: string; reading_state_json: string }>(q.selectFormatAndReadingState(id))
    if (!row || !isAudioFormat(row.file_format)) return []
    return audioCodec.readAudioBookmarks(row.reading_state_json, this.ownedTrackIds(id))
  }

  /** Replace the list; false when the book is not an audiobook or the list is refused (nothing is written then). */
  saveBookmarks(bookId: string, bookmarks: unknown): boolean {
    const id = bookId.trim()
    if (!id) return false
    return this.sql.transaction((): boolean => {
      const row = this.sql.get<{ file_format: string; reading_state_json: string }>(q.selectFormatAndReadingState(id))
      if (!row || !isAudioFormat(row.file_format)) return false
      const list = audioCodec.planAudioBookmarksSave(row.reading_state_json, bookmarks, this.ownedTrackIds(id))
      if (!list) return false
      const result = this.sql.run(q.patchAudioBookmarks(id, JSON.stringify({ audioBookmarks: list }), new Date().toISOString()))
      return result.changes > 0
    })
  }

  /** The track ids of a multi-track book, or `null` for a single-file one. */
  private ownedTrackIds(bookId: string): Set<string> | null {
    const rows = this.sql.all<{ id: string }>(q.selectChapterIdsOfBook(bookId))
    return rows.length > 0 ? new Set(rows.map((r) => r.id)) : null
  }
}

let instance: SqliteAudioStore | undefined
export function getAudioStore(): SqliteAudioStore {
  instance ??= new SqliteAudioStore()
  return instance
}
