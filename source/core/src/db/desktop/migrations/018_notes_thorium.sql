-- Migration 018 — Notes chuẩn hóa theo Thorium Reader (Readium Web Annotation).
--
-- 1) `annotations` (+ `annotation_tags`) → `notes` (+ `note_tags`): gộp toàn bộ payload
--    linh hoạt (type, locator, style, nội dung, trạng thái…) vào một cột JSON duy nhất
--    `note_json`, thay vì một cột SQL riêng cho từng thuộc tính — kể cả vị trí trang, đã
--    nằm trong `note_json.locatorExtended`/`pdfAnnotation` thay vì một cột `page_number`
--    riêng.
--    note_json tối thiểu gồm: `type`, `locatorExtended.locator` (JSON Location dùng để
--    "jump", tương đương `annotations.location_ref` cũ), `locatorExtended.raw` (payload
--    render opaque theo từng type, tương đương `annotations.location_data` cũ),
--    `textualValue`, `note`, `style`, `status`, `isChecked`.
-- 2) `books`: gộp `book_signatures` (1 chữ ký / sách) trực tiếp vào `books.signer_name` /
--    `signature_status` / `signed_at`, bỏ bảng con `book_signatures`.
--
-- SQLite không ALTER COLUMN / DROP COLUMN được → rebuild table (như 003/007/008/009/012).

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------------------
-- 1) books: inline chữ ký, drop book_signatures
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS books_new (
  id                TEXT    PRIMARY KEY NOT NULL,
  title             TEXT    NOT NULL,
  file_path         TEXT    NOT NULL,
  normalized_path   TEXT,
  file_format       TEXT    NOT NULL
    CHECK (file_format IN ('epub', 'pdf', 'txt', 'md', 'docx', 'doc')),
  cover_path        TEXT,
  sha256            TEXT    NOT NULL,
  file_size_bytes   INTEGER,
  page_count        INTEGER,
  description       TEXT,
  is_signed         INTEGER NOT NULL DEFAULT 0,
  signer_name       TEXT,
  signature_status  TEXT    NOT NULL DEFAULT 'unknown'
    CHECK (signature_status IN ('valid', 'invalid', 'expired', 'unknown')),
  signed_at         TEXT,
  is_favorite       INTEGER NOT NULL DEFAULT 0,
  source_url        TEXT,
  reading_status    TEXT    NOT NULL DEFAULT 'not-started'
    CHECK (reading_status IN ('reading', 'completed', 'not-started')),
  source_provider   TEXT,
  external_id       TEXT,
  added_at          TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);

INSERT INTO books_new (
  id, title, file_path, normalized_path, file_format, cover_path,
  sha256, file_size_bytes, page_count, description, is_signed,
  signer_name, signature_status, signed_at,
  is_favorite, source_url, reading_status, source_provider, external_id,
  added_at, updated_at
)
SELECT
  b.id, b.title, b.file_path, b.normalized_path, b.file_format, b.cover_path,
  b.sha256, b.file_size_bytes, b.page_count, b.description, b.is_signed,
  bs.signer_name, COALESCE(bs.signature_status, 'unknown'), bs.signed_at,
  b.is_favorite, b.source_url, b.reading_status, b.source_provider, b.external_id,
  b.added_at, b.updated_at
FROM books b
LEFT JOIN book_signatures bs ON bs.id = (
  SELECT id FROM book_signatures
  WHERE book_id = b.id
  ORDER BY (signed_at IS NULL) ASC, signed_at DESC, id DESC
  LIMIT 1
);

DROP TABLE book_signatures;
DROP TABLE books;
ALTER TABLE books_new RENAME TO books;

CREATE UNIQUE INDEX IF NOT EXISTS idx_books_sha256 ON books (sha256);
CREATE INDEX IF NOT EXISTS idx_books_is_favorite ON books (is_favorite);
CREATE INDEX IF NOT EXISTS idx_books_is_signed ON books (is_signed);
CREATE INDEX IF NOT EXISTS idx_books_updated_at ON books (updated_at);
CREATE INDEX IF NOT EXISTS idx_books_reading_status ON books (reading_status);
CREATE INDEX IF NOT EXISTS idx_books_cloud_provenance ON books (source_provider, external_id);

-- ---------------------------------------------------------------------------
-- 2) notes: gộp annotations → note_json; note_tags thay annotation_tags
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notes (
  id          TEXT    PRIMARY KEY NOT NULL,
  book_id     TEXT    NOT NULL,
  note_json   TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(note_json)),
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);

INSERT INTO notes (id, book_id, note_json, created_at, updated_at)
SELECT
  a.id,
  a.book_id,
  json_object(
    'schemaVersion', 1,
    'type', a.type,
    'locatorExtended', json_object(
      'locator', json(a.location_ref),
      'raw', a.location_data
    ),
    'textualValue', a.content,
    'note', a.notes,
    'style', json(a.style_properties),
    'status', a.status,
    'isChecked', json(CASE WHEN a.is_checked = 1 THEN 'true' ELSE 'false' END)
  ),
  a.created_at,
  a.updated_at
FROM annotations a;

CREATE INDEX IF NOT EXISTS idx_notes_book_id ON notes (book_id);
CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes (updated_at);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL,
  tag_id  TEXT NOT NULL,
  PRIMARY KEY (note_id, tag_id),
  FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
);

INSERT INTO note_tags (note_id, tag_id)
SELECT annotation_id, tag_id FROM annotation_tags;

DROP TABLE annotation_tags;
DROP TABLE annotations;

PRAGMA foreign_keys = ON;
