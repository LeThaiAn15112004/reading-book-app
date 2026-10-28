-- Migration 029 — audiobook transcripts (spec 004-audiobook-transcription).
--
-- Overlay data only: nothing here touches `books` or the audio file. One transcript per audiobook
-- (single-file or multi-chapter), made of time-stamped passages, with a full-text index.
--
-- `audio_transcripts`
--   * `book_id` is UNIQUE and cascades: removing an audiobook removes its transcript (FR-015).
--   * `status` is partial | complete | failed | cancelled; "no transcript" is the absence of a row.
--   * `job_state` is non-NULL only while a job for the book is queued/running. A non-NULL value found
--     at app start means the previous process died mid-job; startup recovery turns it into
--     `last_error = 'INTERRUPTED'` and never into `complete`.
--   * `covered_json` = { "<track id | 'main'>": [[startMs, endMs], ...] }, merged and sorted by the app;
--     a window's passages and its covered interval are written in ONE transaction.
--
-- `audio_transcript_passages`
--   * times are milliseconds inside the passage's own audio file; `track_id` is NULL for a single-file
--     audiobook and a `book_audio_chapters.id` otherwise.
--   * NO ordering column: playback order is `book_audio_chapters.position` (authoritative), joined at
--     read time — `ORDER BY COALESCE(c.position, 0), p.start_ms, p.id` — so a single-file book (track_id
--     NULL) sorts as position 0.
--   * `id` is a rowid alias, so it never moves and can be the FTS5 content rowid.
--
-- `audio_transcript_fts` mirrors `book_chunks_fts` (migration 021): external-content FTS5 over the
-- passage text, kept in sync by triggers — including the DELETE triggers fired by ON DELETE CASCADE.
-- 'unicode61 remove_diacritics 2' is case- and diacritic-insensitive ("viet" finds "Việt").

CREATE TABLE IF NOT EXISTS audio_transcripts (
  id           TEXT PRIMARY KEY NOT NULL,
  book_id      TEXT NOT NULL UNIQUE,
  language     TEXT NOT NULL CHECK (language <> ''),
  model_id     TEXT NOT NULL CHECK (model_id <> ''),
  status       TEXT NOT NULL CHECK (status IN ('partial', 'complete', 'failed', 'cancelled')),
  job_state    TEXT CHECK (job_state IS NULL OR job_state IN ('queued', 'running')),
  last_error   TEXT CHECK (
    last_error IS NULL OR last_error IN (
      'MODEL_MISSING', 'DISK_FULL', 'FILE_MISSING', 'UNSUPPORTED_LANGUAGE', 'NO_SPEECH',
      'DECODE_FAILED', 'INVALID_ARGUMENT', 'ABORTED', 'INTERRUPTED', 'INTEGRITY_FAILED'
    )
  ),
  covered_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(covered_json)),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audio_transcript_passages (
  id            INTEGER PRIMARY KEY,
  transcript_id TEXT NOT NULL,
  track_id      TEXT,
  start_ms      INTEGER NOT NULL CHECK (start_ms >= 0),
  end_ms        INTEGER NOT NULL,
  text          TEXT NOT NULL CHECK (length(text) > 0 AND text = trim(text)),
  CHECK (start_ms < end_ms),
  FOREIGN KEY (transcript_id) REFERENCES audio_transcripts (id) ON DELETE CASCADE,
  FOREIGN KEY (track_id) REFERENCES book_audio_chapters (id) ON DELETE CASCADE
);

-- Per-track range reads and active-passage lookup.
CREATE INDEX IF NOT EXISTS idx_audio_transcript_passages_pos
  ON audio_transcript_passages (transcript_id, track_id, start_ms);

CREATE VIRTUAL TABLE IF NOT EXISTS audio_transcript_fts USING fts5(
  text,
  content = 'audio_transcript_passages',
  content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3'
);

CREATE TRIGGER IF NOT EXISTS audio_transcript_fts_after_insert AFTER INSERT ON audio_transcript_passages BEGIN
  INSERT INTO audio_transcript_fts (rowid, text) VALUES (new.id, new.text);
END;

-- External content: a delete must hand FTS5 the exact text that was indexed.
CREATE TRIGGER IF NOT EXISTS audio_transcript_fts_after_delete AFTER DELETE ON audio_transcript_passages BEGIN
  INSERT INTO audio_transcript_fts (audio_transcript_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;

CREATE TRIGGER IF NOT EXISTS audio_transcript_fts_after_update AFTER UPDATE OF id, text ON audio_transcript_passages BEGIN
  INSERT INTO audio_transcript_fts (audio_transcript_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO audio_transcript_fts (rowid, text) VALUES (new.id, new.text);
END;
