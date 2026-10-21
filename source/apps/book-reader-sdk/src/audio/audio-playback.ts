/** Pure helpers behind the audiobook player (no DOM: the `<audio>` element lives in the renderer). */

export const PLAYBACK_RATES: readonly number[] = [0.75, 1, 1.25, 1.5, 2]
export const MIN_PLAYBACK_RATE = 0.25
export const MAX_PLAYBACK_RATE = 4
/** A position this close to the end counts as "finished": reopening starts over. */
export const RESTART_NEAR_END_SECONDS = 2
/** While playing, progress is written at most this often. */
export const PROGRESS_SAVE_INTERVAL_MS = 5000
/** …and only when the position moved by at least this much. */
export const PROGRESS_MIN_DELTA_SECONDS = 1

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function clampPlaybackRate(rate: unknown): number {
  if (!isFiniteNumber(rate)) return 1
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, rate))
}

/** A finite, positive duration, or `null` (the element reports NaN / Infinity until it knows). */
export function knownDuration(duration: unknown): number | null {
  return isFiniteNumber(duration) && duration > 0 ? duration : null
}

/** Clamp a requested position into `[0, duration]` (just `>= 0` while the duration is unknown). */
export function clampSeekPosition(target: unknown, duration: unknown): number {
  if (!isFiniteNumber(target) || target < 0) return 0
  const max = knownDuration(duration)
  return max !== null && target > max ? max : target
}

/** `m:ss`, or `h:mm:ss` from one hour; `--:--` for anything that is not a finite time. */
export function formatPlaybackTime(seconds: unknown): string {
  if (!isFiniteNumber(seconds) || seconds < 0) return '--:--'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Whole-number progress 0–100, or `undefined` while the duration is unknown. */
export function audioProgressPercent(position: unknown, duration: unknown): number | undefined {
  const max = knownDuration(duration)
  if (max === null || !isFiniteNumber(position)) return undefined
  return Math.min(100, Math.max(0, Math.round((position / max) * 100)))
}

/** Where to resume: the saved position, unless there is none, it is stale, or the book was finished. */
export function resolveRestorePosition(saved: unknown, duration: unknown): number {
  if (!isFiniteNumber(saved) || saved <= 0) return 0
  const max = knownDuration(duration)
  if (max === null) return saved
  if (saved >= max - RESTART_NEAR_END_SECONDS) return 0
  return saved
}

export function shouldPersistProgress(input: {
  force: boolean
  position: number
  lastSavedPosition: number | null
  nowMs: number
  lastSavedAtMs: number | null
}): boolean {
  if (!isFiniteNumber(input.position) || input.position < 0) return false
  if (input.force) return true
  if (input.lastSavedPosition === null || input.lastSavedAtMs === null) return true
  if (Math.abs(input.position - input.lastSavedPosition) < PROGRESS_MIN_DELTA_SECONDS) return false
  return input.nowMs - input.lastSavedAtMs >= PROGRESS_SAVE_INTERVAL_MS
}
