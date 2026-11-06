import type { Database as SqliteDatabase } from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import {
  dropSupersededPassages,
  isValidPassage,
  isValidTimeRange,
  mergeRanges,
  trackKey,
  transcriptCodec,
  transcriptStatements as q,
  type SyncSqlDriver,
  type TranscriptPassage,
  type TranscriptStatus,
  type TranscriptionErrorCode,
  type TranscriptionScope,
} from '@reading-book/book-reader-sdk'
import { getDatabase } from './db'
import { createSyncSqlDriver } from './sql-driver'

// Rows, codecs, limits and the SQL (core `transcriptCodec` / `transcriptStatements`, spec 009 T036) are core's;
// re-exported because Main and the spikes import them from here.
export const DEFAULT_PASSAGE_LIMIT = transcriptCodec.DEFAULT_PASSAGE_LIMIT
export const MAX_PASSAGE_LIMIT = transcriptCodec.MAX_PASSAGE_LIMIT
export const DEFAULT_SEARCH_LIMIT = transcriptCodec.DEFAULT_SEARCH_LIMIT
export const MAX_SEARCH_LIMIT = transcriptCodec.MAX_SEARCH_LIMIT
export const parseScope = transcriptCodec.parseScope
export const buildFtsQuery = transcriptCodec.buildFtsQuery

export type TranscriptJobState = transcriptCodec.TranscriptJobState
export type StoredPassage = transcriptCodec.StoredPassage
export type TranscriptRecord = transcriptCodec.TranscriptRecord
export type TranscriptSearchHit = transcriptCodec.TranscriptSearchHit

export interface CommitWindowResult {
  inserted: number
  /** Earlier passages of the overlap that the new window superseded and removed. */
  superseded: number
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
  private readonly sql: SyncSqlDriver

  constructor(db: SqliteDatabase = getDatabase()) {
    this.sql = createSyncSqlDriver(db)
  }

  /** The transcript of a book, or null. */
  get(bookId: string): TranscriptRecord | null {
    const row = this.sql.get<transcriptCodec.TranscriptRow>(q.selectTranscriptWithCount(bookId))
    return row ? transcriptCodec.transcriptFromRow(row) : null
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
    const written = this.sql.transaction((): boolean => {
      const exists = this.sql.get(q.selectBookExists(bookId))
      if (!exists) return false
      const updated = this.sql.run(q.updateTranscriptModel(bookId, language, modelId, now))
      if (updated.changes === 0) {
        this.sql.run(q.insertTranscript(randomUUID(), bookId, language, modelId, now))
      }
      return true
    })
    return written ? this.get(bookId) : null
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

    return this.sql.transaction((): CommitWindowResult | null => {
      const transcript = this.sql.get<{ id: string; covered_json: string }>(q.selectTranscriptCovered(bookId))
      if (!transcript) return null

      const overlapping = this.sql.all<transcriptCodec.PassageRow>(
        q.selectOverlappingPassages(transcript.id, interval.trackId, interval.startMs, interval.endMs),
      )
      const stored = overlapping.map(transcriptCodec.passageFromRow)
      const { dropped } = dropSupersededPassages(stored, incoming)
      for (const gone of dropped) this.sql.run(q.deletePassage(gone.id))

      for (const p of incoming) {
        this.sql.run(q.insertPassage(transcript.id, interval.trackId ?? null, p.startMs, p.endMs, p.text))
      }

      const covered = transcriptCodec.parseCovered(transcript.covered_json)
      covered[key] = mergeRanges([...(covered[key] ?? []), [interval.startMs, interval.endMs]])
      this.sql.run(q.updateCovered(transcript.id, JSON.stringify(covered), new Date().toISOString()))
      return { inserted: incoming.length, superseded: dropped.length }
    })
  }

  /**
   * Passages in playback order. `trackId` limits to one track; `fromMs`/`toMs` keep passages that
   * overlap `[fromMs, toMs)`. `limit` defaults to 500 and is clamped to 1–2000.
   */
  getPassages(
    bookId: string,
    options: { trackId?: string; fromMs?: number; toMs?: number; limit?: number; offset?: number } = {},
  ): StoredPassage[] {
    return this.sql.all<transcriptCodec.PassageRow>(q.selectPassages(bookId, options)).map(transcriptCodec.passageFromRow)
  }

  /** Full-text search inside one book's transcript, hits in playback order. */
  search(bookId: string, query: string, limit?: number): TranscriptSearchHit[] {
    const match = transcriptCodec.buildFtsQuery(query)
    if (!match) return []
    return this.sql.all<transcriptCodec.SearchRow>(q.searchPassages(match, bookId, limit)).map(transcriptCodec.searchHitFromRow)
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
    return this.sql.run(q.updateJobState(bookId, jobState, new Date().toISOString(), lastError)).changes > 0
  }

  /**
   * Remember what the job just accepted was asked to transcribe, so that after an interruption Resume can start the same scope
   * again. Kept when the job ends; `null` forgets it. Returns false when the book has no transcript.
   */
  setScope(bookId: string, scope: TranscriptionScope | null): boolean {
    return this.sql.run(q.updateScope(bookId, scope, new Date().toISOString())).changes > 0
  }

  /** A job ended: clear `job_state` and set the outcome in one statement. */
  endJob(bookId: string, status: TranscriptStatus, lastError: TranscriptionErrorCode | null): boolean {
    return this.sql.run(q.endJob(bookId, status, lastError, new Date().toISOString())).changes > 0
  }

  setStatus(bookId: string, status: TranscriptStatus, lastError?: TranscriptionErrorCode | null): boolean {
    return this.sql.run(q.updateStatus(bookId, status, new Date().toISOString(), lastError)).changes > 0
  }

  /** "Replace": drop every passage and the coverage, keep the row (status `partial`, no error). */
  replace(bookId: string): boolean {
    return this.sql.transaction((): boolean => {
      const transcript = this.sql.get<{ id: string }>(q.selectTranscriptId(bookId))
      if (!transcript) return false
      this.sql.run(q.deletePassagesOfTranscript(transcript.id))
      this.sql.run(q.resetTranscript(transcript.id, new Date().toISOString()))
      return true
    })
  }

  /** Delete the transcript (passages and FTS entries go with it). */
  deleteForBook(bookId: string): boolean {
    return this.sql.run(q.deleteTranscriptOfBook(bookId)).changes > 0
  }

  /**
   * Startup recovery. A transcript whose `job_state` is still set was left by a previous process that
   * died mid-job: clear it, record `INTERRUPTED`, and set `partial` when anything was transcribed
   * (passages or coverage) or `failed` when not. Never `complete`, never deletes text, and a second run
   * finds nothing left to change. Returns how many transcripts were recovered.
   */
  recoverInterrupted(): number {
    return this.sql.run(q.recoverInterrupted(new Date().toISOString())).changes
  }
}
