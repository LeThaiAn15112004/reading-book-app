-- Migration 016 — annotations: page_number trở thành nullable (EPUB/CFI không luôn
-- tính được số trang ảo), bổ sung cột `notes` cho ghi chú tự do do người dùng gõ thêm,
-- tách biệt với `style_properties.note` (ghi chú gắn liền hiển thị của markup).
--
-- SQLite không ALTER COLUMN để bỏ NOT NULL được → rebuild table (như 008 / 009 / 012).

CREATE TABLE IF NOT EXISTS annotations_new (
  id                TEXT    PRIMARY KEY NOT NULL,
  book_id           TEXT    NOT NULL,
  page_number       INTEGER,
  type              TEXT    NOT NULL
    CHECK (type IN ('highlight', 'underline', 'strikethrough', 'freehand', 'textbox', 'stamp')),
  location_data     TEXT    NOT NULL,
  content           TEXT,
  notes             TEXT,
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
  id, book_id, page_number, type, location_data, content, notes,
  style_properties, status, is_checked, created_at, updated_at
)
SELECT
  id, book_id, page_number, type, location_data, content, NULL,
  style_properties, status, is_checked, created_at, updated_at
FROM annotations;

DROP TABLE annotations;

ALTER TABLE annotations_new RENAME TO annotations;

CREATE INDEX IF NOT EXISTS idx_annotations_book_id ON annotations (book_id);
CREATE INDEX IF NOT EXISTS idx_annotations_page_number ON annotations (page_number);
CREATE INDEX IF NOT EXISTS idx_annotations_type ON annotations (type);
CREATE INDEX IF NOT EXISTS idx_annotations_status ON annotations (status);
