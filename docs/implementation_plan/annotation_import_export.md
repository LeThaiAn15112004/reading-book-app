# Xuất / nhập annotation (EPUB, PDF, TXT, Markdown)

Cập nhật: 2026-10-28. Đặc tả đầy đủ: `specs/006-annotation-import-export/` (`spec.md`, `plan.md`, `research.md`, `data-model.md`,
`contracts/`, `tasks.md`, `quickstart.md`, `audit.md`). File này chỉ là bản đồ.

## Làm gì

Chuyển annotation của một cuốn sách ra file rồi nhập lại vào cuốn sách đó, bằng tay, qua hộp thoại do Main sở hữu. Không áp dụng cho
audiobook, DOCX/DOC. Không gồm đồng bộ ngoài (app khác, cloud, tự động): đó là feature riêng. File sách không bao giờ bị ghi bởi tính năng này
(với PDF, đồng bộ hai chiều có sẵn có thể ghi annotation đã nhập vào file sau đó, như với mọi annotation tạo trong app).

| File | Đuôi | Nhập lại được |
|---|---|---|
| Khôi phục / sao lưu / chuyển máy | `.readmate-notes.json` | Có |
| Bản đọc (trích dẫn + ghi chú theo chương / trang / phần) | `.md` | Không |

## Cách hoạt động

- **Xuất**: đọc các dòng annotation từ SQLite (không đọc file sách, nên chạy được cả khi file sách đã bị di chuyển), dựng file bằng SDK
  (`buildAnnotationFile`), ghi nguyên tử bằng `writeFileSafely`. Sách không có annotation: không mở hộp thoại, không tạo file.
- **Nhập**: `pickFile` (mở hộp thoại, đọc và kiểm tra file theo NỘI DUNG, nhận ra sách của file, kiểm tra file sách đích, lập kế hoạch: thêm /
  đã có / không đặt được) → `setTarget` (bắt buộc khi file thuộc sách khác với sách bắt đầu nhập, hoặc sách chưa có trong thư viện) →
  `confirm`: một transaction `BEGIN IMMEDIATE` đồng bộ, kiểm tra lại preview rồi ghi tất cả hoặc không ghi gì. Preview đổi giữa chừng → `stale_preview`.
- **Chống trùng** theo khóa nội dung (loại + vị trí + câu trích + ghi chú + hình học), không theo id SQLite. Với PDF còn quét file đích để không trùng
  annotation mà app khác đã đặt trong file.
- **Đặt vị trí** (`decidePlacement`): cùng nội dung → vị trí đã lưu; PDF cùng tài liệu (cùng tên/tác giả, số trang biết và bằng nhau) → theo trang và hình
  chữ nhật; TXT khác văn bản → tìm lại theo câu trích (đúng một lần, hoặc được chọn nhờ văn bản trước/sau); Markdown, EPUB khác phiên bản và mọi trường hợp
  còn lại → báo "không đặt được", không đoán.
- **Sau khi nhập**: Reader đang mở tải lại annotation của sách (EPUB/PDF/Markdown `loadHighlights`; TXT lưu rồi `load`), không tải lại khi rollback.

## Nằm ở đâu

SDK `book-reader-sdk/src/annotation-transfer/` (`file-format`, `content-key`, `export-build`, `import-plan`, `quote-match`, `readable-markdown`);
Main `electron/annotation-transfer/` (`export-service`, `import-service`, `identify-book`) và `electron/ipc/annotation-transfer.ipc.ts`;
renderer `screens/Reader/logic/annotationTransferStore.ts`, `annotationReload.ts`, `components/annotation-transfer/ImportPreviewDialog.tsx`;
lối vào: menu More của Reader, menu sách và thanh trên của Library.

## Kiểm tra

SDK: `npx vitest run tests/annotation-transfer`. Desktop: `npm run spike:annotations:main`, `spike:annotations:store`, `spike:annotations:perf`
(đo SC-001 / SC-004 trên better-sqlite3 thật). Giao diện (menu, hộp thoại) chưa có test tự động; kiểm tra tay theo `specs/006-annotation-import-export/quickstart.md` bước 5.

## Giới hạn đã biết

- Thời gian sửa (`modified`) không khôi phục được; thời gian tạo thì có.
- Tiêu đề EPUB trong bản đọc là `Chapter N` (không có bộ đọc mục lục EPUB trong SDK hay Main).
- Annotation Ink (vẽ tay) và bookmark không nằm trong file.
