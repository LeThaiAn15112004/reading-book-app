/**
 * Spec 018 (FR-015, FR-028, FR-029; data-model "Listening preferences" / "Resume rewind"): the listener's audiobook
 * preferences — skip lengths, rewind on resume, mute — and the resume-rewind rule. Pure; the renderer stores them.
 */

export const SKIP_LENGTHS = [5, 10, 15, 30, 60] as const
export type SkipLength = (typeof SKIP_LENGTHS)[number]

export type ListeningPrefs = {
  skipBackSeconds: SkipLength
  skipForwardSeconds: SkipLength
  /** Rewind a little when playback resumes after a pause (FR-029). */
  autoRewind: boolean
  muted: boolean
  /** Level restored when unmuting, 0–1. */
  volumeBeforeMute: number
}

export const DEFAULT_LISTENING_PREFS: Readonly<ListeningPrefs> = Object.freeze({
  skipBackSeconds: 15,
  skipForwardSeconds: 30,
  autoRewind: true,
  muted: false,
  volumeBeforeMute: 1,
})

export const LISTENING_PREFS_STORAGE_KEY = 'readmate.audioListeningPrefs.v1'

export function isSkipLength(value: unknown): value is SkipLength {
  return typeof value === 'number' && (SKIP_LENGTHS as readonly number[]).includes(value)
}

/** Stored / patched prefs → valid prefs; any other value of a field → its default. */
export function normalizeListeningPrefs(raw: unknown): ListeningPrefs {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const volume = o.volumeBeforeMute
  return {
    skipBackSeconds: isSkipLength(o.skipBackSeconds) ? o.skipBackSeconds : DEFAULT_LISTENING_PREFS.skipBackSeconds,
    skipForwardSeconds: isSkipLength(o.skipForwardSeconds) ? o.skipForwardSeconds : DEFAULT_LISTENING_PREFS.skipForwardSeconds,
    autoRewind: typeof o.autoRewind === 'boolean' ? o.autoRewind : DEFAULT_LISTENING_PREFS.autoRewind,
    muted: typeof o.muted === 'boolean' ? o.muted : DEFAULT_LISTENING_PREFS.muted,
    volumeBeforeMute:
      typeof volume === 'number' && Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_LISTENING_PREFS.volumeBeforeMute,
  }
}

const MINUTE_MS = 60_000

/** FR-029: how far to go back on resume after a pause of `pausedForMs`. */
export function resumeRewindSeconds(pausedForMs: number): number {
  if (!Number.isFinite(pausedForMs) || pausedForMs < MINUTE_MS) return 0
  if (pausedForMs < 10 * MINUTE_MS) return 3
  if (pausedForMs < 60 * MINUTE_MS) return 5
  return 10
}

/**
 * The position to resume at: `position` minus the rewind, never before `floorSeconds` (the start of the current
 * chapter, or of the track / file) — and never past `position` itself.
 */
export function applyResumeRewind(position: number, pausedForMs: number, floorSeconds: number): number {
  const rewind = resumeRewindSeconds(pausedForMs)
  if (rewind === 0) return position
  const floor = Math.min(Math.max(0, floorSeconds), position)
  return Math.max(floor, position - rewind)
}
