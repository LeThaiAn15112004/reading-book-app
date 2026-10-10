# Tìm kiếm văn bản trong PDF (dùng lại UI/state tìm kiếm của Reader)

Tiếp nối `pdf_epub_reuse_audit.md` (mục "Search panel UI + state" và "Search index") và
`pdf_continuous_scroll.md`. Đường dẫn tính từ `source/apps/reading-book-desktop/`.

## 1. Kiểm chứng phát hiện của audit (trước khi sửa)

Trạng thái lúc kiểm tra: nhánh `anle-dev`, commit `a2d5797`, working tree sạch.

Luồng tìm kiếm thật (EPUB): nút Search trên toolbar (`ReaderScreen.handleTool('search')` →
`chrome.toggleSearch`) → `ReaderSearchPanel` → Enter → `useReaderSearch` → `bookSearchStore.search`
→ IPC `search.searchBook` → `electron/search/book-search-service.ts` (`ensureBookChunks` nếu chưa có
chunk → worker `electron/chunking/book-chunk.worker.ts` → `extract-book-text.ts`) → FTS5
`findBookMatches` (`book-search-query.ts`) → store tô kết quả và nhảy qua `EpubRendererApi`.

| # | Câu hỏi | Kết luận | Bằng chứng |
|---|---|---|---|
| 1 | `bookSearchStore` còn gọi thẳng API EPUB? | **Đúng (xác nhận)** | `paintHits` gọi `epubApiRef.current.setSearchHighlights`, `drainJumps` gọi `api.goToSearchMatch({ spineIndex, … })`, `search` lấy `getSpineSectionLabels()`, `goTo` thoát sớm khi `!isEpubSurface` |
| 2 | PDF Reader đã trích text tìm kiếm bằng PDF.js? | **Thiếu** | `extract-book-text.ts`: `CHUNKABLE_FORMATS = ['epub','txt','md']`, nhánh `default` ném lỗi; `pdf.adapter.ts` chỉ là importer theo tên file |
| 3 | Tìm trong PDF trả về text + số trang? | **Thiếu** | `ensureBookChunks` trả `unsupported` cho PDF → store `status: 'unsupported'` |
| 4 | Chọn kết quả nhảy tới đúng trang PDF? | **Thiếu** | `goTo` thoát khi `!isEpubSurface`; `PdfRendererApi` không có hàm search |
| 5 | Tô kết quả trên text layer PDF? | **Thiếu** | Không có code; chỉ EPUB có `epubSearchDom.ts` |
| 6 | PDF scan (không có text) được xử lý đúng? | **Thiếu / sẽ sai** | Khi có extractor, sách 0 chunk → `ensureBookChunks` trả `ready` (`yieldedNoText`) → `searchBook` trả `ok` với 0 kết quả, tức "No matches" như một lần tìm thành công |
| 7 | Đã có ở module khác? | **Không** | Không có module nào khác gọi pdf.js ngoài `PdfRenderer.tsx`; công cụ Search bị ẩn với PDF (`capabilities.ts`: PDF dùng bộ `placeholder`, không có `search`) |

Kết luận: audit **đúng**. Không có gì cho PDF để dùng lại ngoài UI/state chung, nên phải làm cả
5 phần còn thiếu.

## 2. Nguyên nhân gốc

- Main không trích text PDF (`electron/chunking/extract-book-text.ts`), nên PDF không có
  `book_chunks` / FTS → không có kết quả.
- Store tìm kiếm gắn cứng với `EpubRendererApi` (`screens/Reader/logic/search/bookSearchStore.ts`).
- Kết quả rỗng do "không có text" không phân biệt được với "không khớp"
  (`electron/search/book-search-service.ts`).
- PDF không có capability `search` (`reader/capabilities.ts`).

## 3. Cách làm

