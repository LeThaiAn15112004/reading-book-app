/**
 * SQL of the audiobook transcript store (migration 029/030) as `Statement` builders with positional `?` (spec 009 T036).
 * Desktop only. Playback order is the existing `book_audio_chapters.position`, joined at read time. No driver, no I/O.
 */
import type { TranscriptStatus, TranscriptionErrorCode, TranscriptionScope } from '../../transcription/transcript-model.js'
import type { SqlValue, Statement } from '../driver.js'
import {
  DEFAULT_PASSAGE_LIMIT,
  DEFAULT_SEARCH_LIMIT,
  MAX_PASSAGE_LIMIT,
  MAX_SEARCH_LIMIT,
  clampLimit,
  type TranscriptJobState,
} from './codec.js'

const s = (sql: string, ...params: SqlValue[]): Statement => ({ sql, params })

/** Playback order: chapter `position` (single-file → 0), then time. `c` is the LEFT JOINed chapter. */
const PLAYBACK_ORDER = 'COALESCE(c.position, 0), p.start_ms, p.id'

export const selectTranscriptWithCount = (bookId: string) =>
  s(
    `SELECT t.*, (SELECT count(*) FROM audio_transcript_passages p WHERE p.transcript_id = t.id) AS passage_count
       FROM audio_transcripts t WHERE t.book_id = ?`,
    bookId,
  )

export const selectBookExists = (bookId: string) => s('SELECT 1 FROM books WHERE id = ?', bookId)
export const updateTranscriptModel = (bookId: string, language: string, modelId: string, now: string) =>
  s('UPDATE audio_transcripts SET language = ?, model_id = ?, updated_at = ? WHERE book_id = ?', language, modelId, now, bookId)
export const insertTranscript = (id: string, bookId: string, language: string, modelId: string, now: string) =>
  s(
    `INSERT INTO audio_transcripts (id, book_id, language, model_id, status, covered_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'partial', '{}', ?, ?)`,
    id,
    bookId,
    language,
    modelId,
    now,
    now,
  )

export const selectTranscriptCovered = (bookId: string) => s('SELECT id, covered_json FROM audio_transcripts WHERE book_id = ?', bookId)
export const selectTranscriptId = (bookId: string) => s('SELECT id FROM audio_transcripts WHERE book_id = ?', bookId)

/** Passages of one track (or of the single-file book when `trackId` is undefined) that overlap `[startMs, endMs)`. */
export const selectOverlappingPassages = (transcriptId: string, trackId: string | undefined, startMs: number, endMs: number) =>
  s(
    `SELECT p.id, p.track_id, p.start_ms, p.end_ms, p.text FROM audio_transcript_passages p
      WHERE p.transcript_id = ? AND ${trackId ? 'p.track_id = ?' : 'p.track_id IS NULL'} AND p.start_ms < ? AND p.end_ms > ?`,
    ...(trackId ? [transcriptId, trackId, endMs, startMs] : [transcriptId, endMs, startMs]),
  )
export const deletePassage = (id: number) => s('DELETE FROM audio_transcript_passages WHERE id = ?', id)
export const insertPassage = (transcriptId: string, trackId: string | null, startMs: number, endMs: number, text: string) =>
  s(
    'INSERT INTO audio_transcript_passages (transcript_id, track_id, start_ms, end_ms, text) VALUES (?, ?, ?, ?, ?)',
    transcriptId,
    trackId,
    startMs,
    endMs,
    text,
  )
export const updateCovered = (transcriptId: string, coveredJson: string, now: string) =>
  s('UPDATE audio_transcripts SET covered_json = ?, updated_at = ? WHERE id = ?', coveredJson, now, transcriptId)

export function selectPassages(
  bookId: string,
  options: { trackId?: string; fromMs?: number; toMs?: number; limit?: number; offset?: number } = {},
): Statement {
  const where: string[] = ['t.book_id = ?']
  const params: SqlValue[] = [bookId]
  if (options.trackId) {
    where.push('p.track_id = ?')
    params.push(options.trackId)
  }
  if (options.fromMs !== undefined && Number.isFinite(options.fromMs)) {
    where.push('p.end_ms > ?')
    params.push(options.fromMs)
  }
  if (options.toMs !== undefined && Number.isFinite(options.toMs)) {
    where.push('p.start_ms < ?')
    params.push(options.toMs)
  }
  params.push(clampLimit(options.limit, DEFAULT_PASSAGE_LIMIT, MAX_PASSAGE_LIMIT))
  // Paging for long transcripts: skip the passages already read (playback order is stable, so pages never overlap).
  params.push(options.offset !== undefined && Number.isFinite(options.offset) ? Math.max(0, Math.floor(options.offset)) : 0)
  return {
    sql: `SELECT p.id, p.track_id, p.start_ms, p.end_ms, p.text
            FROM audio_transcript_passages p
            JOIN audio_transcripts t ON t.id = p.transcript_id
            LEFT JOIN book_audio_chapters c ON c.id = p.track_id
           WHERE ${where.join(' AND ')}
           ORDER BY ${PLAYBACK_ORDER}
           LIMIT ? OFFSET ?`,
    params,
  }
}

