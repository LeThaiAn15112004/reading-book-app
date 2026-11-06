/**
 * The rules of the audiobook Notes list (spec 009 T035), pure: what a read returns and what a save writes, given the
 * stored `reading_state_json` and the track ids of the book. Desktop's store runs the statements; the rules live here.
 *
 *  - single-file (`owned` is null): Notes carry no `trackId`; a save that carries one is refused; a stored stray
 *    `trackId` is never handed out.
 *  - multi-track: every Note names a track of THIS book. A save is refused as a whole unless every incoming Note names
 *    an owned track, or it holds more than `MAX_AUDIO_BOOKMARKS` entries (nothing is truncated). Stored entries whose
 *    `trackId` is missing or not owned ("foreign") are never returned but are carried over on every save.
 */
import { MAX_AUDIO_BOOKMARKS, sanitizeAudioBookmarks, type AudioBookmark } from '../../audio/audio-bookmarks.js'
import { parseReadingState } from '../../persistence/books-json.js'

export function isOwnedEntry(entry: unknown, owned: ReadonlySet<string>): boolean {
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

/** The Notes a read returns. */
export function readAudioBookmarks(readingStateJson: string, owned: ReadonlySet<string> | null): AudioBookmark[] {
  const raw = parseReadingState(readingStateJson).audioBookmarks
  if (!owned) return sanitizeAudioBookmarks(raw).map(withoutTrackId)
  if (!Array.isArray(raw)) return []
  // multi-track: partition the RAW array first, so foreign entries never take one of the 500 visible slots
  return sanitizeAudioBookmarks(raw.filter((entry) => isOwnedEntry(entry, owned)))
}

/** The list a save writes, or `null` when the save is refused (nothing is written then). */
export function planAudioBookmarksSave(readingStateJson: string, bookmarks: unknown, owned: ReadonlySet<string> | null): AudioBookmark[] | null {
  if (!owned) {
    const list = sanitizeAudioBookmarks(bookmarks)
    return list.some((n) => n.trackId !== undefined) ? null : list
  }
  if (!Array.isArray(bookmarks) || bookmarks.length > MAX_AUDIO_BOOKMARKS) return null
  const incoming = sanitizeAudioBookmarks(bookmarks)
  if (incoming.some((n) => n.trackId === undefined || !owned.has(n.trackId))) return null
  const stored = parseReadingState(readingStateJson).audioBookmarks
  // partition the RAW stored array BEFORE sanitizing, then sanitize the foreign set on its own
  const foreign = Array.isArray(stored) ? sanitizeAudioBookmarks(stored.filter((entry) => !isOwnedEntry(entry, owned))) : []
  const incomingIds = new Set(incoming.map((n) => n.id))
  return [...incoming, ...foreign.filter((n) => !incomingIds.has(n.id))]
}
