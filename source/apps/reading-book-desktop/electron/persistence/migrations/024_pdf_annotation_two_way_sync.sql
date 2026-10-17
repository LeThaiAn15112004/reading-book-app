-- Migration 024 — Đồng bộ annotation PDF hai chiều (docs/implementation_plan/pdf_annotation_two_way_sync.md).
--
-- 1. pdf_embedded_annotations: thêm ảnh chụp "base" và trạng thái xung đột cho từng cặp
--    (annotation trong file ↔ dòng `notes`).
--      base_json      JSON { file: {kind,color,text,geometry}, app: {kind,color,text,geometry} } — trạng
--                     thái hai phía ở lần đồng bộ thành công gần nhất; dùng để hợp nhất ba chiều theo
--                     từng trường. NULL ở các dòng cũ (trước 024): khi đó dùng source_hash/note_hash.
--      conflict_json  JSON { kind: 'both-changed' | 'removed-in-file', item?, fields? } — khi cả hai phía
--                     cùng sửa một trường khác nhau; cặp này bị "đóng băng" (không ghi phía nào) cho tới
--                     khi người dùng chọn. NULL = không xung đột.
-- 2. pdf_annotation_write_back: người dùng bật "ghi annotation vào file PDF" cho từng sách (mặc định
--    tắt — khi tắt, file sách không bao giờ bị ghi, đúng như trước).
--
-- Chỉ thêm cột (NULL) và bảng mới; không đổi dữ liệu hiện có.

ALTER TABLE pdf_embedded_annotations ADD COLUMN base_json TEXT;
ALTER TABLE pdf_embedded_annotations ADD COLUMN conflict_json TEXT;

CREATE TABLE IF NOT EXISTS pdf_annotation_write_back (
  book_id     TEXT PRIMARY KEY NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);
