import { MAIN_TRACK_KEY, trackKey, type TranscriptPassage } from './transcript-model.js'

/**
 * Which passage is being spoken at a playback position (spec 004, US2). Pure and platform-agnostic: the renderer feeds it the
 * player's current track and second, the transcript panel highlights the result.
 */

/** Where the listener is: a track (absent for a single-file audiobook) and milliseconds inside it. */
export interface PlaybackPoint {
  trackId?: string | null
  ms: number
}

/** Position of a track key in playback order; -1 when it is not part of the audiobook. */
function rankOf(key: string, trackOrder: readonly string[]): number {
  return trackOrder.indexOf(key)
}

/**
 * Index of the active passage, or -1.
 *
 * `passages` must be in reading order: by track (the order of `trackOrder`, i.e. `book_audio_chapters.position`), then by
 * `startMs`. The result is the last passage of the SAME track that starts at or before `ms` (binary search, O(log n)):
 *  - inside a passage → that passage;
 *  - in a gap between two passages, or after the last one → the nearest previous passage (the highlight stays put while
 *    nobody speaks, it does not flicker off);
 *  - before the first passage of the track, in a track without passages, or in a track that is not part of the book → -1.
 *
 * `trackOrder` lists the track keys in playback order; a single-file audiobook uses the default (`['main']`).
 */
export function findActivePassageIndex(
  passages: readonly TranscriptPassage[],
  point: PlaybackPoint,
  trackOrder: readonly string[] = [MAIN_TRACK_KEY],
): number {
  if (!Number.isFinite(point.ms) || passages.length === 0) return -1
  const targetKey = trackKey(point.trackId)
  const targetRank = rankOf(targetKey, trackOrder)
  if (targetRank < 0) return -1

  // upper bound: first passage that sorts AFTER (targetRank, ms)
  let low = 0
  let high = passages.length
  while (low < high) {
    const mid = (low + high) >>> 1
    const passage = passages[mid] as TranscriptPassage
    const rank = rankOf(trackKey(passage.trackId), trackOrder)
    const after = rank > targetRank || (rank === targetRank && passage.startMs > point.ms)
    if (after) high = mid
    else low = mid + 1
  }
  const candidate = low - 1
  if (candidate < 0) return -1
  return trackKey((passages[candidate] as TranscriptPassage).trackId) === targetKey ? candidate : -1
}

/** The active passage itself (see `findActivePassageIndex`), or `null`. */
export function findActivePassage(
  passages: readonly TranscriptPassage[],
  point: PlaybackPoint,
  trackOrder: readonly string[] = [MAIN_TRACK_KEY],
): TranscriptPassage | null {
  const index = findActivePassageIndex(passages, point, trackOrder)
  return index < 0 ? null : (passages[index] as TranscriptPassage)
}
