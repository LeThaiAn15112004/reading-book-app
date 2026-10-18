-- Migration 025 — TXT reader: bản sao làm việc đã chỉnh sửa (docs/implementation_plan/txt_reader.md).
--
-- Nội dung TXT KHÔNG nằm trong SQLite: file gốc của người dùng không bao giờ bị ghi; văn bản đã sửa
-- là một file UTF-8 do app quản lý ở `{userData}/txt-edits/{book_id}/r{revision}.txt`. Bảng này chỉ
-- ghi "revision nào đang là bản chính thức" để cập nhật annotation (offset trong `notes.note_json
-- .txtAnnotation`) và revision nguyên tử trong cùng MỘT transaction: offset trong DB luôn khớp đúng
-- file revision đó, kể cả khi app bị tắt giữa chừng.
--
--   revision        1, 2, 3 … mỗi lần văn bản đổi +1 (0 = chưa sửa lần nào = chưa có dòng nào ở đây)
--   content_sha256  SHA-256 của file revision → phát hiện file bị hỏng / bị xoá tay
--   char_count      số đơn vị UTF-16 của văn bản
--   source_sha256   SHA-256 file gốc tại lúc bắt đầu sửa → báo "file gốc đã đổi ngoài Readmate"
--
-- Chỉ thêm bảng mới; không đổi dữ liệu hiện có. Xoá sách xoá luôn dòng này (ON DELETE CASCADE);
-- thư mục file do hàm xoá sách ở Main dọn.

CREATE TABLE IF NOT EXISTS txt_documents (
  book_id         TEXT    PRIMARY KEY NOT NULL,
  revision        INTEGER NOT NULL CHECK (revision >= 1),
  content_sha256  TEXT    NOT NULL,
  char_count      INTEGER NOT NULL CHECK (char_count >= 0),
  source_sha256   TEXT,
  updated_at      TEXT    NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);
