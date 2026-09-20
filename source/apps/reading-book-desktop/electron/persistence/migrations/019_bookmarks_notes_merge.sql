-- Migration 019 — Gộp `bookmarks` vào `notes` (tiếp nối 018), theo đúng model Thorium
-- Reader: `notes.note_json.group` (`'annotation'` | `'bookmark'`) phân biệt 2 loại, thay vì
-- một bảng SQL riêng cho từng loại.
--
-- 1) Các row `notes` sinh ra từ 018 (annotations cũ) chưa có key `group` trong note_json ->
--    backfill `group = 'annotation'` để mọi row trong bảng đều có discriminator tường minh.
-- 2) Convert từng row `bookmarks` -> 1 row `notes` với `type = 'bookmark'`,
--    `group = 'bookmark'`, `locatorExtended.locator` lấy từ `location_ref` (giống hệt cách
--    018 map `annotations.location_ref`), `label`/`textualValue` lấy từ `label`/`excerpt`.
--    `bookmarks` không có cột `updated_at` -> dùng `created_at` cho cả hai.
-- 3) Drop bảng `bookmarks`.
-- 4) Thêm expression index trên `note_json ->> 'group'` để listAnnotations/listBookmarks lọc
--    theo group không phải quét full table scan khi bảng notes lớn dần.

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------------------
-- 1) Backfill group cho các row đã có từ 018
-- ---------------------------------------------------------------------------

UPDATE notes
SET note_json = json_set(note_json, '$.group', 'annotation')
WHERE json_extract(note_json, '$.group') IS NULL;

-- ---------------------------------------------------------------------------
-- 2) bookmarks -> notes
-- ---------------------------------------------------------------------------

INSERT INTO notes (id, book_id, note_json, created_at, updated_at)
SELECT
  bm.id,
  bm.book_id,
  json_object(
    'schemaVersion', 1,
    'type', 'bookmark',
    'group', 'bookmark',
    'locatorExtended', json_object(
      'locator', json(bm.location_ref)
    ),
    'textualValue', bm.excerpt,
    'label', bm.label,
    'created', bm.created_at
  ),
  bm.created_at,
  bm.created_at
FROM bookmarks bm;

-- ---------------------------------------------------------------------------
-- 3) Drop bookmarks
-- ---------------------------------------------------------------------------

DROP TABLE bookmarks;

-- ---------------------------------------------------------------------------
-- 4) Index lọc theo group
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_notes_group ON notes (json_extract(note_json, '$.group'));

PRAGMA foreign_keys = ON;
