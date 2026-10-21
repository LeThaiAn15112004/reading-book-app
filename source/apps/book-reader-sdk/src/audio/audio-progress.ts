import type { ReadingStateJson } from '../persistence/books-json.js'
import { audioProgressPercent, clampPlaybackRate, knownDuration } from './audio-playback.js'

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
  /** ISO-8601, assigned by Main when the progress is written. */
  updatedAt: string
}

export interface AudioProgressInput {
  positionSeconds: number
  durationSeconds?: number
  playbackRate: number
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
  return out
}

/** Read `audioProgress` out of a stored reading state; anything malformed → `undefined`. */
export function parseAudioProgress(state: ReadingStateJson | null | undefined): AudioProgress | undefined {
  const raw = state?.audioProgress
  if (!raw || typeof raw !== 'object') return undefined
  const { positionSeconds, durationSeconds, playbackRate, updatedAt } = raw as Record<string, unknown>
  if (!isFiniteNumber(positionSeconds) || positionSeconds < 0) return undefined
  const out: AudioProgress = {
    positionSeconds,
    playbackRate: clampPlaybackRate(playbackRate),
    updatedAt: typeof updatedAt === 'string' ? updatedAt : '',
  }
  const duration = knownDuration(durationSeconds)
  if (duration !== null) out.durationSeconds = duration
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
): { audioProgress: AudioProgress; percent?: number } {
  const audioProgress: AudioProgress = {
    positionSeconds: input.positionSeconds,
    playbackRate: input.playbackRate,
    updatedAt: nowIso,
  }
  if (input.durationSeconds !== undefined) audioProgress.durationSeconds = input.durationSeconds
  const percent = audioProgressPercent(input.positionSeconds, input.durationSeconds)
  return percent === undefined ? { audioProgress } : { audioProgress, percent }
}
