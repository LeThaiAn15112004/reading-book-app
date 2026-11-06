-- Expand books.file_format CHECK to include docx + doc (MVP 6 formats).
-- SQLite cannot ALTER CHECK in place — rebuild the books table.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS books_new (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  file_path TEXT NOT NULL,
  normalized_path TEXT,
  file_format TEXT NOT NULL CHECK (file_format IN ('epub', 'pdf', 'txt', 'md', 'docx', 'doc')),
  cover_path TEXT,
  sha256 TEXT NOT NULL,
  file_size_bytes INTEGER,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  source_url TEXT,
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO books_new (
  id, title, file_path, normalized_path, file_format, cover_path,
  sha256, file_size_bytes, is_favorite, source_url, added_at, updated_at
)
SELECT
  id, title, file_path, normalized_path, file_format, cover_path,
  sha256, file_size_bytes, is_favorite, source_url, added_at, updated_at
FROM books;

DROP TABLE books;
ALTER TABLE books_new RENAME TO books;

CREATE UNIQUE INDEX IF NOT EXISTS idx_books_sha256 ON books (sha256);
CREATE INDEX IF NOT EXISTS idx_books_is_favorite ON books (is_favorite);
CREATE INDEX IF NOT EXISTS idx_books_updated_at ON books (updated_at);

PRAGMA foreign_keys = ON;
