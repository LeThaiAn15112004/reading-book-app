-- Mobile baseline (spec 008, T041): the first-release tables, copied from the schema of a fully migrated Desktop
-- database as dumped by `scripts/dump-desktop-schema.mjs --tables books,authors,book_authors,collections,collection_books,notes`
-- (Desktop migrations 001-030; the dump agrees with the developer's real pre-change library, see below).
--
-- Same columns, constraints, defaults and indexes as Desktop, so a row means the same thing in both apps
-- (FR-021). Decisions from T040:
--   * Genres: there is no genre table; genres are names in books.genres_json (Desktop migration 020).
--   * Bookmarks: rows of `notes` with note_json.group = 'bookmark' (Desktop migration 019), no table of their own.
--   * JSON checks (json_valid) are kept: expo-sqlite in Expo Go has the JSON functions (T023).
--   * books.file_format keeps Desktop's full CHECK list; MobileLibraryStore accepts only epub, pdf, txt, md.
--   * notes.page_number: present in libraries created by old Desktop versions, absent from a fresh Desktop
--     migration, and never written by Desktop's stores. Mobile follows the fresh schema and leaves it out.
-- Not in the first release: reading-session tables (state lives in books.reading_state_json), txt_documents
-- (TXT is read-only on Mobile), audio chapters, transcripts, full-text chunks and the PDF sync ledgers.

CREATE TABLE "books" (
  id                 TEXT    PRIMARY KEY NOT NULL,
  title              TEXT    NOT NULL,
  file_path          TEXT    NOT NULL,
  normalized_path    TEXT,
  file_format        TEXT    NOT NULL
    CHECK (file_format IN ('epub', 'pdf', 'txt', 'md', 'docx', 'doc', 'mp3',
                       'm4a', 'm4b', 'aac', 'wav', 'flac', 'ogg', 'opus')),
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
  reading_state_json TEXT    NOT NULL DEFAULT '{}'
    CHECK (json_valid(reading_state_json)),
  added_at           TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL
);

CREATE TABLE authors (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  sort_name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE book_authors (
  book_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (book_id, author_id),
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES authors (id) ON DELETE RESTRICT
);

CREATE TABLE collections (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE collection_books (
  collection_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL,
  PRIMARY KEY (collection_id, book_id),
  FOREIGN KEY (collection_id) REFERENCES collections (id) ON DELETE CASCADE,
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);

CREATE TABLE notes (
  id          TEXT    PRIMARY KEY NOT NULL,
  book_id     TEXT    NOT NULL,
  note_json   TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(note_json)),
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);

CREATE INDEX idx_book_authors_author_id ON book_authors (author_id);
CREATE INDEX idx_books_favorite ON books (is_favorite);
CREATE INDEX idx_books_reading_status ON books (reading_status);
CREATE UNIQUE INDEX idx_books_sha256 ON books (sha256);
CREATE INDEX idx_books_source ON books (source_provider, external_id);
CREATE INDEX idx_books_updated_at ON books (updated_at);
CREATE INDEX idx_collection_books_book_id ON collection_books (book_id);
CREATE INDEX idx_collections_updated_at ON collections (updated_at);
CREATE INDEX idx_notes_book_id ON notes (book_id);
CREATE INDEX idx_notes_group ON notes (json_extract(note_json, '$.group'));
CREATE INDEX idx_notes_updated_at ON notes (updated_at);