### Main — trích text PDF (worker thread, không chặn UI)
- `electron/chunking/pdf-text.ts` (mới): `pdfParagraphs(filePath)` dùng **pdfjs-dist 5.4.624 đã
  cài**, bản `legacy/build` (bản dành cho Node); module worker của pdf.js nạp ngay trong thread
  (`globalThis.pdfjsWorker`). Mỗi trang có text → một đoạn, `chapterIndex` = chỉ số trang 0-based.
  Text trang = `str` của từng item + `\n` sau item `hasEOL` (`pdfPageText`). Trang không có text
  không sinh đoạn nào.
- `extract-book-text.ts`: thêm `'pdf'` vào `CHUNKABLE_FORMATS` + nhánh `case 'pdf'`.
- Chạy trong worker có sẵn (`book-chunk.worker.ts`, giới hạn heap 768 MB) qua `ensureBookChunks`;
  dùng lại chunker SDK, bảng `book_chunks` + FTS5, cache kết quả và luồng `indexing` → `done`.
  **Không có migration, không có bảng mới.** File vẫn mở qua `resolveBookFile` trong Main; đường dẫn
  không bao giờ sang renderer.
- `vite.config.ts`: `pdfjs-dist` là external trong bản build Main (như `better-sqlite3`,
  `@huggingface/transformers`), worker nạp từ `node_modules` lúc chạy. Kiểm tra bundle:
  `dist-electron/extract-book-text-*.js` chứa `import("pdfjs-dist/legacy/build/pdf.mjs")`.
- `electron/chunking/pdfjs-worker.d.ts` (mới): khai báo type cho entry worker của pdf.js (gói không
  kèm `.d.ts` cho file này).

### Main — trạng thái "không có text"
- `BookSearchResultDto` thêm `{ state: 'noText' }` (`electron/ipc/api-types.ts`).
- `book-search-service.ts`: sau khi `ensureBookChunks` trả `ready` mà sách vẫn 0 chunk → `noText`.
  Áp dụng cho mọi định dạng (EPUB toàn ảnh cũng được báo đúng thay vì "No matches").

### Renderer — adapter tìm kiếm nhỏ thay vì gọi thẳng EPUB
- `bookSearchStore.ts`: context `isEpubSurface` + `epubApiRef` → `surface: BookSearchSurface | null`
  với 3 hàm: `paint(matcher | null)`, `goToMatch(match)`, `chapterLabels()`. Thêm status `noText`.
  Logic còn lại (phân trang kết quả, debounce "busy", Next/Prev, wrap, chờ indexing) giữ nguyên.
- `useReaderSearch.ts`: dựng adapter theo định dạng — EPUB gọi đúng các hàm cũ
  (`setSearchHighlights`, `goToSearchMatch({ spineIndex, occurrence, count })`,
  `getSpineSectionLabels`); PDF gọi `PdfRendererApi` mới, nhãn kết quả là `Page N`.
- `ReaderSearchPanel.tsx`: thông báo cho `noText`: "Text search isn’t available — this document has
  no selectable text (it may be a scanned PDF)." UI panel, ô nhập, trạng thái, danh sách kết quả
  dùng chung, không có UI riêng cho PDF.
- `reader/capabilities.ts`: surface `'pdf'` = bộ `placeholder` + `search`.

### Renderer — tô và nhảy tới kết quả trong PDF
- `reader/renderers/pdf/pdfSearchDom.ts` (mới): `buildPdfTextLayerIndex` dựng lại text trang từ DOM
  text layer của PDF.js (span theo item, `<br>` → `\n`) — giống hệt text Main đã index, nên "lần
  xuất hiện k của trang n" trỏ đúng chữ. Dùng lại `rangeForMatch` / `pickSectionMatch` của EPUB.
- Tô bằng **CSS Custom Highlight API** (cùng cơ chế EPUB): không chèn gì vào text layer, không lưu
  gì, không lẫn với annotation người dùng, không sửa file PDF. Tên highlight riêng
  (`rb-pdf-search-hit`, `rb-pdf-search-current`), chỉ tô nền.
