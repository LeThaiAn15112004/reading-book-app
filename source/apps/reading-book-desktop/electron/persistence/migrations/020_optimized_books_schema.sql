-- Migration 020 — Gộp dữ liệu 1-1 / N-N của `books` vào chính bảng `books` (JSON columns).
--
--   reading_session_states  (1-1)  ->  books.reading_state_json
--   genres + book_genres    (N-N)  ->  books.genres_json           (mảng tên genre)
--   file_size_bytes, page_count, description, is_signed,
--   signer_name, signature_status, signed_at  ->  books.metadata_json
--
-- Lợi ích: list thư viện không còn 2 query/sách (genres + session), autosave phiên đọc
-- là một `UPDATE books`. `normalized_path` GIỮ làm cột riêng (là đường dẫn file như
-- file_path / cover_path).
--
-- Quy ước JSON: key camelCase (giống `notes.note_json`), key NULL bị lược (null ≡ vắng).
--
-- Runner (`migrate.ts`) đã bọc migration trong 1 transaction và tắt `PRAGMA foreign_keys`
-- ở mức connection, nên DROP TABLE books bên dưới KHÔNG kích hoạt ON DELETE CASCADE lên
-- book_authors / collection_books / notes / book_chunks. SQLite không DROP/ALTER COLUMN
-- đầy đủ được -> rebuild bảng (books_new -> copy -> drop -> rename), như 002/003/007/018.

-- ---------------------------------------------------------------------------
-- 1) Bảng mới
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS books_new (
  id                 TEXT    PRIMARY KEY NOT NULL,
  title              TEXT    NOT NULL,
  file_path          TEXT    NOT NULL,
  normalized_path    TEXT,
  file_format        TEXT    NOT NULL
    CHECK (file_format IN ('epub', 'pdf', 'txt', 'md', 'docx', 'doc')),
  cover_path         TEXT,
  sha256             TEXT    NOT NULL,
  is_favorite        INTEGER NOT NULL DEFAULT 0,
  reading_status     TEXT    NOT NULL DEFAULT 'not-started'
    CHECK (reading_status IN ('reading', 'completed', 'not-started')),
  source_provider    TEXT,
  external_id        TEXT,
  source_url         TEXT,

  -- { fileSizeBytes, pageCount, description, isSigned, signerName, signatureStatus, signedAt }
  metadata_json      TEXT    NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json)),
  -- ["Fantasy", "Classics", ...]  (sắp A→Z, không trùng không phân biệt hoa/thường)
  genres_json        TEXT    NOT NULL DEFAULT '[]'
    CHECK (json_valid(genres_json)),
  -- { lastReadLocation, percent, fontFamily, fontSize, fontWeight, lineHeight, textAlign,
  --   layoutMode, pageTurnMode, marginsEnabled, marginPreset, isLandscape, updatedAt }
  reading_state_json TEXT    NOT NULL DEFAULT '{}'
    CHECK (json_valid(reading_state_json)),

  added_at           TEXT    NOT NULL,
  updated_at         TEXT    NOT NULL
);

-- ---------------------------------------------------------------------------
-- 2) Copy dữ liệu, gom vào JSON
-- ---------------------------------------------------------------------------
--
-- json_object(k1, v1, ...)  dựng object JSON từ cặp key/value. Nó giữ NULL thành `null`,
--   nên bọc thêm json_patch('{}', <object>): theo RFC 7396 (JSON Merge Patch) member `null`
--   của patch nghĩa là "xoá key" -> áp lên '{}' sẽ LƯỢC HẾT key NULL, cho JSON gọn
--   ('{"pageCount":320}' thay vì 6 key null).
-- json('true' | 'false')    ép ra boolean JSON thật; nếu truyền thẳng 0/1 thì json_object
--   sẽ ghi số 0/1. Dùng json(CASE ... END) (bọc ngoài CASE) như migration 018 vì subtype
--   JSON không được đảm bảo sống sót qua CASE.
-- json_group_array(x)       gom NHIỀU dòng thành MỘT mảng JSON, tự escape dấu nháy / unicode
--   và trả '[]' khi không có dòng nào (sách không genre vẫn hợp lệ). Subquery bên trong có
--   ORDER BY để giữ thứ tự A→Z như `ORDER BY g.name` của query cũ.
-- LEFT JOIN reading_session_states: quan hệ 1-1 nên không nhân dòng; sách chưa có dòng
--   session nhận reading_state_json = '{}'.

