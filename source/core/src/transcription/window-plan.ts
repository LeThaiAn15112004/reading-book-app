import { isValidTimeRange, type TimeRange } from './transcript-model.js'

/** Whisper's native context is 30 s; consecutive windows share 2 s so words are not cut (research R3). */
export const TRANSCRIPTION_WINDOW_MS = 30_000
export const TRANSCRIPTION_WINDOW_OVERLAP_MS = 2_000

export interface DecodeWindow {
  startMs: number
  lengthMs: number
}

export interface WindowPlanOptions {
  windowMs?: number
  overlapMs?: number
}

/**
 * Split `range` into decode windows of `windowMs` that overlap by `overlapMs`. The first window starts
 * at `range[0]`, the last one ends exactly at `range[1]` and is never longer than what is left; a range
 * shorter than a window gives one window of its own length. An unusable range gives no windows.
 */
export function planWindows(range: TimeRange, options: WindowPlanOptions = {}): DecodeWindow[] {
  const windowMs = options.windowMs ?? TRANSCRIPTION_WINDOW_MS
  const overlapMs = options.overlapMs ?? TRANSCRIPTION_WINDOW_OVERLAP_MS
  if (!Number.isFinite(windowMs) || !Number.isFinite(overlapMs) || windowMs <= 0 || overlapMs < 0 || overlapMs >= windowMs) {
    throw new RangeError('windowMs must be > 0 and overlapMs must be >= 0 and < windowMs')
  }
  const [start, end] = range
  if (!isValidTimeRange(start, end)) return []

  const step = windowMs - overlapMs
  const windows: DecodeWindow[] = []
  let cursor = start
  for (;;) {
    const lengthMs = Math.min(windowMs, end - cursor)
    windows.push({ startMs: cursor, lengthMs })
    if (cursor + lengthMs >= end) break
    cursor += step
  }
  return windows
}
