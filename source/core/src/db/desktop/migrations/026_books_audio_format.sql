-- Migration 026 — allow 'mp3' in books.file_format (audiobooks).
--
-- SQLite cannot alter a CHECK constraint, so `books` is rebuilt exactly as 002 / 007 / 018 / 020 did:
-- books_new -> copy every row -> drop -> rename -> recreate the indexes. Nothing else changes: same
-- columns, same defaults, same other CHECKs, same data. 'docx' / 'doc' stay in the list on purpose
-- (rows imported before those formats were retired remain valid); removing them is a separate decision.
--
-- The runner (`migrate.ts`) wraps each migration in one transaction and turns `PRAGMA foreign_keys`
-- OFF at connection level first, so DROP TABLE books does NOT cascade into book_authors /
-- collection_books / notes / book_chunks / txt_documents / pdf_* tables. Their FOREIGN KEYs reference
-- `books` by name and re-attach to the new table after the rename (the same way 018 and 020 rely on).

CREATE TABLE books_new (
  id                 TEXT    PRIMARY KEY NOT NULL,
  title              TEXT    NOT NULL,
  file_path          TEXT    NOT NULL,
  normalized_path    TEXT,
  file_format        TEXT    NOT NULL
    CHECK (file_format IN ('epub', 'pdf', 'txt', 'md', 'docx', 'doc', 'mp3')),
  cover_path         TEXT,
  sha256             TEXT    NOT NULL,
  is_favorite        INTEGER NOT NULL DEFAULT 0,
  reading_status     TEXT    NOT NULL DEFAULT 'not-started'
    CHECK (reading_status IN ('reading', 'completed', 'not-started')),
  source_provider    TEXT,
  external_id        TEXT,
  source_url         TEXT,

  metadata_json      TEXT    NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json)),
  genres_json        TEXT    NOT NULL DEFAULT '[]'
    CHECK (json_valid(genres_json)),
  -- Audiobooks keep their listening position under `audioProgress` (no column needed).
  reading_state_json TEXT    NOT NULL DEFAULT '{}'
    CHECK (json_valid(reading_state_json)),

  added_at           TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL
);

INSERT INTO books_new (
  id, title, file_path, normalized_path, file_format, cover_path, sha256,
  is_favorite, reading_status, source_provider, external_id, source_url,
  metadata_json, genres_json, reading_state_json,
  added_at, updated_at
)
SELECT
  id, title, file_path, normalized_path, file_format, cover_path, sha256,
  is_favorite, reading_status, source_provider, external_id, source_url,
  metadata_json, genres_json, reading_state_json,
  added_at, updated_at
FROM books;

DROP TABLE books;

ALTER TABLE books_new RENAME TO books;

CREATE UNIQUE INDEX IF NOT EXISTS idx_books_sha256          ON books (sha256);
CREATE INDEX        IF NOT EXISTS idx_books_favorite        ON books (is_favorite);
CREATE INDEX        IF NOT EXISTS idx_books_reading_status  ON books (reading_status);
CREATE INDEX        IF NOT EXISTS idx_books_source          ON books (source_provider, external_id);
CREATE INDEX        IF NOT EXISTS idx_books_updated_at      ON books (updated_at);
