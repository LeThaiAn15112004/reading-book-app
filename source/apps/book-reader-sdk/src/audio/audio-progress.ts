import type { ReadingStateJson } from '../persistence/books-json.js'
import { audioProgressPercent, clampPlaybackRate, knownDuration } from './audio-playback.js'
import { isProgressScope, type ProgressScope } from './audio-timeline.js'

/**
 * Listening progress, stored under `reading_state_json.audioProgress`.
 *
 * It is kept apart from `lastReadLocation` on purpose: a time offset is not a CFI / page / text
 * `Location`, and `Location.parse` rejects kinds it does not know. The book file is never touched.
 */
export interface AudioProgress {
  /** `HTMLMediaElement.currentTime`, seconds from the start. */
  positionSeconds: number
  /** Known only once the element has reported a finite duration. */
  durationSeconds?: number
  playbackRate: number
  /** How the timeline is shown (Book / Chapter). Display only — the position above is canonical. */
  scope?: ProgressScope
  /** The chapter the position was in when saved (informational; restore uses the position). */
  chapterId?: string
  /**
   * Multi-chapter audiobooks only: the `book_audio_chapters.id` being played. When present, `positionSeconds` is the
   * position WITHIN that track (not within the whole book); absent = the single-file meaning above.
   */
  trackId?: string
  /** ISO-8601, assigned by Main when the progress is written. */
  updatedAt: string
}

export interface AudioProgressInput {
  positionSeconds: number
  durationSeconds?: number
  playbackRate: number
  scope?: ProgressScope
  /** A string sets it, `null` clears it (the position left the chapters), absent keeps what is stored. */
  chapterId?: string | null
  /** Multi-chapter audiobooks: the track being played; `positionSeconds` is then relative to that track. */
  trackId?: string
}

/** Upper bound for a position / duration we accept (≈ 115 days) — guards against garbage values. */
const MAX_SECONDS = 10_000_000

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Validate an untrusted payload (IPC) into an {@link AudioProgressInput}. */
export function sanitizeAudioProgressInput(raw: unknown): AudioProgressInput | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const position = o.positionSeconds
  if (!isFiniteNumber(position) || position < 0 || position > MAX_SECONDS) return undefined
  const rate = o.playbackRate
  if (!isFiniteNumber(rate)) return undefined
  const out: AudioProgressInput = { positionSeconds: position, playbackRate: clampPlaybackRate(rate) }
  const duration = knownDuration(o.durationSeconds)
  if (duration !== null && duration <= MAX_SECONDS) out.durationSeconds = duration
  if (isProgressScope(o.scope)) out.scope = o.scope
  if (o.chapterId === null) out.chapterId = null
  else if (typeof o.chapterId === 'string' && o.chapterId.trim() && o.chapterId.length <= 100) out.chapterId = o.chapterId
  if (typeof o.trackId === 'string' && o.trackId.trim() && o.trackId.length <= 100) out.trackId = o.trackId
  return out
}

/** Read `audioProgress` out of a stored reading state; anything malformed → `undefined`. */
export function parseAudioProgress(state: ReadingStateJson | null | undefined): AudioProgress | undefined {
  const raw = state?.audioProgress
  if (!raw || typeof raw !== 'object') return undefined
  const { positionSeconds, durationSeconds, playbackRate, updatedAt, scope, chapterId, trackId } = raw as Record<string, unknown>
  if (!isFiniteNumber(positionSeconds) || positionSeconds < 0) return undefined
  const out: AudioProgress = {
    positionSeconds,
    playbackRate: clampPlaybackRate(playbackRate),
    updatedAt: typeof updatedAt === 'string' ? updatedAt : '',
  }
  const duration = knownDuration(durationSeconds)
  if (duration !== null) out.durationSeconds = duration
  if (isProgressScope(scope)) out.scope = scope
  if (typeof chapterId === 'string' && chapterId) out.chapterId = chapterId
  if (typeof trackId === 'string' && trackId) out.trackId = trackId
  return out
}

/**
 * The JSON-merge-patch (`json_patch`) that records progress: it adds / replaces `audioProgress` and
 * `percent` and leaves every other key of the reading state (location, typography, …) alone.
 * The top-level `updatedAt` is deliberately not part of it — that field guards `saveSessionState`.
 */
export function audioProgressPatch(
  input: AudioProgressInput,
  nowIso: string,
): { audioProgress: Record<string, unknown>; percent?: number | null } {
  const audioProgress: Record<string, unknown> = {
    positionSeconds: input.positionSeconds,
    playbackRate: input.playbackRate,
    updatedAt: nowIso,
  }
  if (input.trackId !== undefined) {
    // Multi-chapter audiobook. The position is relative to ONE track, so a book-level `percent`, a total
    // `durationSeconds` or an embedded-chapter id must not exist next to it. A merge-patch keeps every key it
    // does not mention, so omitting them would leave stale values behind: delete them with explicit `null`s,
    // whatever the input carried. No percentage is computed here.
    audioProgress.trackId = input.trackId
    audioProgress.durationSeconds = null
    audioProgress.chapterId = null
    if (input.scope !== undefined) audioProgress.scope = input.scope
    return { audioProgress, percent: null }
  }
  if (input.durationSeconds !== undefined) audioProgress.durationSeconds = input.durationSeconds
  if (input.scope !== undefined) audioProgress.scope = input.scope
  // `null` is a merge-patch delete: the position is no longer inside any chapter.
  if (input.chapterId !== undefined) audioProgress.chapterId = input.chapterId
  const percent = audioProgressPercent(input.positionSeconds, input.durationSeconds)
  return percent === undefined ? { audioProgress } : { audioProgress, percent }
}
