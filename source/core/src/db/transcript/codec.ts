/**
 * Audiobook transcript rows ⇄ domain (migration 029/030), shared pure helpers of Desktop's `SqliteTranscriptStore`
 * (spec 009 T036). Desktop only. No driver, no I/O.
 */
import { totalRangeMs } from '../../transcription/range-merge.js'
import {
  isTranscriptStatus,
  isTranscriptionErrorCode,
  isValidTimeRange,
  parseCoveredRanges,
  type CoveredRanges,
  type TranscriptPassage,
  type TranscriptStatus,
  type TranscriptionErrorCode,
  type TranscriptionScope,
} from '../../transcription/transcript-model.js'

export const DEFAULT_PASSAGE_LIMIT = 500
export const MAX_PASSAGE_LIMIT = 2000
export const DEFAULT_SEARCH_LIMIT = 100
export const MAX_SEARCH_LIMIT = 200

export type TranscriptJobState = 'queued' | 'running'

export interface StoredPassage extends TranscriptPassage {
  id: number
}

export interface TranscriptRecord {
  id: string
  bookId: string
  language: string
  modelId: string
  status: TranscriptStatus
  jobState: TranscriptJobState | null
  lastError: TranscriptionErrorCode | null
  /** What the last job was asked to transcribe; `null` when unknown (older transcripts). Resume starts it again. */
  scope: TranscriptionScope | null
  covered: CoveredRanges
  /** Sum over all tracks of the merged covered intervals. */
  coveredMs: number
  passageCount: number
  createdAt: string
  updatedAt: string
}

export interface TranscriptSearchHit {
  passageId: number
  trackId?: string
  startMs: number
  snippet: string
}

export interface TranscriptRow {
  id: string
  book_id: string
  language: string
  model_id: string
  status: string
  job_state: string | null
  last_error: string | null
  scope_json: string | null
  covered_json: string
  created_at: string
  updated_at: string
  passage_count: number
}

export interface PassageRow {
  id: number
  track_id: string | null
  start_ms: number
  end_ms: number
  text: string
}

export interface SearchRow {
  id: number
  track_id: string | null
  start_ms: number
  snippet: string
}

export function passageFromRow(row: PassageRow): StoredPassage {
  const passage: StoredPassage = { id: row.id, startMs: row.start_ms, endMs: row.end_ms, text: row.text }
  if (row.track_id) passage.trackId = row.track_id
  return passage
}

export function searchHitFromRow(row: SearchRow): TranscriptSearchHit {
  const hit: TranscriptSearchHit = { passageId: row.id, startMs: row.start_ms, snippet: row.snippet }
  if (row.track_id) hit.trackId = row.track_id
  return hit
}

export function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(1, Math.floor(value)))
}

/** A stored `scope_json` read defensively: anything that is not a valid scope is `null` (Resume then uses the whole book). */
export function parseScope(json: string | null): TranscriptionScope | null {
  if (!json) return null
  try {
    const raw = JSON.parse(json) as Record<string, unknown> | null
    if (!raw || typeof raw !== 'object') return null
    if (raw.kind === 'whole') return { kind: 'whole' }
    if (raw.kind === 'track') return typeof raw.trackId === 'string' && raw.trackId ? { kind: 'track', trackId: raw.trackId } : null
    if (raw.kind === 'range') {
      const { startMs, endMs, trackId } = raw
      if (typeof startMs !== 'number' || typeof endMs !== 'number' || !isValidTimeRange(startMs, endMs)) return null
      if (trackId === undefined) return { kind: 'range', startMs, endMs }
      return typeof trackId === 'string' && trackId ? { kind: 'range', trackId, startMs, endMs } : null
    }
    return null
  } catch {
    return null
  }
}

export function parseCovered(json: string): CoveredRanges {
  try {
    return parseCoveredRanges(JSON.parse(json))
  } catch {
    return {}
  }
}

export function transcriptFromRow(row: TranscriptRow): TranscriptRecord {
  const covered = parseCovered(row.covered_json)
  return {
    id: row.id,
    bookId: row.book_id,
    language: row.language,
    modelId: row.model_id,
    status: isTranscriptStatus(row.status) ? row.status : 'failed',
    jobState: row.job_state === 'queued' || row.job_state === 'running' ? row.job_state : null,
    lastError: isTranscriptionErrorCode(row.last_error) ? row.last_error : null,
    scope: parseScope(row.scope_json),
    covered,
    coveredMs: Object.values(covered).reduce((sum, ranges) => sum + totalRangeMs(ranges), 0),
    passageCount: row.passage_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * FTS5 MATCH expression from free user text: every word becomes a quoted phrase (so operators such as
 * `AND`, `NEAR`, `-`, `:` are plain text), all words must match, and the last word is a prefix match
 * (search-as-you-type). Empty input → null.
 */
export function buildFtsQuery(input: string): string | null {
  const words = input
    .replace(/"/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0)
  if (words.length === 0) return null
  return words.map((word, index) => (index === words.length - 1 ? `"${word}"*` : `"${word}"`)).join(' ')
}
