/**
 * Chapters and the Book / Chapter timeline of an audiobook. Pure.
 *
 * ONE canonical position exists: seconds from the start of the audio (`HTMLMediaElement.currentTime`).
 * Everything a scope shows is derived from it and the chapter boundaries — there is no second
 * "chapter position" that could drift. Switching scope therefore changes how the timeline is
 * interpreted, never where the audio is.
 */
import { knownDuration } from './audio-playback.js'

export type ProgressScope = 'book' | 'chapter'
export const PROGRESS_SCOPES: readonly ProgressScope[] = ['book', 'chapter']

export function isProgressScope(value: unknown): value is ProgressScope {
  return value === 'book' || value === 'chapter'
}

/** A validated chapter. `endSeconds` is the exclusive end; chapters are contiguous. */
export interface AudioChapter {
  id: string
  title: string
  startSeconds: number
  endSeconds: number
}

/** What a source (ID3 CHAP, MP4 chapter list…) hands over before validation. */
export interface RawChapter {
  id?: unknown
  title?: unknown
  startSeconds?: unknown
  /** Absent / null for a source that only knows start times: the next chapter's start is used. */
  endSeconds?: unknown
}

export type ChapterStatus =
  /** No chapters were provided (e.g. a single MP3 without chapter tags). */
  | 'none'
  /** Chapters are known but cannot be validated yet: the audio duration is unknown. */
  | 'pending-duration'
  /** A validated list. */
  | 'ok'
  /** A list was provided but is not trustworthy; `reason` says why. Nothing is shown. */
  | 'invalid'

export interface ChapterValidation {
  status: ChapterStatus
  chapters: AudioChapter[]
  reason?: string
}

/** Gaps / overlaps up to this size are snapped to the neighbouring boundary (tag rounding). */
export const CHAPTER_SNAP_SECONDS = 1
export const MAX_CHAPTERS = 2000

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Validate a raw chapter list against the real audio duration. All or nothing: a list with a bad
 * entry is rejected as a whole rather than repaired into something the file never said.
 *
 * Rules: every start / end finite and ≥ 0; start < end; strictly ordered; contiguous within
 * {@link CHAPTER_SNAP_SECONDS} (a gap or overlap bigger than that → invalid); the first chapter
 * begins at ~0; the last ends at ~duration (a missing end means "to the end"); nothing past the
 * duration. Titles are trimmed; an empty title becomes "Chapter N" (a position label, not content).
 */
export function normalizeChapters(raw: unknown, duration: unknown): ChapterValidation {
  if (raw == null || (Array.isArray(raw) && raw.length === 0)) return { status: 'none', chapters: [] }
  if (!Array.isArray(raw)) return invalid('chapter list is not an array')
  if (raw.length > MAX_CHAPTERS) return invalid(`more than ${MAX_CHAPTERS} chapters`)
  const total = knownDuration(duration)
  if (total === null) return { status: 'pending-duration', chapters: [] }

  const items = raw as RawChapter[]
  const starts: number[] = []
  const ends: Array<number | null> = []
  for (const [i, item] of items.entries()) {
    if (!item || typeof item !== 'object') return invalid(`chapter ${i + 1} is not an object`)
    if (!isFiniteNumber(item.startSeconds) || item.startSeconds < 0) return invalid(`chapter ${i + 1} has an invalid start`)
    starts.push(item.startSeconds)
    if (item.endSeconds === undefined || item.endSeconds === null) ends.push(null)
    else if (isFiniteNumber(item.endSeconds) && item.endSeconds >= 0) ends.push(item.endSeconds)
    else return invalid(`chapter ${i + 1} has an invalid end`)
  }

  // Order: strictly increasing starts.
  for (let i = 1; i < starts.length; i++) {
    if ((starts[i] as number) <= (starts[i - 1] as number)) return invalid(`chapter ${i + 1} does not start after chapter ${i}`)
  }
  if ((starts[0] as number) > CHAPTER_SNAP_SECONDS) return invalid('the first chapter does not start at the beginning')
  if ((starts[starts.length - 1] as number) >= total) return invalid('a chapter starts at or after the end of the audio')

  const chapters: AudioChapter[] = []
  const ids = new Set<string>()
  for (const [i, item] of items.entries()) {
    const start = i === 0 ? 0 : (starts[i] as number)
    const nextStart = i + 1 < items.length ? (starts[i + 1] as number) : total
    const declared = ends[i] ?? nextStart
    // The boundary that separates two chapters is the next chapter's start; a declared end must agree with it.
    if (Math.abs(declared - nextStart) > CHAPTER_SNAP_SECONDS) {
      return invalid(declared > nextStart ? `chapter ${i + 1} overlaps chapter ${i + 2}` : `there is a gap after chapter ${i + 1}`)
    }
    const end = Math.min(nextStart, total)
    if (end <= start) return invalid(`chapter ${i + 1} is empty`)
    const rawId = typeof item.id === 'string' && item.id.trim() ? item.id.trim().slice(0, 100) : `ch-${i + 1}`
    const id = ids.has(rawId) ? `${rawId}#${i + 1}` : rawId
    ids.add(id)
    const rawTitle = typeof item.title === 'string' ? item.title.trim().slice(0, 300) : ''
    chapters.push({ id, title: rawTitle || `Chapter ${i + 1}`, startSeconds: start, endSeconds: end })
  }
  if (Math.abs((chapters[chapters.length - 1] as AudioChapter).endSeconds - total) > CHAPTER_SNAP_SECONDS) {
    return invalid('the chapters stop before the end of the audio')
  }
  return { status: 'ok', chapters }
}