INSERT INTO books_new (
  id, title, file_path, normalized_path, file_format, cover_path, sha256,
  is_favorite, reading_status, source_provider, external_id, source_url,
  metadata_json, genres_json, reading_state_json,
  added_at, updated_at
)
SELECT
  b.id,
  b.title,
  b.file_path,
  b.normalized_path,
  b.file_format,
  b.cover_path,
  b.sha256,
  b.is_favorite,
  b.reading_status,
  b.source_provider,
  b.external_id,
  b.source_url,

  json_patch('{}', json_object(
    'fileSizeBytes',   b.file_size_bytes,
    'pageCount',       b.page_count,
    'description',     b.description,
    'isSigned',        json(CASE WHEN b.is_signed = 1 THEN 'true' ELSE 'false' END),
    'signerName',      b.signer_name,
    'signatureStatus', b.signature_status,
    'signedAt',        b.signed_at
  )),

  COALESCE((
    SELECT json_group_array(genre_name)
    FROM (
      SELECT g.name AS genre_name
      FROM book_genres bg
      JOIN genres g ON g.id = bg.genre_id
      WHERE bg.book_id = b.id
      ORDER BY g.name
    )
  ), '[]'),

  CASE
    WHEN rs.book_id IS NULL THEN '{}'
    ELSE json_patch('{}', json_object(
      'lastReadLocation', rs.last_read_location,
      'percent',          rs.percent,
      'fontFamily',       rs.font_family,
      'fontSize',         rs.font_size,
      'fontWeight',       rs.font_weight,
      'lineHeight',       rs.line_height,
      'textAlign',        rs.text_align,
      'layoutMode',       rs.layout_mode,
      'pageTurnMode',     rs.page_turn_mode,
      'marginsEnabled',   json(CASE
                                WHEN rs.margins_enabled IS NULL THEN 'null'
                                WHEN rs.margins_enabled = 1 THEN 'true'
                                ELSE 'false'
                              END),
      'marginPreset',     rs.margin_preset,
      'isLandscape',      json(CASE WHEN rs.is_landscape = 1 THEN 'true' ELSE 'false' END),
      'updatedAt',        rs.updated_at
    ))
  END,

  b.added_at,
  b.updated_at
FROM books b
LEFT JOIN reading_session_states rs ON rs.book_id = b.id;

-- ---------------------------------------------------------------------------
-- 3) Bỏ bảng cũ + bảng phụ (FK đang tắt: không cascade)
-- ---------------------------------------------------------------------------

DROP TABLE reading_session_states;
DROP TABLE book_genres;
DROP TABLE genres;
DROP TABLE books;

-- ---------------------------------------------------------------------------
-- 4) Rename + tạo lại index
-- ---------------------------------------------------------------------------
-- Các FK của book_authors / collection_books / notes / book_chunks trỏ theo TÊN `books`,
-- nên tự nối lại vào bảng mới sau khi rename (cùng cách 018 đã dùng).

ALTER TABLE books_new RENAME TO books;

CREATE UNIQUE INDEX IF NOT EXISTS idx_books_sha256          ON books (sha256);
CREATE INDEX        IF NOT EXISTS idx_books_favorite        ON books (is_favorite);
CREATE INDEX        IF NOT EXISTS idx_books_reading_status  ON books (reading_status);
CREATE INDEX        IF NOT EXISTS idx_books_source          ON books (source_provider, external_id);
CREATE INDEX        IF NOT EXISTS idx_books_updated_at      ON books (updated_at);
