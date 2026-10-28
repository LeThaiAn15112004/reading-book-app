import { formatPlaybackTime, knownDuration } from './audio-playback.js'

/**
 * Multi-track audiobooks (the chapters picked from a ZIP): the platform-free decisions of the player
 * (docs/implementation_plan/audiobook_multi_track_playback_b.md). The player plays ONE track at a time; every position
 * here is seconds WITHIN a track, and no function needs the other tracks' durations.
 */
export interface AudioTrack {
  /** `book_audio_chapters.id` — the `trackId` stored in the listening progress. */
  id: string
  /** Tag title, or the file stem when the file has no title tag. */
  title: string
  /** `null` when it could not be determined; never a reason to hide or refuse the track. */
  durationSeconds: number | null
}

/** Past this many seconds into a track, "previous" restarts the track instead of leaving it. */
export const TRACK_RESTART_THRESHOLD_SECONDS = 3

export interface InitialTrack {
  /** `-1` only when there are no tracks (a single-file book). */
  index: number
  /** Where to start inside that track, as saved. The player still passes it through `resolveRestorePosition`. */
  startSeconds: number
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Where to resume. A saved `trackId` that is one of `tracks` gives that track and the saved position. A missing,
 * non-string or unknown `trackId` gives track 0 at 0 — and the saved position is DISCARDED: a track-relative
 * position is meaningless without its track and must never be applied to a different one.
 */
export function resolveInitialTrack(
  tracks: readonly AudioTrack[],
  progress: { trackId?: unknown; positionSeconds?: unknown } | null | undefined,
): InitialTrack {
  if (tracks.length === 0) return { index: -1, startSeconds: 0 }
  const trackId = progress?.trackId
  if (typeof trackId === 'string' && trackId) {
    const index = tracks.findIndex((t) => t.id === trackId)
    if (index >= 0) {
      const saved = progress?.positionSeconds
      return { index, startSeconds: isFiniteNumber(saved) && saved > 0 ? saved : 0 }
    }
  }
  return { index: 0, startSeconds: 0 }
}

/** "Previous": restart the current track when more than 3 s in, or when it is the first; otherwise go back one track. */
export function previousTrackAction(index: number, positionSeconds: number): 'restart' | 'previous' {
  if (index <= 0) return 'restart'
  return isFiniteNumber(positionSeconds) && positionSeconds > TRACK_RESTART_THRESHOLD_SECONDS ? 'restart' : 'previous'
}

/** The next track's index, or `null` after the last one (or for an invalid index). */
export function nextTrackIndex(index: number, count: number): number | null {
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 0 || index >= count) return null
  return index + 1 < count ? index + 1 : null
}

/** "Track 3 of 68", or `null` when the index does not name a track. */
export function trackEyebrow(index: number, count: number): string | null {
  if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1 || index < 0 || index >= count) return null
  return `Track ${index + 1} of ${count}`
}

/** `m:ss` / `h:mm:ss`, or an em dash while the duration is unknown. */
export function trackDurationLabel(durationSeconds: unknown): string {
  const d = knownDuration(durationSeconds)
  return d === null ? '—' : formatPlaybackTime(d)
}

/** `01`, `02`, … `68` for the row number of a track (position + 1, at least two digits). */
export function trackNumberLabel(index: number): string {
  return String(Math.max(0, Math.trunc(index)) + 1).padStart(2, '0')
}