/** `match` comes from `buildFtsQuery`. */
export const searchPassages = (match: string, bookId: string, limit?: number) =>
  s(
    `SELECT p.id, p.track_id, p.start_ms,
            snippet(audio_transcript_fts, 0, '', '', '…', 16) AS snippet
       FROM audio_transcript_fts
       JOIN audio_transcript_passages p ON p.id = audio_transcript_fts.rowid
       JOIN audio_transcripts t ON t.id = p.transcript_id
       LEFT JOIN book_audio_chapters c ON c.id = p.track_id
      WHERE audio_transcript_fts MATCH ? AND t.book_id = ?
      ORDER BY ${PLAYBACK_ORDER}
      LIMIT ?`,
    match,
    bookId,
    clampLimit(limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT),
  )

/** `lastError`: a code sets it, null clears it, undefined leaves it alone. */
export function updateJobState(
  bookId: string,
  jobState: TranscriptJobState | null,
  now: string,
  lastError?: TranscriptionErrorCode | null,
): Statement {
  const sets = ['job_state = ?', 'updated_at = ?']
  const params: SqlValue[] = [jobState, now]
  if (lastError !== undefined) {
    sets.push('last_error = ?')
    params.push(lastError)
  }
  params.push(bookId)
  return { sql: `UPDATE audio_transcripts SET ${sets.join(', ')} WHERE book_id = ?`, params }
}

export function updateStatus(bookId: string, status: TranscriptStatus, now: string, lastError?: TranscriptionErrorCode | null): Statement {
  const sets = ['status = ?', 'updated_at = ?']
  const params: SqlValue[] = [status, now]
  if (lastError !== undefined) {
    sets.push('last_error = ?')
    params.push(lastError)
  }
  params.push(bookId)
  return { sql: `UPDATE audio_transcripts SET ${sets.join(', ')} WHERE book_id = ?`, params }
}

export const updateScope = (bookId: string, scope: TranscriptionScope | null, now: string) =>
  s('UPDATE audio_transcripts SET scope_json = ?, updated_at = ? WHERE book_id = ?', scope ? JSON.stringify(scope) : null, now, bookId)

/** A job ended: clear `job_state` and set the outcome in one statement. */
export const endJob = (bookId: string, status: TranscriptStatus, lastError: TranscriptionErrorCode | null, now: string) =>
  s('UPDATE audio_transcripts SET job_state = NULL, status = ?, last_error = ?, updated_at = ? WHERE book_id = ?', status, lastError, now, bookId)

export const deletePassagesOfTranscript = (transcriptId: string) =>
  s('DELETE FROM audio_transcript_passages WHERE transcript_id = ?', transcriptId)
/** "Replace": forget the coverage, keep the row (status `partial`, no error). */
export const resetTranscript = (transcriptId: string, now: string) =>
  s(`UPDATE audio_transcripts SET covered_json = '{}', status = 'partial', last_error = NULL, updated_at = ? WHERE id = ?`, now, transcriptId)
export const deleteTranscriptOfBook = (bookId: string) => s('DELETE FROM audio_transcripts WHERE book_id = ?', bookId)

/** Startup recovery of transcripts whose job died with the previous process (never `complete`, never deletes text). */
export const recoverInterrupted = (now: string) =>
  s(
    `UPDATE audio_transcripts
        SET job_state = NULL,
            last_error = 'INTERRUPTED',
            status = CASE
              WHEN covered_json <> '{}' OR EXISTS (SELECT 1 FROM audio_transcript_passages p WHERE p.transcript_id = audio_transcripts.id)
              THEN 'partial' ELSE 'failed' END,
            updated_at = ?
      WHERE job_state IS NOT NULL`,
    now,
  )
