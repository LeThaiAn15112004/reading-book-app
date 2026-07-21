-- T0.6 / SDS §3 — Overlay schema v1
-- Conventions: snake_case; datetime TEXT ISO-8601; boolean INTEGER 0/1; PK UUID TEXT

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  file_path TEXT NOT NULL,
  normalized_path TEXT,
  file_format TEXT NOT NULL CHECK (file_format IN ('epub', 'pdf', 'txt', 'md')),
  cover_path TEXT,
  sha256 TEXT NOT NULL,
  file_size_bytes INTEGER,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  source_url TEXT,
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_books_sha256 ON books (sha256);
CREATE INDEX IF NOT EXISTS idx_books_is_favorite ON books (is_favorite);
CREATE INDEX IF NOT EXISTS idx_books_updated_at ON books (updated_at);

CREATE TABLE IF NOT EXISTS authors (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  sort_name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS book_authors (
  book_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (book_id, author_id),
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES authors (id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_book_authors_author_id ON book_authors (author_id);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collections_updated_at ON collections (updated_at);

CREATE TABLE IF NOT EXISTS collection_books (
  collection_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL,
  PRIMARY KEY (collection_id, book_id),
  FOREIGN KEY (collection_id) REFERENCES collections (id) ON DELETE CASCADE,
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_collection_books_book_id ON collection_books (book_id);

CREATE TABLE IF NOT EXISTS reading_session_states (
  book_id TEXT PRIMARY KEY NOT NULL,
  last_read_location TEXT NOT NULL,
  percent REAL NOT NULL DEFAULT 0,
  bg_color TEXT,
  text_color TEXT,
  font_size REAL,
  font_family TEXT,
  line_height REAL,
  theme_preset TEXT,
  is_landscape INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS highlights (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL,
  location_start TEXT NOT NULL,
  location_end TEXT NOT NULL,
  selected_text TEXT NOT NULL,
  color_hex TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL,
  highlight_id TEXT,
  location_ref TEXT NOT NULL,
  selected_text TEXT,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE,
  FOREIGN KEY (highlight_id) REFERENCES highlights (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_book_id ON notes (book_id);
CREATE INDEX IF NOT EXISTS idx_notes_highlight_id ON notes (highlight_id);

CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL,
  location_ref TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS book_chunks (
  id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  location_start TEXT,
  location_end TEXT,
  embedding BLOB,
  created_at TEXT NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_book_chunks_book_index ON book_chunks (book_id, chunk_index);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
