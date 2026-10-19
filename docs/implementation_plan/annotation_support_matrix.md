# Ma trận hỗ trợ annotation theo định dạng

Cập nhật: 2026-10-19 (khảo sát bằng cách đọc code, chưa chạy app thử từng ô).

Sáu tool markup nằm trong nhóm **Annotation** của thanh công cụ Reader
(`src/screens/Reader/components/chrome/toolRegistry.ts`). Một tool chỉ hiện khi bề mặt đọc khai báo
capability `markupAnnotations` (`src/reader/capabilities.ts`).

Định dạng audio book không nằm trong bảng vì annotation trên văn bản không áp dụng được.

## Bảng

Hàng ngang: loại annotation. Hàng dọc: định dạng.

| Định dạng | Highlight | Underline | Squiggly | Strikethrough | Replace Text | Insert Text |
|---|---|---|---|---|---|---|
| **EPUB** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **PDF** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **TXT** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **MD** | ⚠️ chỉ nút | ⚠️ chỉ nút | ⚠️ chỉ nút | ⚠️ chỉ nút | ⚠️ chỉ nút | ⚠️ chỉ nút |
| **DOCX / DOC** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

Chú giải: ✅ có code tạo và vẽ annotation. ⚠️ nút hiện trên thanh công cụ nhưng chưa có xử lý nào.
❌ định dạng chưa có renderer nên thanh công cụ không hiện tool nào.

## Chi tiết theo định dạng

- **EPUB**: vẽ qua `renderers/epub/epubjs/annotation-marks.ts` và `marks-controller.ts`. Replace gạch ngang
  nét đứt, Insert gạch chân nét đứt, Squiggly gạch lượn sóng.
- **PDF**: vẽ lớp phủ `PdfAnnotationLayer.tsx`, style `.rb-pdf-annot[data-kind=…]` trong `index.css`.
  Lưu dạng `notes` với locator `page-rect` (xem `pdf_text_annotations.md`). Đồng bộ hai chiều ghi ngược vào
  file PDF qua `pdf-incremental-writer.ts`; đã thấy nhánh `Squiggly`, chưa kiểm tra Replace và Insert có được
  ghi ra file hay không.
- **TXT**: vẽ trên backdrop bằng `renderers/txt/txtMarkStyle.ts`, lưu theo offset UTF-16
  (xem `txt_reader.md`).
- **MD**: `capabilities.ts` khai báo `markupAnnotations` cho surface `md`, nhưng `renderers/md` không có
  code tạo hay vẽ annotation. Bấm tool thì tool sáng lên, kéo chọn chữ không tạo gì
  (xem `markdown_reader.md`, commit "TXT và MD hiện đủ thanh công cụ như EPUB, chỉ giao diện").
- **DOCX / DOC**: dùng canvas giữ chỗ (`placeholder`), capability chỉ có `interaction`, `snapshot`,
  `wordCount`, `readingSettings`, `pageLayout`.

## Việc còn lại

- MD: làm annotation thật (chọn cách lưu locator, vẽ mark) hoặc ẩn 6 nút cho tới khi làm.
- PDF: kiểm tra Replace và Insert có ghi ngược vào file PDF.
- DOCX / DOC: cần renderer trước khi nói tới annotation.
