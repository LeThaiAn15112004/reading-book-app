-- Migration 028 — chapters of a multi-chapter audiobook (ZIP import).
--
-- `books` stays the parent record (one library entry per audiobook); this table lists its ordered chapter
-- files. A book is multi-chapter if and only if it has rows here — there is no flag column, and every book
-- that exists today has none, so nothing about single-file books changes. `books` is NOT rebuilt (unlike
-- 026 / 027): this is a plain CREATE TABLE, so no foreign-key-off / rename dance and nothing to copy.
--
-- `file_name` is a basename, never a path: the file lives in the parent's own folder
-- (`dirname(books.file_path)/file_name`), so no stored value can point anywhere else. `source_path` is the
-- archive-relative path, kept for display / provenance only and never opened. `file_format` is per chapter:
-- a book may mix formats, and `books.file_format` (the first chapter's) is only a routing marker.
-- `duration_seconds` is NULL when the duration could not be determined; that alone never makes a track invalid.

CREATE TABLE IF NOT EXISTS book_audio_chapters (
  id               TEXT    PRIMARY KEY NOT NULL,
  book_id          TEXT    NOT NULL,
  position         INTEGER NOT NULL CHECK (position >= 0),
  title            TEXT    NOT NULL,
  file_name        TEXT    NOT NULL
    CHECK (file_name <> '' AND instr(file_name, '/') = 0 AND instr(file_name, char(92)) = 0 AND file_name NOT IN ('.', '..')),
  source_path      TEXT    NOT NULL,
  file_format      TEXT    NOT NULL
    CHECK (file_format IN ('mp3', 'm4a', 'm4b', 'aac', 'wav', 'flac', 'ogg', 'opus')),
  size_bytes       INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256           TEXT    NOT NULL,
  duration_seconds REAL    CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE,
  UNIQUE (book_id, position),
  UNIQUE (book_id, file_name)
);

CREATE INDEX IF NOT EXISTS idx_book_audio_chapters_book ON book_audio_chapters (book_id, position);
