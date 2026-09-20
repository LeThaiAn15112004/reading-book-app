# Thorium Reader hỗ trợ đọc những định dạng nào — và so sánh với reading-book-app

> Đọc trực tiếp mã nguồn `thorium-reader` (chủ yếu `src/r2-xxx-js/r2-shared-js/parser/`, `src/main/redux/sagas/api/publication/import/`, `src/renderer/reader/`) và `reading-book-app` (`source/apps/reading-book-desktop/electron/adapters/`, `source/apps/reading-book-desktop/src/reader/renderers/`) ngày 2026-09-03.

---

## 1. Thorium nhận diện & mở file như thế nào

Điểm vào là hàm `PublicationParsePromise()` trong `r2-shared-js/parser/publication-parser.ts` — nó thử lần lượt từng "chữ ký định dạng" theo thứ tự, file nào không khớp gì hết sẽ bị `reject("Unrecognized publication type")`:

```ts
isEPUBlication(filePath)        → EpubParsePromise
isCBZPublication(filePath)      → CbzParsePromise
isDivinaPublication(filePath)   → DivinaParsePromise
/\.webpub$/i                    → DivinaParsePromise(..., "webpub")
/\.lcpdf$/i                     → DivinaParsePromise(..., "pdf")
isDaisyPublication(filePath)    → DaisyParsePromise
isAudioBookPublication(filePath)→ AudioBookParsePromise
(không khớp gì)                 → reject "Unrecognized publication type"
```

→ Toàn bộ định dạng Thorium đọc được đều là **"publication" theo chuẩn Readium** (đóng gói sẵn, có manifest/metadata rõ ràng) — không có khái niệm "mở 1 file văn bản trần".

---

## 2. Bảng định dạng Thorium hỗ trợ

| Định dạng | Đuôi/nhận diện | Parser xử lý | Renderer hiển thị | Ghi chú |
|---|---|---|---|---|
| **EPUB** (2 & 3, reflow lẫn Fixed-Layout) | `.epub` | `r2-shared-js/parser/epub.ts` + `epub/opf-*`, `epub/ncx-*`, `epub/smil-*` (tự parse OPF/NCX/SMIL) | `r2-navigator-js` (ReadiumCSS, `<webview>`+`<iframe>`), UI ở `Reader.tsx` (178KB) | Định dạng chủ lực, được đầu tư nhiều nhất |
| **PDF** | `.pdf` | Import: convert sang `.webpub` (đóng gói kiểu Divina) trong `importFromFs.ts` | `pdf.js` bản fork riêng của EDRLab (`github:edrlab/pdf.js`), UI riêng ở `renderer/reader/pdf/` | Không dùng chung engine với EPUB — pipeline tách biệt hoàn toàn |
| **CBZ** (comic ảnh nén zip) | `.cbz` | `r2-shared-js/parser/cbz.ts` | Chung nhánh Divina/ảnh, hiển thị từng trang là 1 ảnh | Không có "text", chỉ ảnh |
| **Divina** (comic/manga chuẩn Readium JSON manifest) | thư mục/gói theo chuẩn Divina | `r2-shared-js/parser/divina.ts` | Trang dạng ảnh (giống PDF/CBZ về UX — không phải văn bản reflow) | |
| **`.webpub`** | gói Web Publication chuẩn Readium | qua nhánh Divina | tuỳ nội dung bên trong (ảnh/PDF) | Là "vỏ container", PDF cũng đi qua đây |
| **`.lcpdf`** | PDF bọc DRM Readium LCP | qua nhánh Divina, `type: "pdf"` | `pdf.js` (sau khi `r2-lcp-js` giải mã) | |
| **DAISY** (sách nói/sách cho người khiếm thị) | gói DAISY chuẩn | `daisy.ts`, dùng lại `epub-daisy-common.ts` + `daisy-convert-ncc-to-opf-ncx.ts` (~16KB) — **convert cấu trúc DAISY thành OPF/NCX giống EPUB** | **Tái sử dụng renderer EPUB** (`r2-navigator-js`) — không có renderer riêng | Thiết kế khéo: biến DAISY thành "EPUB ảo" để khỏi viết lại UI |
| **Audiobook** | manifest Audiobook chuẩn Readium | `r2-shared-js/parser/audiobook.ts` | `ReadingAudio.tsx` (32KB) — trình phát audio, không có khái niệm "trang" | |
| **DRM Readium LCP** | mọi định dạng trên đều có thể bị LCP hoá | `r2-lcp-js` giải mã trước khi streamer trả nội dung | — | Xuyên suốt mọi định dạng, không phải 1 định dạng riêng |