- `PdfRendererApi` thêm `setSearchHighlights(matcher | null)` và
  `goToSearchMatch({ pageIndex, occurrence, count })`:
  - nhảy: cuộn tới trang (`scrollToIndex`, giữ khoá trang hiện tại), chờ text layer của trang đó
    render xong (tối đa 4 s), đánh dấu kết quả hiện tại rồi cuộn nó vào 1/3 trên của viewport nếu
    đang khuất. Lần nhảy mới hơn (Next liên tục) hoặc xoá tìm kiếm sẽ huỷ lần cũ.
  - tô lại sau mỗi lần một trang có text layer mới (cuộn, zoom render lại) và khi trang bị giải
    phóng (gộp theo rAF); xoá hết highlight khi query bị xoá / panel đóng / đổi tài liệu / unmount.

## 4. Kiểm tra

Tự động (2026-10-10):
- `npm run spike:pdf:search` (mới, `spikes/pdf-search/`) — **9/9 qua**. Fixture tự sinh (không cần
  công cụ ngoài): `text.pdf` 3 trang (trang 2 có 3 chữ "fox"), `scanned.pdf` 2 trang chỉ có ảnh.
  Kiểm: trích text bằng pdf.js thật; `findBookMatches` thật của Main cho số trang, thứ hạng trong
  trang, nhiều kết quả trên một trang, cụm từ qua xuống dòng; text dựng lại từ cấu trúc DOM của
  TextLayer khớp đúng text Main; thứ hạng k chọn đúng chữ thứ k; đổi query / phân biệt hoa thường /
  nguyên từ / không khớp; PDF scan không sinh đoạn nào và trạng thái `noText` được nối tới panel.
- `npm run spike:reader:toolbar` — 19/19 qua (thêm kiểm surface `pdf` = placeholder + search).
- `npm run typecheck` — qua.
- `npm run lint` — 12 lỗi / 14 cảnh báo, **đều có từ trước** (không đổi so với trước thay đổi).
- `npx vite build` — qua.
- Repo không có test runner; các spike trên là bộ kiểm tra của dự án.

**Chưa kiểm tra khi chạy app (Electron):** tô highlight thật trên text layer, cuộn tới kết quả,
highlight sau zoom, worker thread trích PDF trong Electron, PDF scan thật, PDF rất lớn, hồi quy tìm
kiếm EPUB trong app. Logic EPUB chỉ đổi đường gọi (adapter gọi đúng các hàm cũ với đúng tham số).

## 5. Hạn chế còn lại

- Sách PDF cũ chưa có chunk sẽ được index lần đầu khi mở (chạy nền); PDF đã có chunk 0 dòng không
  tồn tại trước đây vì PDF chưa từng được index.
- Chỉ dùng text layer có sẵn; PDF scan báo "không có text" — OCR ngoài phạm vi.
- PDF có text nhưng thứ tự item lạ (nhiều cột, xoay chữ) vẫn khớp được vì hai phía dùng cùng thứ tự
  item, nhưng snippet có thể ghép chữ của các cột.
- Trang có hơn 100 000 text div: PDF.js tự cắt bớt span → thứ hạng có thể lệch; `pickSectionMatch`
  rơi về vị trí tương đối.
- Trích text cả cuốn chạy trong worker (không chặn UI) nhưng PDF rất lớn sẽ mất thời gian trước
  khi tìm được ("Preparing this book for search…").
- `yieldedNoText` chỉ nhớ trong phiên: mỗi lần mở app, PDF scan được trích lại một lần (hành vi sẵn
  có với EPUB toàn ảnh).
- Word Count cho PDF giờ có dữ liệu; với PDF scan vẫn hiện trạng thái hiện có của Word Count cho
  sách 0 chunk (chưa đổi).
- Nếu đang chạy `npm run dev` thì cần khởi động lại để `vite.config.ts` (external `pdfjs-dist`) có
  hiệu lực.
