-- Library genres as N–N (replace denormalized books.genre from 006).
-- Keep books.description + books.page_count. Do NOT restore app_settings.
-- Legacy books.genre was short-lived (006); values almost always NULL — drop with rebuild.

CREATE TABLE IF NOT EXISTS genres (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_genres_name ON genres (name);

CREATE TABLE IF NOT EXISTS book_genres (
  book_id TEXT NOT NULL,
  genre_id TEXT NOT NULL,
  PRIMARY KEY (book_id, genre_id),
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE,
  FOREIGN KEY (genre_id) REFERENCES genres (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_book_genres_genre_id ON book_genres (genre_id);

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
  description TEXT,
  page_count INTEGER,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_signed INTEGER NOT NULL DEFAULT 0,
  source_url TEXT,
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO books_new (
  id, title, file_path, normalized_path, file_format, cover_path,
  sha256, file_size_bytes, description, page_count,
  is_favorite, is_signed, source_url, added_at, updated_at
)
SELECT
  id, title, file_path, normalized_path, file_format, cover_path,
  sha256, file_size_bytes, description, page_count,
  is_favorite, is_signed, source_url, added_at, updated_at
FROM books;

DROP TABLE books;
ALTER TABLE books_new RENAME TO books;

CREATE UNIQUE INDEX IF NOT EXISTS idx_books_sha256 ON books (sha256);
CREATE INDEX IF NOT EXISTS idx_books_is_favorite ON books (is_favorite);
CREATE INDEX IF NOT EXISTS idx_books_is_signed ON books (is_signed);
CREATE INDEX IF NOT EXISTS idx_books_updated_at ON books (updated_at);

PRAGMA foreign_keys = ON;