**Không hỗ trợ:** `.docx`, `.doc`, `.txt`, `.md`, `.xlsx`, `.pptx`, ảnh đơn lẻ ngoài context comic, hay bất kỳ file văn bản/văn phòng thuần nào.

### Nhận xét kiến trúc

- Thorium **không có 1 engine chung xử lý mọi định dạng** — thực chất có **3 pipeline render độc lập**:
  1. `r2-navigator-js` (EPUB + DAISY, vì DAISY được "hoá thân" thành EPUB ở bước parse)
  2. `pdf.js` fork riêng (PDF + LCPDF)
  3. `ReadingAudio.tsx` (Audiobook — không "render trang" mà là phát âm thanh)
  - Divina/CBZ dùng chung cơ chế hiển thị ảnh theo trang, nhẹ hơn 2 pipeline kia (không có DOM/CSS phân trang phức tạp).
- Cái hay: DAISY không viết renderer riêng mà **tái dùng lại toàn bộ engine EPUB** bằng cách convert NCC → OPF/NCX ngay ở tầng parser — giảm trùng lặp code đáng kể.
- Cái dở: PDF hoàn toàn tách biệt (dùng thư viện khác hẳn — `pdf.js` thay vì Readium engine) → 2 bộ code, 2 bộ UI settings khác nhau cho cùng 1 app (đã thấy ở câu hỏi trước: `IPdfPlayerView/Column/Scale` tách riêng khỏi `paged/colCount` của EPUB).

---

## 3. reading-book-app hỗ trợ đọc những định dạng nào

Kiến trúc app của bạn tách 2 khái niệm rất rõ ràng (theo `CLAUDE.md`):
- **Import** (`DocumentImporter`, ở `electron/adapters/*.adapter.ts`) — đưa file vào thư viện, đọc metadata.
- **Renderer** (`DocumentRenderer`, ở `src/reader/renderers/<fmt>/`) — thực sự mở ra để đọc trên màn hình Reader.

2 việc này **không nhất thiết đi cùng nhau** — và hiện tại đang lệch pha nhau khá nhiều:

| Định dạng | Có adapter import? | Có renderer để đọc? | Trạng thái thực tế |
|---|---|---|---|
| EPUB | ✅ `epub.adapter.ts` | ✅ `renderers/epub/` (dựa trên `epub.js`) | **Hoạt động đầy đủ** — annotation, highlight, freehand, typewriter... |
| PDF | ✅ `pdf.adapter.ts` | ❌ chưa có trong `renderers/` | Import được vào thư viện, **chưa mở đọc được** |
| TXT | ✅ `txt.adapter.ts` | ❌ | Tương tự — import được, chưa đọc được |
| MD | ✅ `md.adapter.ts` | ❌ | Tương tự |
| DOCX | ✅ `docx.adapter.ts` | ❌ | Tương tự |
| DOC | ✅ `doc.adapter.ts` | ❌ | Tương tự |

`src/reader/renderers/index.ts` hiện chỉ export đúng 1 renderer:
```ts
export { EpubRenderer } from './epub'
```

