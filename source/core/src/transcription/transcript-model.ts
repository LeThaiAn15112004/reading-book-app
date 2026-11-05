/**
 * Audiobook transcription — platform-agnostic model (spec `004-audiobook-transcription`).
 *
 * All times are milliseconds from the start of the passage's own audio file: a single-file audiobook
 * has one implicit file (`MAIN_TRACK_KEY`), a multi-track one uses the chapter file (`trackId`). Pure
 * types and validators — Main owns storage and the speech engine.
 */

export const TRANSCRIPT_STATUSES = ['partial', 'complete', 'failed', 'cancelled'] as const
export type TranscriptStatus = (typeof TRANSCRIPT_STATUSES)[number]

export const TRANSCRIPTION_ERROR_CODES = [
  'MODEL_MISSING',
  'DISK_FULL',
  'FILE_MISSING',
  'UNSUPPORTED_LANGUAGE',
  'NO_SPEECH',
  'DECODE_FAILED',
  'INVALID_ARGUMENT',
  'ABORTED',
  'INTERRUPTED',
  'INTEGRITY_FAILED',
  /**
   * `features.audiobookTranscriptionEnabled` is off (it stays off until the own-build FFmpeg decoder is integrated and
   * verified). Only ever the answer to a refused `start` / `downloadModel`: it is never stored on a transcript, so the
   * `audio_transcripts.last_error` CHECK (migration 029) deliberately does not list it.
   */
  'FEATURE_DISABLED',
] as const
export type TranscriptionErrorCode = (typeof TRANSCRIPTION_ERROR_CODES)[number]

/** Key of a single-file audiobook in `CoveredRanges` (it has no track id). */
export const MAIN_TRACK_KEY = 'main'

/** Half-open interval `[startMs, endMs)`. */
export type TimeRange = readonly [startMs: number, endMs: number]

/** Covered (already transcribed) intervals per track key: merged and sorted. */
export type CoveredRanges = Record<string, TimeRange[]>

export interface TranscriptPassage {
  startMs: number
  endMs: number
  /** Trimmed, never empty. */
  text: string
  /** Chapter id of a multi-track audiobook; absent for a single-file one. */
  trackId?: string
}

export type TranscriptionScope =
  | { kind: 'whole' }
  | { kind: 'track'; trackId: string }
  | { kind: 'range'; trackId?: string; startMs: number; endMs: number }

export function trackKey(trackId: string | null | undefined): string {
  return trackId ? trackId : MAIN_TRACK_KEY
}

export function isTranscriptStatus(value: unknown): value is TranscriptStatus {
  return typeof value === 'string' && (TRANSCRIPT_STATUSES as readonly string[]).includes(value)
}

export function isTranscriptionErrorCode(value: unknown): value is TranscriptionErrorCode {
  return typeof value === 'string' && (TRANSCRIPTION_ERROR_CODES as readonly string[]).includes(value)
}

/** A usable interval: finite, `0 <= start < end`. */
export function isValidTimeRange(startMs: number, endMs: number): boolean {
  return Number.isFinite(startMs) && Number.isFinite(endMs) && startMs >= 0 && startMs < endMs
}

/** Trim and collapse runs of whitespace; the form in which passage text is stored. */
export function normalisePassageText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Data-model rule: `0 <= start < end`, non-empty trimmed text. */
export function isValidPassage(passage: TranscriptPassage): boolean {
  return (
    isValidTimeRange(passage.startMs, passage.endMs) &&
    passage.text.length > 0 &&
    passage.text === passage.text.trim()
  )
}

/**
 * Read a stored `covered_json` defensively: anything malformed is dropped, intervals are returned
 * sorted but NOT merged here (use `mergeRanges`).
 */
export function parseCoveredRanges(raw: unknown): CoveredRanges {
  const out: CoveredRanges = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue
    const ranges: TimeRange[] = []
    for (const item of value) {
      if (!Array.isArray(item) || item.length !== 2) continue
      const [start, end] = item as unknown[]
      if (typeof start === 'number' && typeof end === 'number' && isValidTimeRange(start, end)) {
        ranges.push([start, end])
      }
    }
    if (ranges.length > 0) out[key] = ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  }
  return out
}