function invalid(reason: string): ChapterValidation {
  return { status: 'invalid', chapters: [], reason }
}

/** Index of the chapter containing `position` (`start <= position < end`; the very end → the last); -1 if none. */
export function chapterIndexAt(chapters: readonly AudioChapter[], position: unknown): number {
  if (!isFiniteNumber(position) || chapters.length === 0) return -1
  if (position < 0) return -1
  let lo = 0
  let hi = chapters.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const c = chapters[mid] as AudioChapter
    if (position < c.startSeconds) hi = mid - 1
    else if (position >= c.endSeconds) lo = mid + 1
    else return mid
  }
  const last = chapters[chapters.length - 1] as AudioChapter
  return position === last.endSeconds ? chapters.length - 1 : -1
}

export interface TimelineView {
  /** The scope actually shown (Chapter falls back to Book when no chapter applies). */
  scope: ProgressScope
  /** Absolute start / end of the shown range, seconds from the start of the audio. */
  startSeconds: number
  endSeconds: number
  /** Position inside the range, 0…durationSeconds. */
  positionSeconds: number
  durationSeconds: number
  remainingSeconds: number
  /** 0…1 */
  fraction: number
  chapterIndex: number
  /** Largest position a seek may ask for, inside the range (a chapter's own end would already be the next chapter). */
  maxSeekSeconds: number
}

/** A Chapter-scope seek stops this far before the chapter's end so it stays in the chapter. */
export const CHAPTER_SEEK_MARGIN_SECONDS = 0.1

/**
 * What the timeline shows for `position` under `scope`. Chapter scope needs a chapter that contains
 * the position; otherwise the Book view is returned (the caller can show why Chapter is unavailable).
 * `null` while the duration is unknown.
 */
export function timelineView(
  scope: ProgressScope,
  position: unknown,
  duration: unknown,
  chapters: readonly AudioChapter[],
): TimelineView | null {
  const total = knownDuration(duration)
  if (total === null) return null
  const abs = isFiniteNumber(position) ? Math.min(total, Math.max(0, position)) : 0
  const index = chapterIndexAt(chapters, abs)
  const chapter = index >= 0 ? (chapters[index] as AudioChapter) : null
  if (scope === 'chapter' && chapter) {
    const length = chapter.endSeconds - chapter.startSeconds
    const rel = Math.min(length, Math.max(0, abs - chapter.startSeconds))
    return {
      scope: 'chapter',
      startSeconds: chapter.startSeconds,
      endSeconds: chapter.endSeconds,
      positionSeconds: rel,
      durationSeconds: length,
      remainingSeconds: length - rel,
      fraction: length > 0 ? rel / length : 0,
      chapterIndex: index,
      maxSeekSeconds: index === chapters.length - 1 ? length : Math.max(0, length - CHAPTER_SEEK_MARGIN_SECONDS),
    }
  }
  return {
    scope: 'book',
    startSeconds: 0,
    endSeconds: total,
    positionSeconds: abs,
    durationSeconds: total,
    remainingSeconds: total - abs,
    fraction: abs / total,
    chapterIndex: index,
    maxSeekSeconds: total,
  }
}

/**
 * A position the user asked for on the timeline (`relative` seconds inside the shown range) → the
 * canonical absolute position. In Chapter scope it can never leave the chapter the audio is in now.
 */
export function absoluteFromScoped(view: TimelineView, relative: unknown): number {
  const rel = isFiniteNumber(relative) ? relative : 0
  const clamped = Math.min(view.maxSeekSeconds, Math.max(0, rel))
  return view.startSeconds + clamped
}

/** Previous-chapter target: restart the current chapter when already past `restartAfter` seconds into it. */
export function previousChapterTarget(chapters: readonly AudioChapter[], position: unknown, restartAfter = 3): number | null {
  const i = chapterIndexAt(chapters, position)
  if (i < 0) return null
  const current = chapters[i] as AudioChapter
  if ((position as number) - current.startSeconds > restartAfter || i === 0) return current.startSeconds
  return (chapters[i - 1] as AudioChapter).startSeconds
}

/** Next-chapter target: the following chapter's start; `null` on the last chapter (the button is disabled). */
export function nextChapterTarget(chapters: readonly AudioChapter[], position: unknown): number | null {
  const i = chapterIndexAt(chapters, position)
  if (i < 0 || i >= chapters.length - 1) return null
  return (chapters[i + 1] as AudioChapter).startSeconds
}

/** Where a Chapter-scope seek or chapter jump may land, as a canonical position; unknown id → null. */
export function chapterStart(chapters: readonly AudioChapter[], chapterId: unknown): number | null {
  const found = chapters.find((c) => c.id === chapterId)
  return found ? found.startSeconds : null
}