Domain model đã chuẩn bị sẵn cho tương lai — `Location` là value object đa hình có 3 dạng (`CfiLocation` cho EPUB, `PageRectLocation` cho PDF, `TextOffsetLocation` cho TXT/MD/DOCX) — nghĩa là **kiến trúc đã tính trước cho cả 6 định dạng**, chỉ là phần renderer UI cho PDF/TXT/MD/DOCX/DOC **chưa được triển khai** (đúng tinh thần MVP: làm EPUB cho chắc trước).

---

## 4. So sánh trực tiếp

| Tiêu chí | Thorium Reader | reading-book-app |
|---|---|---|
| Số định dạng **đọc được thật sự** hôm nay | 7 nhóm (EPUB, PDF, CBZ, Divina, webpub, DAISY, Audiobook) | 1 (chỉ EPUB) |
| Số định dạng **có kế hoạch/hạ tầng sẵn** | như trên (đã xong hết) | 6 (epub, pdf, txt, md, docx, doc) — nhưng 5/6 chưa có renderer |
| Phạm vi định dạng nhắm tới | "Sách số" / publication (không đụng văn bản văn phòng) | Vừa "sách số" (epub/pdf) vừa **văn bản văn phòng** (docx/doc/txt/md) — phạm vi rộng hơn về loại nội dung |
| Cách xử lý đa định dạng | Nhiều pipeline **tách rời hoàn toàn** theo từng họ định dạng (EPUB/DAISY dùng chung 1 engine, PDF dùng engine khác, Audio dùng UI khác) | 1 kiến trúc **port/adapter thống nhất** (`DocumentImporter`/`DocumentRenderer`/`Location` chung 1 interface cho mọi định dạng) — nhất quán hơn về lý thuyết, dù chưa lấp đầy |
| DRM | Có (Readium LCP), xuyên suốt mọi định dạng | Không thấy trong code đã đọc |
| Độ trưởng thành | Đã hoàn thiện toàn bộ pipeline, kể cả các định dạng "phụ" (DAISY, Audiobook) | Mới hoàn thiện 1/6 pipeline, còn lại đang chờ |
| Rủi ro khi mở rộng thêm định dạng | Thấp với EPUB-based (DAISY đã chứng minh tái dùng được), nhưng thêm định dạng hoàn toàn mới (VD PDF) đòi hỏi 1 bộ code riêng từ đầu (như đã làm với `pdf.js`) | Thấp hơn về mặt kiến trúc (interface đã có sẵn, thêm định dạng = thêm adapter + renderer theo khuôn có sẵn) nhưng công sức viết renderer cho PDF/TXT/MD/DOCX vẫn còn nguyên, chưa ai làm |

---

## 5. Tổng kết

- **Thorium**: hỗ trợ **nhiều định dạng "sách"** hơn hẳn (EPUB, PDF, comic, DAISY, audiobook) và **tất cả đều đã hoạt động thật**, nhưng đạt được điều đó bằng cách chấp nhận **nhiều pipeline rời rạc** (EPUB/DAISY dùng Readium engine, PDF dùng `pdf.js` riêng, Audio lại khác nữa) — không có 1 abstraction chung, mỗi định dạng gần như 1 "app con" bên trong app lớn.
- **reading-book-app**: phạm vi định dạng **tham vọng hơn** (thêm cả văn bản văn phòng — thứ Thorium hoàn toàn không đụng tới) và có **kiến trúc thống nhất hơn về lý thuyết** (1 interface `DocumentRenderer`/`Location` cho mọi định dạng), nhưng **hiện tại chỉ EPUB là dùng được** — 5 định dạng còn lại mới dừng ở bước import.

Nói ngắn gọn: Thorium **rộng và đã xong** (nhưng rời rạc về kiến trúc mỗi định dạng); reading-book-app **có nền kiến trúc gọn/nhất quán hơn nhưng còn hẹp** (mới phủ được 1/6 định dạng đã lên kế hoạch).

---

*Nguồn: phân tích tĩnh mã nguồn, không chạy thử app. Ngày: 2026-09-03.*
