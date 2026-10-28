# Ma trận hỗ trợ annotation theo định dạng

Cập nhật: 2026-10-28 (khảo sát bằng cách đọc code, chưa chạy app thử từng ô). Dòng MD sửa lại: bản ghi ngày 2026-10-19 nói MD chỉ có nút, nhưng code đã có tạo và vẽ annotation.

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
| **MD** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **DOCX / DOC** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

Chú giải: ✅ có code tạo và vẽ annotation. ⚠️ nút hiện trên thanh công cụ nhưng chưa có xử lý nào (hiện không còn ô nào như vậy).
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
- **MD**: `renderers/md/mdAnnotations.ts` (neo `(đoạn, offset)` theo `data-md-seg`, vẽ bằng CSS Custom Highlight API, không chèn gì vào
  văn bản), `MdRenderer.tsx`, `screens/Reader/logic/mdHighlights/mdHighlightsStore.ts` và `hooks/useReaderMdHighlights.ts`. Lưu dạng `notes` với
  `note_json.mdAnnotation` (SDK `md/md-annotations.ts`). Bản ghi cũ ghi sai là "chỉ nút"; ảnh chụp màn hình ngày 2026-10-28 cho thấy highlight và
  underline vẽ được. Chưa chạy từng loại trong sáu loại để xem hiển thị.
- **DOCX / DOC**: dùng canvas giữ chỗ (`placeholder`), capability chỉ có `interaction`, `snapshot`,
  `wordCount`, `readingSettings`, `pageLayout`.

## Việc còn lại

- PDF: kiểm tra Replace và Insert có ghi ngược vào file PDF.
- DOCX / DOC: cần renderer trước khi nói tới annotation.

## Xuất / nhập annotation

EPUB, PDF, TXT và Markdown đều xuất và nhập được annotation (file `.readmate-notes.json`, và bản đọc `.md`): xem `annotation_import_export.md`. DOCX / DOC chưa có annotation nên không có gì để xuất.
