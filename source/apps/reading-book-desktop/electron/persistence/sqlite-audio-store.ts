import type { Database as SqliteDatabase } from 'better-sqlite3'
import {
  MAX_AUDIO_BOOKMARKS,
  isAudioFormat,
  parseReadingState,
  sanitizeAudioBookmarks,
  type AudioBookmark,
} from '@reading-book/book-reader-sdk'
import { getDatabase } from './db'

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
  constructor(private readonly db: SqliteDatabase = getDatabase()) {}

  getBookmarks(bookId: string): AudioBookmark[] {
    const id = bookId.trim()
    if (!id) return []
    const row = this.db
      .prepare('SELECT file_format, reading_state_json FROM books WHERE id = ?')
      .get(id) as { file_format: string; reading_state_json: string } | undefined
    if (!row || !isAudioFormat(row.file_format)) return []
    const raw = parseReadingState(row.reading_state_json).audioBookmarks
    const owned = this.ownedTrackIds(id)
    if (!owned) {
      // single-file: output as before; a stray `trackId` is never handed out
      return sanitizeAudioBookmarks(raw).map(withoutTrackId)
    }
    if (!Array.isArray(raw)) return []
    // multi-track: partition the RAW array first, so foreign entries never take one of the 500 visible slots
    return sanitizeAudioBookmarks(raw.filter((entry) => isOwnedEntry(entry, owned)))
  }

  /** Replace the list; false when the book is not an audiobook or the list is refused (nothing is written then). */
  saveBookmarks(bookId: string, bookmarks: unknown): boolean {
    const id = bookId.trim()
    if (!id) return false
    const write = this.db.transaction((): boolean => {
      const row = this.db
        .prepare('SELECT file_format, reading_state_json FROM books WHERE id = ?')
        .get(id) as { file_format: string; reading_state_json: string } | undefined
      if (!row || !isAudioFormat(row.file_format)) return false
      const owned = this.ownedTrackIds(id)
      let list: AudioBookmark[]
      if (!owned) {
        list = sanitizeAudioBookmarks(bookmarks)
        if (list.some((n) => n.trackId !== undefined)) return false
      } else {
        if (!Array.isArray(bookmarks) || bookmarks.length > MAX_AUDIO_BOOKMARKS) return false
        const incoming = sanitizeAudioBookmarks(bookmarks)
        if (incoming.some((n) => n.trackId === undefined || !owned.has(n.trackId))) return false
        const stored = parseReadingState(row.reading_state_json).audioBookmarks
        // partition the RAW stored array BEFORE sanitizing, then sanitize the foreign set on its own
        const foreign = Array.isArray(stored) ? sanitizeAudioBookmarks(stored.filter((entry) => !isOwnedEntry(entry, owned))) : []
        const incomingIds = new Set(incoming.map((n) => n.id))
        list = [...incoming, ...foreign.filter((n) => !incomingIds.has(n.id))]
      }
      const result = this.db
        .prepare(
          `UPDATE books
           SET reading_state_json = json_patch(reading_state_json, @patch),
               updated_at = @now
           WHERE id = @id AND file_format IN ('mp3', 'm4a', 'm4b', 'aac', 'wav', 'flac', 'ogg', 'opus')`,
        )
        .run({ id, patch: JSON.stringify({ audioBookmarks: list }), now: new Date().toISOString() })
      return Number(result.changes) > 0
    })
    return write()
  }

  /** The track ids of a multi-track book, or `null` for a single-file one. */
  private ownedTrackIds(bookId: string): Set<string> | null {
    const rows = this.db.prepare('SELECT id FROM book_audio_chapters WHERE book_id = ?').all(bookId) as { id: string }[]
    return rows.length > 0 ? new Set(rows.map((r) => r.id)) : null
  }
}

function isOwnedEntry(entry: unknown, owned: ReadonlySet<string>): boolean {
  if (!entry || typeof entry !== 'object') return false
  const trackId = (entry as { trackId?: unknown }).trackId
  return typeof trackId === 'string' && owned.has(trackId)
}

function withoutTrackId(note: AudioBookmark): AudioBookmark {
  if (note.trackId === undefined) return note
  const { trackId: _drop, ...rest } = note
  void _drop
  return rest
}

let instance: SqliteAudioStore | undefined
export function getAudioStore(): SqliteAudioStore {
  instance ??= new SqliteAudioStore()
  return instance
}
