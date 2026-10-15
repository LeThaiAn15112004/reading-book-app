-- Migration 023 — Sổ ghi nhận annotation nhúng trong file PDF đã được import vào `notes`.
--
-- Mỗi lần mở PDF, renderer quét annotation nhúng (Foxit, Acrobat…) và Main đồng bộ chúng vào `notes`
-- (xem docs/implementation_plan/pdf_embedded_annotation_import.md). File PDF không bao giờ bị ghi.
-- Bảng này nhớ annotation nhúng nào đã thành dòng `notes` nào, để:
--   - mở lại không import trùng;
--   - annotation bị sửa trong ứng dụng khác (màu, comment) thì cập nhật đúng dòng đã import;
--   - dòng người dùng đã sửa trong app (note_hash khác) không bị ghi đè;
--   - dòng người dùng đã xoá trong app (note_id không còn trong `notes`) không bị import lại.
--
--   source_key   khoá nhận dạng trong file: loại + trang + hình học làm tròn + số thứ tự trùng
--                (sdk `embeddedAnnotationKeys`; PDF.js không cung cấp /NM, còn số đối tượng "12R"
--                có thể bị đánh lại khi file được ghi lại toàn bộ).
--   note_id      dòng `notes` tương ứng. Cố ý KHÔNG có FOREIGN KEY: khi người dùng xoá dòng đó, bản
--                ghi ở đây ở lại làm "bia mộ".
--   source_hash  hash dữ liệu đọc từ file ở lần ghi gần nhất (sdk `embeddedAnnotationSourceHash`).
--   note_hash    hash nội dung dòng `notes` mà lần import gần nhất đã ghi (sdk `highlightContentHash`).
--
-- Chỉ thêm bảng mới; không đổi bảng nào hiện có. Xoá sách → xoá theo (ON DELETE CASCADE).

CREATE TABLE IF NOT EXISTS pdf_embedded_annotations (
  book_id      TEXT NOT NULL,
  source_key   TEXT NOT NULL,
  note_id      TEXT NOT NULL,
  source_hash  TEXT NOT NULL,
  note_hash    TEXT NOT NULL,
  imported_at  TEXT NOT NULL,
  synced_at    TEXT NOT NULL,
  PRIMARY KEY (book_id, source_key),
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pdf_embedded_annotations_note_id ON pdf_embedded_annotations (note_id);
