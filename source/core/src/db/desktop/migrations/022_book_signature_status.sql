-- Migration 022 — Signature status là nguồn sự thật duy nhất trong `books.metadata_json`.
--
-- Trước đây metadata_json mang { isSigned, signerName, signatureStatus, signedAt } được migration 020
-- sao chép từ các cột cũ (signature_status có DEFAULT 'unknown', is_signed DEFAULT 0). Chưa có đoạn
-- code nào từng *kiểm tra* chữ ký để ghi các giá trị đó, nên chúng chỉ là giá trị mặc định / demo,
-- không phải kết quả xác minh.
--
-- Hợp đồng mới (xem sdk `domain/book/book-signature.ts`):
--   signatureStatus        'unsigned' | 'valid' | 'invalid' | 'unsupported'   (vắng = chưa kiểm tra)
--   signerName, signedAt   chỉ có khi status là valid / invalid và đọc được
--   signatureCheckedAt     ISO-8601, lúc xác minh
--   signatureCheckedSha256 SHA-256 của đúng file đã được xác minh (khoá cache: file đổi -> xác minh lại)
--   isSigned               BỎ — dư thừa so với signatureStatus
--
-- Dữ liệu cũ: mọi khoá chữ ký cũ bị xoá và sách được coi là "chưa kiểm tra"; lần mở thông tin sách
-- kế tiếp (hoặc import mới) sẽ xác minh thật. Không giữ lại 'valid' cũ vì chưa ai xác minh nó.
-- Chỉ đụng tới dòng CHƯA có signatureCheckedAt, nên chạy lại không xoá kết quả xác minh thật.
--
-- json_remove chỉ bỏ đúng các khoá liệt kê; fileSizeBytes / pageCount / description giữ nguyên.
-- `updated_at` không đổi: đây là dọn dữ liệu, không phải chỉnh sửa của người dùng.

UPDATE books
SET metadata_json = json_remove(
  metadata_json,
  '$.isSigned',
  '$.signatureStatus',
  '$.signerName',
  '$.signedAt'
)
WHERE json_extract(metadata_json, '$.signatureCheckedAt') IS NULL
  AND (
    json_extract(metadata_json, '$.isSigned') IS NOT NULL
    OR json_extract(metadata_json, '$.signatureStatus') IS NOT NULL
    OR json_extract(metadata_json, '$.signerName') IS NOT NULL
    OR json_extract(metadata_json, '$.signedAt') IS NOT NULL
  );
