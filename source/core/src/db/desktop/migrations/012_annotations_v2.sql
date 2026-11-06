-- Migration 012 — annotations v2: mở rộng type cho toàn bộ markup vật lý → digital.
-- type: highlight | underline | strikethrough | freehand | textbox | stamp
-- Gom color_hex / font_family / font_size thành `style_properties` (JSON) để tránh
-- hàng loạt cột NULL khi mỗi type có thuộc tính hiển thị riêng.
-- status thu gọn 7 → 3 giá trị: None | Review | Done.
--
-- SQLite không DROP COLUMN được → rebuild table (như 008 / 009).
-- Giữ nguyên `id` để `annotation_tags` không mồ côi (migrate.ts đã tắt foreign_keys).

CREATE TABLE IF NOT EXISTS annotations_new (
  id                TEXT    PRIMARY KEY NOT NULL,
  book_id           TEXT    NOT NULL,
  page_number       INTEGER NOT NULL,
  type              TEXT    NOT NULL
    CHECK (type IN ('highlight', 'underline', 'strikethrough', 'freehand', 'textbox', 'stamp')),
  location_data     TEXT    NOT NULL,
  content           TEXT,
  style_properties  TEXT    NOT NULL DEFAULT '{}'
    CHECK (json_valid(style_properties)),
  status            TEXT    NOT NULL DEFAULT 'None'
    CHECK (status IN ('None', 'Review', 'Done')),
  is_checked        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);

INSERT INTO annotations_new (
  id, book_id, page_number, type, location_data, content,
  style_properties, status, is_checked, created_at, updated_at
)
SELECT
  id,
  book_id,
  CASE WHEN page_number < 1 THEN 1 ELSE page_number END,
  CASE lower(trim(type))
    WHEN 'typewriter' THEN 'textbox'
    WHEN 'shape' THEN 'freehand'
    WHEN 'underline' THEN 'underline'
    WHEN 'strikethrough' THEN 'strikethrough'
    WHEN 'freehand' THEN 'freehand'
    WHEN 'textbox' THEN 'textbox'
    WHEN 'stamp' THEN 'stamp'
    ELSE 'highlight'
  END,
  location_data,
  content,
  -- json_remove bỏ qua path không tồn tại → dùng '$.__keep' làm no-op.
  json_remove(
    json_object(
      'colorHex', color_hex,
      'fontFamily', font_family,
      'fontSize', font_size
    ),
    CASE WHEN color_hex IS NULL OR trim(color_hex) = '' THEN '$.colorHex' ELSE '$.__keep' END,
    CASE WHEN font_family IS NULL OR trim(font_family) = '' THEN '$.fontFamily' ELSE '$.__keep' END,
    CASE WHEN font_size IS NULL THEN '$.fontSize' ELSE '$.__keep' END
  ),
  CASE
    WHEN trim(status) IN ('Accepted', 'Completed', 'Done') THEN 'Done'
    WHEN trim(status) IN ('Deferred', 'Future', 'Review') THEN 'Review'
    ELSE 'None'
  END,
  CASE WHEN is_checked = 1 THEN 1 ELSE 0 END,
  created_at,
  updated_at
FROM annotations;

DROP TABLE annotations;

ALTER TABLE annotations_new RENAME TO annotations;

CREATE INDEX IF NOT EXISTS idx_annotations_book_id ON annotations (book_id);
CREATE INDEX IF NOT EXISTS idx_annotations_page_number ON annotations (page_number);
CREATE INDEX IF NOT EXISTS idx_annotations_type ON annotations (type);
CREATE INDEX IF NOT EXISTS idx_annotations_status ON annotations (status);
