/**
 * Audiobook NOTES (stored under the historical key `audioBookmarks`): a marked position in seconds with an optional text, plus the chapter it was made in when there is one.
 * Stored (by Main) under `reading_state_json.audioBookmarks`; they are NOT `Location`s and do not go
 * through the EPUB / PDF / TXT bookmark model.
 */
import { clampSeekPosition, formatPlaybackTime, knownDuration } from './audio-playback.js'
import { chapterIndexAt, type AudioChapter } from './audio-timeline.js'

export interface AudioBookmark {
  id: string
  label: string
  /** Canonical position: seconds from the start of the audio when the bookmark was made. */
  positionSeconds: number
  /** The user's own text for this position; absent = a plain marker (still a valid note). */
  note?: string
  /** The chapter the position was in, when chapters were known. */
  chapterId?: string
  /** Seconds into that chapter. With `chapterId` it lets the bookmark follow a chapter list that was re-read. */
  chapterOffsetSeconds?: number
  createdAt: string
  /**
   * Multi-track audiobooks only: the stable id of the track (`book_audio_chapters.id`) the Note belongs to.
   * With it, `positionSeconds` is seconds INSIDE that track and no `chapterId` is set. Absent on single-file Notes.
   */
  trackId?: string
}

export const MAX_AUDIO_BOOKMARKS = 500
export const MAX_NOTE_CHARS = 2000

/** Trim, cap and normalise a note text; empty → undefined. */
export function normalizeNoteText(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const t = raw.trim().slice(0, MAX_NOTE_CHARS)
  return t || undefined
}
const MAX_SECONDS = 10_000_000

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function createAudioBookmark(input: {
  id: string
  positionSeconds: number
  chapters: readonly AudioChapter[]
  nowIso: string
  label?: string
  note?: string
  /** A multi-track Note: the track it belongs to (the position is seconds inside that track; `chapters` is ignored). */
  trackId?: string
  /** 1-based track number, used only for the default label of a track Note. */
  trackNumber?: number
}): AudioBookmark {
  const position = clampSeekPosition(input.positionSeconds, null)
  if (input.trackId) {
    const time = formatPlaybackTime(position)
    const number = input.trackNumber
    const fallback = typeof number === 'number' && Number.isInteger(number) && number >= 1 ? `Track ${number} · ${time}` : `Bookmark at ${time}`
    const trackNote: AudioBookmark = {
      id: input.id,
      label: input.label?.trim().slice(0, 200) || fallback,
      positionSeconds: position,
      createdAt: input.nowIso,
      trackId: input.trackId,
    }
    const text = normalizeNoteText(input.note)
    if (text) trackNote.note = text
    return trackNote
  }
  const index = chapterIndexAt(input.chapters, position)
  const chapter = index >= 0 ? (input.chapters[index] as AudioChapter) : undefined
  const time = formatPlaybackTime(position)
  const label = input.label?.trim().slice(0, 200) || (chapter ? `${chapter.title} · ${time}` : `Bookmark at ${time}`)
  const bookmark: AudioBookmark = { id: input.id, label, positionSeconds: position, createdAt: input.nowIso }
  const note = normalizeNoteText(input.note)
  if (note) bookmark.note = note
  if (chapter) {
    bookmark.chapterId = chapter.id
    bookmark.chapterOffsetSeconds = position - chapter.startSeconds
  }
  return bookmark
}

/** Validate an untrusted list (IPC / stored JSON): bad entries are dropped, duplicates by id removed, capped, sorted by position. */
export function sanitizeAudioBookmarks(raw: unknown): AudioBookmark[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: AudioBookmark[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    if (typeof o.id !== 'string' || !o.id.trim() || o.id.length > 100 || seen.has(o.id)) continue
    if (!isFiniteNumber(o.positionSeconds) || o.positionSeconds < 0 || o.positionSeconds > MAX_SECONDS) continue
    const bookmark: AudioBookmark = {
      id: o.id,
      label: typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 200) : `Bookmark at ${formatPlaybackTime(o.positionSeconds)}`,
      positionSeconds: o.positionSeconds,
      createdAt: typeof o.createdAt === 'string' ? o.createdAt.slice(0, 40) : '',
    }
    const note = normalizeNoteText(o.note)
    if (note) bookmark.note = note
    if (typeof o.chapterId === 'string' && o.chapterId && o.chapterId.length <= 100) {
      bookmark.chapterId = o.chapterId
      if (isFiniteNumber(o.chapterOffsetSeconds) && o.chapterOffsetSeconds >= 0 && o.chapterOffsetSeconds <= MAX_SECONDS) {
        bookmark.chapterOffsetSeconds = o.chapterOffsetSeconds
      }
    }
    if (typeof o.trackId === 'string' && o.trackId && o.trackId.length <= 100) bookmark.trackId = o.trackId
    seen.add(o.id)
    out.push(bookmark)
    if (out.length >= MAX_AUDIO_BOOKMARKS) break
  }
  return out.sort((a, b) => a.positionSeconds - b.positionSeconds)
}

/**
 * The canonical position a bookmark resumes at. If the chapter it was made in still exists, it is
 * `chapter start + offset` (kept inside that chapter); otherwise the saved absolute position, kept
 * inside the audio.
 */
export function resolveBookmarkTarget(bookmark: AudioBookmark, chapters: readonly AudioChapter[], duration: unknown): number {
  const chapter = bookmark.chapterId ? chapters.find((c) => c.id === bookmark.chapterId) : undefined
  if (chapter && isFiniteNumber(bookmark.chapterOffsetSeconds)) {
    const target = Math.min(chapter.endSeconds, chapter.startSeconds + bookmark.chapterOffsetSeconds)
    return clampSeekPosition(target, duration)
  }
  return clampSeekPosition(bookmark.positionSeconds, duration)
}

/** Edit the text of one note in place: same id, same position, same list length (never a duplicate). Unknown id → unchanged list. */
export function updateAudioBookmarkNote(list: readonly AudioBookmark[], id: string, note: unknown): AudioBookmark[] {
  const text = normalizeNoteText(note)
  return list.map((b) => {
    if (b.id !== id) return b
    const { note: _old, ...rest } = b
    void _old
    return text ? { ...rest, note: text } : rest
  })
}

/**
 * Where a note's marker sits on a timeline, as a fraction 0…1 — or `null` when it must not be drawn:
 * the duration is unknown / zero, the position is not a finite non-negative number, or it lies outside
 * the shown range (`range` = the current chapter in Chapter scope; default the whole audio). A position
 * a hair past the end (rounding) is clamped onto it; anything further out is invalid.
 */
export function noteMarkerFraction(position: unknown, duration: unknown, range?: { startSeconds: number; endSeconds: number }): number | null {
  const total = knownDuration(duration)
  if (total === null || typeof position !== 'number' || !Number.isFinite(position) || position < 0) return null
  if (position > total + 1) return null
  const pos = Math.min(position, total)
  const start = range ? range.startSeconds : 0
  const end = range ? Math.min(range.endSeconds, total) : total
  if (!(end > start) || pos < start || pos > end) return null
  return (pos - start) / (end - start)
}
