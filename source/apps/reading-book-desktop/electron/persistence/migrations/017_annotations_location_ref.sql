-- Migration 017 — annotations: page_number (INTEGER, virtual page) → location_ref (TEXT).
--
-- Ngữ nghĩa mới: location_ref KHÔNG còn là "số trang". Nó lưu CHÍNH XÁC theo cùng cơ
-- chế bookmarks.location_ref: JSON của domain Location (Location.toString()) cộng thêm
-- field `chapterIndex`, được capture "vị trí đang đọc" tại thời điểm annotation được
-- tạo (giống hệt lúc user bấm "thêm bookmark") — KHÔNG derive từ location_data của
-- chính annotation đó. Cột location_data giữ nguyên vai trò payload render chính xác
-- (packed start|end cho highlight/underline/strikethrough, JSON hình học riêng cho
-- freehand/textbox/stamp) và không còn dùng để jump nữa.
--
-- Backfill (chỉ SQL thuần — migrate.ts chạy .sql qua db.exec(), không có bước JS):
--  - highlight/underline/strikethrough: location_data = "<Location JSON start>|<Location JSON end>"
--    (Highlight.packLocation). Lấy phần trước dấu '|' đầu tiên — đã là Location.toString()
--    hợp lệ — rồi json_set thêm chapterIndex = max(COALESCE(page_number,1)-1, 0).
--    page_number NULL (epub CFI thật, xem readerHighlightPageNumber) → chapterIndex mặc
--    định 0 vì CFI thật được dùng trực tiếp để jump, chapterIndex chỉ là fallback Tier-2.
--    page_number = chapterIndex+1 (surface "fake") → khôi phục đúng chapterIndex gốc.
--  - freehand/textbox/stamp: page_number luôn là chapterIndex+1 (readerFreehandPageNumber /
--    pageNumberForLocation) — không có CFI thật. Dựng TextOffsetLocation cùng dạng mà
--    resolveCurrentReaderBookmarkLocation() dùng cho surface non-epub:
--    {"kind":"text-offset","offset":0,"blockId":"fake:<chapterIndex>","chapterIndex":<chapterIndex>}.
--  - Fallback an toàn: bất kỳ hàng nào có location_data hỏng (thiếu '|', JSON phần đầu
--    không hợp lệ) đều rơi vào nhánh ELSE (text-offset chapterIndex suy từ page_number)
--    thay vì làm hỏng toàn bộ migration.
--
-- SQLite không ALTER COLUMN đổi tên/kiểu được → rebuild table (như 008/009/012/016).

CREATE TABLE IF NOT EXISTS annotations_new (
  id                TEXT    PRIMARY KEY NOT NULL,
  book_id           TEXT    NOT NULL,
  location_ref      TEXT    NOT NULL,
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
  id, book_id, location_ref, type, location_data, content, notes,
  style_properties, status, is_checked, created_at, updated_at
)
SELECT
  id,
  book_id,
  CASE
    WHEN type IN ('highlight', 'underline', 'strikethrough')
         AND instr(location_data, '|') > 1
         AND json_valid(substr(location_data, 1, instr(location_data, '|') - 1))
    THEN json_set(
      substr(location_data, 1, instr(location_data, '|') - 1),
      '$.chapterIndex',
      max(coalesce(page_number, 1) - 1, 0)
    )
    ELSE json_object(
      'kind', 'text-offset',
      'offset', 0,
      'blockId', 'fake:' || max(coalesce(page_number, 1) - 1, 0),
      'chapterIndex', max(coalesce(page_number, 1) - 1, 0)
    )
  END,
  type,
  location_data,
  content,
  notes,
  style_properties,
  status,
  is_checked,
  created_at,
  updated_at
FROM annotations;

DROP TABLE annotations;

ALTER TABLE annotations_new RENAME TO annotations;

CREATE INDEX IF NOT EXISTS idx_annotations_book_id ON annotations (book_id);
CREATE INDEX IF NOT EXISTS idx_annotations_type ON annotations (type);
CREATE INDEX IF NOT EXISTS idx_annotations_status ON annotations (status);
