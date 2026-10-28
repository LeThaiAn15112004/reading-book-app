import type { Database as SqliteDatabase } from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import {
  dropSupersededPassages,
  isTranscriptStatus,
  isTranscriptionErrorCode,
  isValidPassage,
  isValidTimeRange,
  mergeRanges,
  parseCoveredRanges,
  totalRangeMs,
  trackKey,
  type CoveredRanges,
  type TranscriptPassage,
  type TranscriptStatus,
  type TranscriptionErrorCode,
  type TranscriptionScope,
} from '@reading-book/book-reader-sdk'
import { getDatabase } from './db'

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

export interface CommitWindowResult {
  inserted: number
  /** Earlier passages of the overlap that the new window superseded and removed. */
  superseded: number
}

interface TranscriptRow {
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

interface PassageRow {
  id: number
  track_id: string | null
  start_ms: number
  end_ms: number
  text: string
}

/** Playback order: chapter `position` (single-file → 0), then time. `c` is the LEFT JOINed chapter. */
const PLAYBACK_ORDER = 'COALESCE(c.position, 0), p.start_ms, p.id'

function toPassage(row: PassageRow): StoredPassage {
  const passage: StoredPassage = { id: row.id, startMs: row.start_ms, endMs: row.end_ms, text: row.text }
  if (row.track_id) passage.trackId = row.track_id
  return passage
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
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

function parseCovered(json: string): CoveredRanges {
  try {
    return parseCoveredRanges(JSON.parse(json))
  } catch {
    return {}
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

/**
 * Audiobook transcripts (migration 029). Overlay data only — nothing here reads or writes the audio file
 * or `books`. A window's passages and its covered interval are committed in ONE transaction, so a crash
 * or cancel never leaves text that the coverage does not know about (or the other way round).
 *
 * Playback order is the existing `book_audio_chapters.position`, joined at read time; there is no
 * ordering column of its own.
 */
export class SqliteTranscriptStore {
  constructor(private readonly db: SqliteDatabase = getDatabase()) {}

  /** The transcript of a book, or null. */
  get(bookId: string): TranscriptRecord | null {
    const row = this.db
      .prepare(
        `SELECT t.*, (SELECT count(*) FROM audio_transcript_passages p WHERE p.transcript_id = t.id) AS passage_count
           FROM audio_transcripts t WHERE t.book_id = ?`,
      )
      .get(bookId) as TranscriptRow | undefined
    if (!row) return null
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
   * The book's transcript row, created (status `partial`, nothing covered) when it does not exist yet.
   * An existing transcript keeps its text and coverage; language/model are updated to the ones the new
   * job uses. Returns null when the book does not exist.
   */
  ensure(bookId: string, options: { language: string; modelId: string }): TranscriptRecord | null {
    const language = options.language.trim()
    const modelId = options.modelId.trim()
    if (!bookId || !language || !modelId) return null
    const now = new Date().toISOString()
    const write = this.db.transaction((): boolean => {
      const exists = this.db.prepare('SELECT 1 FROM books WHERE id = ?').get(bookId)
      if (!exists) return false
      const updated = this.db
        .prepare('UPDATE audio_transcripts SET language = ?, model_id = ?, updated_at = ? WHERE book_id = ?')
        .run(language, modelId, now, bookId)
      if (updated.changes === 0) {
        this.db
          .prepare(
            `INSERT INTO audio_transcripts (id, book_id, language, model_id, status, covered_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'partial', '{}', ?, ?)`,
          )
          .run(randomUUID(), bookId, language, modelId, now, now)
      }
      return true
    })
    return write() ? this.get(bookId) : null
  }

  /**
   * Commit ONE decode window: its passages and its covered interval together. Refused as a whole
   * (nothing written, null) when there is no transcript, the interval is unusable, or any passage is
   * invalid / outside the interval / of another track. Earlier passages of the overlap that a new one
   * supersedes (research R3) are removed in the same transaction.
   */
  commitWindow(
    bookId: string,
    passages: readonly TranscriptPassage[],
    interval: { trackId?: string; startMs: number; endMs: number },
  ): CommitWindowResult | null {
    if (!isValidTimeRange(interval.startMs, interval.endMs)) return null
    const key = trackKey(interval.trackId)
    const incoming = passages.map((p): TranscriptPassage => {
      const passage: TranscriptPassage = { startMs: p.startMs, endMs: p.endMs, text: p.text }
      if (interval.trackId) passage.trackId = interval.trackId
      return passage
    })
    for (let i = 0; i < passages.length; i += 1) {
      const p = passages[i]!
      if (!isValidPassage(p)) return null
      if ((p.trackId ?? null) !== (interval.trackId ?? null)) return null
      if (p.startMs < interval.startMs || p.endMs > interval.endMs) return null
      if (!Number.isSafeInteger(p.startMs) || !Number.isSafeInteger(p.endMs)) return null
    }

    const write = this.db.transaction((): CommitWindowResult | null => {
      const transcript = this.db
        .prepare('SELECT id, covered_json FROM audio_transcripts WHERE book_id = ?')
        .get(bookId) as { id: string; covered_json: string } | undefined
      if (!transcript) return null

      const trackFilter = interval.trackId ? 'p.track_id = ?' : 'p.track_id IS NULL'
      const params: unknown[] = [transcript.id]
      if (interval.trackId) params.push(interval.trackId)
      params.push(interval.endMs, interval.startMs)
      const overlapping = this.db
        .prepare(
          `SELECT p.id, p.track_id, p.start_ms, p.end_ms, p.text FROM audio_transcript_passages p
            WHERE p.transcript_id = ? AND ${trackFilter} AND p.start_ms < ? AND p.end_ms > ?`,
        )
        .all(...params) as PassageRow[]
      const stored = overlapping.map(toPassage)
      const { dropped } = dropSupersededPassages(stored, incoming)
      const removeStmt = this.db.prepare('DELETE FROM audio_transcript_passages WHERE id = ?')
      for (const gone of dropped) removeStmt.run(gone.id)

      const insert = this.db.prepare(
        'INSERT INTO audio_transcript_passages (transcript_id, track_id, start_ms, end_ms, text) VALUES (?, ?, ?, ?, ?)',
      )
      for (const p of incoming) insert.run(transcript.id, interval.trackId ?? null, p.startMs, p.endMs, p.text)

      const covered = parseCovered(transcript.covered_json)
      covered[key] = mergeRanges([...(covered[key] ?? []), [interval.startMs, interval.endMs]])
      this.db
        .prepare('UPDATE audio_transcripts SET covered_json = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(covered), new Date().toISOString(), transcript.id)
      return { inserted: incoming.length, superseded: dropped.length }
    })
    return write()
  }

  /**
   * Passages in playback order. `trackId` limits to one track; `fromMs`/`toMs` keep passages that
   * overlap `[fromMs, toMs)`. `limit` defaults to 500 and is clamped to 1–2000.
   */
  getPassages(
    bookId: string,
    options: { trackId?: string; fromMs?: number; toMs?: number; limit?: number; offset?: number } = {},
  ): StoredPassage[] {
    const where: string[] = ['t.book_id = ?']
    const params: unknown[] = [bookId]
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
    const offset = options.offset !== undefined && Number.isFinite(options.offset) ? Math.max(0, Math.floor(options.offset)) : 0
    params.push(offset)
    const rows = this.db
      .prepare(
        `SELECT p.id, p.track_id, p.start_ms, p.end_ms, p.text
           FROM audio_transcript_passages p
           JOIN audio_transcripts t ON t.id = p.transcript_id
           LEFT JOIN book_audio_chapters c ON c.id = p.track_id
          WHERE ${where.join(' AND ')}
          ORDER BY ${PLAYBACK_ORDER}
          LIMIT ? OFFSET ?`,
      )
      .all(...params) as PassageRow[]
    return rows.map(toPassage)
  }

  /** Full-text search inside one book's transcript, hits in playback order. */
  search(bookId: string, query: string, limit?: number): TranscriptSearchHit[] {
    const match = buildFtsQuery(query)
    if (!match) return []
    const rows = this.db
      .prepare(
        `SELECT p.id, p.track_id, p.start_ms,
                snippet(audio_transcript_fts, 0, '', '', '…', 16) AS snippet
           FROM audio_transcript_fts
           JOIN audio_transcript_passages p ON p.id = audio_transcript_fts.rowid
           JOIN audio_transcripts t ON t.id = p.transcript_id
           LEFT JOIN book_audio_chapters c ON c.id = p.track_id
          WHERE audio_transcript_fts MATCH ? AND t.book_id = ?
          ORDER BY ${PLAYBACK_ORDER}
          LIMIT ?`,
      )
      .all(match, bookId, clampLimit(limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT)) as Array<{
      id: number
      track_id: string | null
      start_ms: number
      snippet: string
    }>
    return rows.map((row) => {
      const hit: TranscriptSearchHit = { passageId: row.id, startMs: row.start_ms, snippet: row.snippet }
      if (row.track_id) hit.trackId = row.track_id
      return hit
    })
  }

  /**
   * Mark a job accepted/started (`queued`/`running`), or clear it (null). `lastError`: a code sets it,
   * null clears it, undefined leaves it alone.
   */
  setJobState(
    bookId: string,
    jobState: TranscriptJobState | null,
    lastError?: TranscriptionErrorCode | null,
  ): boolean {
    const sets = ['job_state = ?', 'updated_at = ?']
    const params: unknown[] = [jobState, new Date().toISOString()]
    if (lastError !== undefined) {
      sets.push('last_error = ?')
      params.push(lastError)
    }
    params.push(bookId)
    return this.db.prepare(`UPDATE audio_transcripts SET ${sets.join(', ')} WHERE book_id = ?`).run(...params).changes > 0
  }

  /**
   * Remember what the job just accepted was asked to transcribe, so that after an interruption Resume can start the same scope
   * again. Kept when the job ends; `null` forgets it. Returns false when the book has no transcript.
   */
  setScope(bookId: string, scope: TranscriptionScope | null): boolean {
    return (
      this.db
        .prepare('UPDATE audio_transcripts SET scope_json = ?, updated_at = ? WHERE book_id = ?')
        .run(scope ? JSON.stringify(scope) : null, new Date().toISOString(), bookId).changes > 0
    )
  }

  /** A job ended: clear `job_state` and set the outcome in one statement. */
  endJob(bookId: string, status: TranscriptStatus, lastError: TranscriptionErrorCode | null): boolean {
    return (
      this.db
        .prepare(
          'UPDATE audio_transcripts SET job_state = NULL, status = ?, last_error = ?, updated_at = ? WHERE book_id = ?',
        )
        .run(status, lastError, new Date().toISOString(), bookId).changes > 0
    )
  }

  setStatus(bookId: string, status: TranscriptStatus, lastError?: TranscriptionErrorCode | null): boolean {
    const sets = ['status = ?', 'updated_at = ?']
    const params: unknown[] = [status, new Date().toISOString()]
    if (lastError !== undefined) {
      sets.push('last_error = ?')
      params.push(lastError)
    }
    params.push(bookId)
    return this.db.prepare(`UPDATE audio_transcripts SET ${sets.join(', ')} WHERE book_id = ?`).run(...params).changes > 0
  }

  /** "Replace": drop every passage and the coverage, keep the row (status `partial`, no error). */
  replace(bookId: string): boolean {
    const write = this.db.transaction((): boolean => {
      const transcript = this.db.prepare('SELECT id FROM audio_transcripts WHERE book_id = ?').get(bookId) as
        | { id: string }
        | undefined
      if (!transcript) return false
      this.db.prepare('DELETE FROM audio_transcript_passages WHERE transcript_id = ?').run(transcript.id)
      this.db
        .prepare(
          `UPDATE audio_transcripts SET covered_json = '{}', status = 'partial', last_error = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(new Date().toISOString(), transcript.id)
      return true
    })
    return write()
  }

  /** Delete the transcript (passages and FTS entries go with it). */
  deleteForBook(bookId: string): boolean {
    return this.db.prepare('DELETE FROM audio_transcripts WHERE book_id = ?').run(bookId).changes > 0
  }

  /**
   * Startup recovery. A transcript whose `job_state` is still set was left by a previous process that
   * died mid-job: clear it, record `INTERRUPTED`, and set `partial` when anything was transcribed
   * (passages or coverage) or `failed` when not. Never `complete`, never deletes text, and a second run
   * finds nothing left to change. Returns how many transcripts were recovered.
   */
  recoverInterrupted(): number {
    return this.db
      .prepare(
        `UPDATE audio_transcripts
            SET job_state = NULL,
                last_error = 'INTERRUPTED',
                status = CASE
                  WHEN covered_json <> '{}' OR EXISTS (SELECT 1 FROM audio_transcript_passages p WHERE p.transcript_id = audio_transcripts.id)
                  THEN 'partial' ELSE 'failed' END,
                updated_at = ?
          WHERE job_state IS NOT NULL`,
      )
      .run(new Date().toISOString()).changes
  }
}
