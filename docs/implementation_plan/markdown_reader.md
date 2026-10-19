# Markdown reader — khảo sát & kế hoạch (Giai đoạn 1)

Ngày: 2026-10-18. Trạng thái: **chỉ khảo sát + kế hoạch**. Chưa có code chức năng, dependency, migration nào được thêm.
Trạng thái Git lúc bắt đầu: nhánh `anle-dev`, working tree sạch (`git status` rỗng). Không có `AGENTS.md` trong repo; tài liệu đã đọc:
`CLAUDE.md`, `docs/implementation_plan/txt_reader.md` (tiền lệ gần nhất), cùng mã nguồn liệt kê ở §2.

Quy ước: **[đã xác minh]** = đã mở code; **[chưa xác minh]** = suy luận, cần kiểm khi triển khai.

---

## 1. Tóm tắt kiến trúc hiện tại

```
Import (dialog / URL / cloud)
  → assertSupportedExtension (whitelist từ packages/config/formats.ts)
  → hashFile SHA-256 → findBySha256 (trùng → ImportResult 'duplicate')
  → getDocumentImporter(format).extract  (md = filename stub)
  → persist books row (file local = tham chiếu tại chỗ, URL/cloud = copy vào {userData}/books/{uuid}/)
Library  → thẻ sách (+ bìa tự sinh generateBookCover)
Reader   → ReaderScreen chọn surface theo book.bookFormat:
           epub → EpubRenderer, pdf → PdfRenderer, txt → TxtRenderer, còn lại → ReadingCanvas (placeholder)
Overlay  → bảng `notes` (note_json) cho highlight/underline/strikethrough/note/bookmark;
           vị trí đọc ở books.reading_state_json (overlay:saveSessionState)
```

**Phân biệt "import được" và "đọc được" cho `.md`:**

| Khâu | `.md` hôm nay | Bằng chứng |
|---|---|---|
| Whitelist phần mở rộng | **Có** (`.md`, mime `text/markdown`) | `packages/config/formats.ts`; `electron/files/format-guard.ts` → `assertSupportedExtension` |
| Enum định dạng | **Có** `DocumentFormat.Md` | `book-reader-sdk/src/domain/book/document-format.ts` |
| Importer | **Stub** theo tên file (title từ filename) | `electron/adapters/md.adapter.ts` = `createFilenameFallbackImporter(DocumentFormat.Md)`, đăng ký ở `importer-registry.ts` |
| Chống trùng | **Có** (SHA-256) | `import.ipc.ts` `findBySha256` → `duplicateResult` |
| Mở file | **Có ở mức byte**: `openBookContent` đọc file, trả `ArrayBuffer` (chỉ TXT bị loại trừ) | `electron/files/open-book-content.ts` |
| Render | **Không** — rơi vào `ReadingCanvas` placeholder | `ReaderScreen.tsx` (nhánh `else` sau `txt`); `reader/capabilities.ts` `readerSurfaceForFormat` trả `'placeholder'` |
| Bìa | Có (regex bỏ ký tự `#>*-`, vẽ chữ) | `Library/logic/generateBookCover.ts` case `'md'` |
| Index tìm kiếm / đếm từ | Có nhưng **trên nguồn thô** | `chunking/extract-book-text.ts` `case 'md'` → `plainTextParagraphs(readFile utf8)` |
| Annotation | **Không** | không có surface |

Kết luận: import `.md` đã chạy; *đọc/render/annotation Markdown chưa tồn tại*.

---

## 2. Bằng chứng từ codebase

| File / symbol | Vai trò thực tế |
|---|---|
| `packages/config/formats.ts` `SUPPORTED_FORMATS`, `resolveFormatFromExtension` | Nguồn duy nhất khai báo định dạng + phần mở rộng + mime |
| `electron/files/format-guard.ts` | Kiểm tra phần mở rộng (file/URL) → `unsupported_format` |
| `electron/ipc/import.ipc.ts` `importFromFile`, `finishImportByReference`, `finishImport` | Dialog Main-owned; file local lưu tham chiếu (`books.file_path`), không copy; URL/cloud: temp → hash → dedupe → `copyIntoBooksSandbox` |
| `electron/adapters/importer-registry.ts`, `filename-fallback-importer.ts` | Map `DocumentFormat` → `DocumentImporter`; `buildImportResult` hash + title fallback |
| `electron/files/sandbox.ts` `resolveBookFile` | Xác thực đường dẫn (managed/referenced), phân biệt `missing_file`/`path_denied` |
| `electron/files/open-book-content.ts` | Trả bytes + ghi `servedSha256`; TXT trả buffer rỗng vì đọc qua `txt:open` |
| `src/reader/capabilities.ts` | `ReaderSurface = 'epub'｜'pdf'｜'txt'｜'placeholder'`; bảng capability theo surface (toolbar ẩn tool thiếu capability) |
| `src/screens/Reader/ReaderScreen.tsx` | Shell: `useReaderTxt` (`isTxtSurface`), chọn renderer, nối session/percent/toolbar |
| `src/reader/renderers/txt/TxtRenderer.tsx` + `screens/Reader/logic/txtDocument/txtDocumentStore.ts` | Tiền lệ: surface text liên tục, mark theo offset, menu chọn văn bản, vị trí đọc `text-offset` |
| `book-reader-sdk/src/txt/*` (`txt-annotations.ts`, `txt-text.ts`, `txt-segments.ts`…) | Logic thuần (offset UTF-16, `isValidTxtRange`, `isCodePointBoundary`, `quoteMatchesText`, `splitAnnotationsByText`) |
| `book-reader-sdk/src/domain/annotation/note.ts` `INoteState` | `note_json`: `locatorExtended.locator` (jump target) + `pdfAnnotation` / `txtAnnotation` riêng từng định dạng |
| `electron/persistence/sqlite-overlay-store.ts` | Đọc/ghi `notes`; parse `pdfAnnotation`/`txtAnnotation`; `migrations/018_notes_thorium.sql` (bảng `notes` hiện hành: `id, book_id, note_json, created_at, updated_at`, FK `ON DELETE CASCADE`) |
| `book-reader-sdk/src/app-models/highlight-citation.ts` `formatHighlightCitation` | "Copy with Citation": `"quote" — Title, Author (locationLabel)` |
| `ReaderScreen.tsx` (~941, 980, 1013) | Mỗi định dạng tự cấp `locationLabel`: EPUB = nhãn chương, PDF = trang |
| `src/screens/Reader/components/highlights/HighlightContextMenu.tsx` | Menu chọn văn bản dùng chung (Highlight/Underline/Strikethrough/Note/Copy/Citation) |
| `electron/persistence/migrations/` | 001–025; 025 = `txt_documents` |
| `package.json` (desktop) | Đã có `react-markdown ^10.1.0` — **không file nào trong `src/`, `electron/`, `spikes/`, `e2e/` import nó** |
| `e2e/`, `package.json` scripts | `e2e`, `e2e:only`, `e2e:txt`, `e2e:typecheck`; không có `pretest/posttest/prepare`; chỉ `postinstall: electron-builder install-app-deps`; không thấy `.husky` |

**Cách định vị annotation hiện có [đã xác minh qua code + docs]:**

| Định dạng | Dữ liệu vị trí lưu |
|---|---|
| EPUB | CFI (`locatorExtended.locator`, `cfi`) + `text` (quote + ngữ cảnh) |
| PDF | locator `page-rect` (trang 1-based) + `pdfAnnotation.pageIndex` (0-based) + `rects` chuẩn hoá 0–1 theo page box |
| TXT | locator `text-offset` ở `startOffset` + `txtAnnotation {startOffset,endOffset}` (UTF-16, nửa mở) + quote ở `locatorExtended.text` |

---

## 3. Đánh giá khả năng tái sử dụng

| Thành phần | Tái sử dụng? | Giới hạn / lý do |
|---|---|---|
| Import, whitelist, dedupe, sandbox, `resolveBookFile` | **Nguyên vẹn** | Đã hoạt động cho `.md`; chỉ cần importer tốt hơn (tuỳ chọn) |
| `openBookContent` (bytes) | **Dùng được** | `.md` nhỏ; giải mã UTF-8 ở renderer (như cover). Không cần IPC mới nếu không sửa file |
| `notes` table + `INoteState` + overlay store | **Dùng lại, thêm field JSON** | `note_json` mở → thêm `mdAnnotation` không cần migration |
| `overlay:saveHighlight` | **Cần mở rộng** | TXT bị chặn đi đường này (có commit riêng); Markdown không sửa văn bản nên đi đường save thường + validate `mdAnnotation` ở Main |
| `HighlightContextMenu`, popup note/edit, sidebar Notes, `formatHighlightCitation` | **Dùng lại** | Nhận `ReaderHighlightBase`; chỉ cần adapter dữ liệu MD + `locationLabel` (tiêu đề gần nhất) |
| `capabilities.ts` | **Mở rộng** | Thêm surface `'md'`; sửa `readerSurfaceForFormat` |
| Pref font/cỡ/giãn dòng/lề/theme | **Dùng lại** | TXT đã dùng pref hiện có (txt_reader.md §6) |
| Vị trí đọc `reading_state_json` + `overlay:saveSessionState` | **Dùng lại** | `text-offset` Location đã có |
| Logic offset của `book-reader-sdk/src/txt/*` | **Tham khảo / tách chung từng hàm** | `isCodePointBoundary`, `quoteMatchesText`, rule "quote hết khớp → ẩn" áp dụng được; **rule sửa văn bản (`planAnnotationEdit`) không áp dụng** (MD không sửa trong app) |
| `TxtRenderer` (textarea + backdrop) | **Không** | Cơ chế đó dành cho text thuần; MD cần DOM có cấu trúc |
| EPUB CFI / epubjs, PDF.js text layer, `page-rect` | **Không** | Gắn riêng định dạng |
| Chunking/FTS `case 'md'` | **Dùng được nhưng lệch** | Offset chunk là offset trên *nguồn thô*, không phải văn bản render → search hit không thể sơn lên trang (ngoài phạm vi) |
| `generateBookCover` md | Dùng nguyên | Có thể cải thiện sau |

---

## 4. Thiết kế Markdown Reader đề xuất

- **Surface mới `'md'`** (`src/reader/renderers/md/MdRenderer.tsx`), cuộn dọc tự nhiên, **chỉ đọc** (không sửa file, không working copy).
- **Luồng**: `openBookContent(bookId)` → bytes → bỏ BOM, giải mã UTF-8, chuẩn hoá `\r\n`/`\r` → `\n` → parse remark → hast → React. Hash `servedSha256` có sẵn để phát hiện file đổi.
- **Quản lý nội dung**: store zustand `mdDocumentStore` (theo ưu tiên của user: custom hook dùng zustand) giữ `source`, `plainText`, `segments`, `annotations`, trạng thái `loading|ready|error`; lỗi `missing_file`/`read_failed` hiển thị như các reader khác.
- **Vị trí đọc**: `text-offset` Location (`blockId: 'md'`) = offset (trong plain text, §5) của dòng đầu thấy được; khôi phục bằng cách tìm span chứa offset rồi `scrollIntoView`. Độc lập font/chiều rộng.
- **Giao diện**: dùng lại pref hiện có; typography Markdown (heading, bảng, code) qua CSS `md.css` dùng token theme; capability `['markupAnnotations','snapshot','wordCount','readingSettings']` (+ `pageLayout`/TOC từ heading ở pha sau — cách sidebar TOC nhận dữ liệu chưa xác minh).
- **Ảnh tương đối**: protocol Main-owned `rb-md-asset://{bookId}/{relPath}` (mẫu `electron/files/cover-protocol.ts`), chỉ phục vụ file ảnh (png/jpg/gif/webp/svg-as-image) nằm **trong thư mục chứa file `.md`**, resolve symlink, từ chối `..`/tuyệt đối; renderer không bao giờ thấy đường dẫn thật. Ảnh http(s) từ xa **mặc định chặn** (local-first, riêng tư) — xem câu hỏi Q3. Với sách `managed` (URL/cloud) không có ảnh đi kèm → hiện placeholder.
- **Liên kết**: `#anchor` cuộn nội bộ; `http/https/mailto` mở qua Main `shell.openExternal` (allowlist scheme); các scheme khác bỏ.

---

## 5. Thiết kế annotation đề xuất

### 5.1 So sánh phương án định vị

| Phương án | Ưu | Nhược | Kết luận |
|---|---|---|---|
| 1. Offset trong **file nguồn** | Ổn định về mặt "file"; gần TXT | Vùng chọn là DOM đã render: `**`, `#`, escape `\*`, entity `&amp;`, link `[x](url)` làm 1 ký tự render ≠ N ký tự nguồn → ánh xạ DOM→nguồn không 1-1 trong text node; code block/bảng càng khó | Không dùng làm khoá chính |
| 2. Offset trong **plain text sau render** | DOM→offset chính xác, không phụ thuộc font/chiều rộng/theme; test được thuần | Đổi nguồn (thêm `*` bold) không đổi plain text → bền; nhưng thêm/xoá chữ làm lệch offset phía sau | **Khoá chính** |
| 3. Block id + offset cục bộ | Chịu chèn đoạn ở trước | Block id/thứ tự đổi khi sửa file; cần định danh ổn định | Chỉ làm **chỉ dẫn phụ** |
| 4. Kết hợp: offset + quote + prefix/suffix + block fingerprint + nguồn | Xác minh được, khôi phục có kiểm chứng | Nhiều field | **Đề xuất** (offset là khoá, phần còn lại để xác minh/định vị lại) |

### 5.2 Mô hình
- **Plain text chuẩn (P)**: nối giá trị các text node của hast theo thứ tự tài liệu; thêm đúng một `\n` giữa các block (đoạn, heading, mục danh sách, ô bảng ngăn bằng `\t`/`\n` — quy tắc cố định, ghi trong SDK). Code block giữ nguyên chữ; ảnh đóng góp `alt` hoặc rỗng (quy tắc cố định). Không chuẩn hoá Unicode (NFC/NFD), để tiếng Việt và dấu kết hợp nguyên vẹn, như TXT.
- **Offset** = chỉ số UTF-16 trong P, **nửa mở `[start,end)`**; không cắt giữa cặp surrogate (tái dùng `isCodePointBoundary`); nên snap thêm theo grapheme (`Intl.Segmenter`) để không cắt giữa dấu kết hợp/emoji ghép — [chưa xác minh] hỗ trợ trong Electron 39 (Chromium có sẵn, nhưng cần test).
- **DOM→offset**: plugin rehype bọc mỗi text node có nội dung trong `<span data-mdo="{start trong P}">`. Offset DOM của `Range` là **chỉ số trong text node**, không phải trong đoạn; nên `offset = Number(span.dataset.mdo) + range.startOffset`. Vùng chọn qua nhiều node (chữ thường + in đậm), nhiều đoạn, nhiều block: lấy offset đầu/cuối riêng rồi sinh range liên tục trong P; tô lại bằng cách chia range theo từng span (như `txtGeometry`/marks). Text node nằm trong code block/bảng cũng đi cùng cơ chế.
- **Hàm thuần trong SDK** (không import remark): nhận danh sách `segments [{start, text, blockIndex}]` từ renderer → `offsetsFromSelection`, `quoteMatchesText`, `splitAnnotationsByText`, `relocate`. Tuân thủ quy tắc "SDK không import engine định dạng".

### 5.3 Dữ liệu lưu (`notes.note_json`, không đổi schema)
```
locatorExtended.locator = { kind:'text-offset', offset:<start>, blockId:'md', chapterIndex:0 }
locatorExtended.text    = { highlight:<quote>, before:<~32 ký tự>, after:<~32 ký tự> }   // dùng NoteSelectionText hiện có
mdAnnotation = {
  startOffset, endOffset,          // trong P, UTF-16, [start,end)
  blockOrdinal, blockHash,         // thứ tự + hash văn bản của block chứa start (chỉ dẫn phụ)
  sourceStart?, sourceEnd?         // offset nguồn (mdast position) — chỉ để "Mở tại dòng", không dùng để khôi phục
  planVersion: 1                   // phiên bản quy tắc dựng P
}
```
`planVersion` cho phép đổi quy tắc dựng P sau này mà biết rằng row cũ cần relocate bằng quote.

### 5.4 Khôi phục & nội dung bị đổi
1. Dựng P → với mỗi annotation: nếu `P.startsWith(quote, startOffset)` và `before/after` khớp → **khôi phục tại chỗ**.
2. Không khớp (file `.md` bị sửa ngoài app): tìm `before+quote+after` trong P; **đúng một** kết quả → gắn lại (đánh dấu "đã định vị lại" trong thông báo); 0 hoặc >1 kết quả → **ẩn, không xoá, không đoán**, có notice; row vẫn nằm trong SQLite và hiện lại nếu văn bản khớp trở lại (đồng nhất với TXT).
3. Đổi font/cỡ/chiều rộng/theme không ảnh hưởng vì khoá nằm ở P, không ở pixel/DOM/ID block. Render lại không làm đổi `data-mdo` vì sinh từ hast xác định.
4. Quy tắc (2) là điểm chốt cần chủ dự án duyệt (Q1).

### 5.5 Vòng đời
Ghi qua `overlay:saveHighlight` (mở rộng parse/validate `mdAnnotation` ở Main: số nguyên, `0 ≤ start < end`, giới hạn độ dài quote/ref như `TXT_ANNOTATION_MAX_REF_LENGTH`; Main không parse Markdown nên **không** kiểm quote — việc đó ở renderer lúc khôi phục). UI cập nhật lạc quan từ store, đồng bộ với DB theo kiểu `highlightsStore` hiện có [cách chính xác của store EPUB chưa đọc kỹ — chưa xác minh]. Copy / Copy with Citation: `formatHighlightCitation` với `locationLabel` = heading gần nhất phía trước.

---

## 6. Đánh giá thư viện (chưa cài gì)

| Tiêu chí | **react-markdown 10 + remark/unified (đề xuất)** | markdown-it |
|---|---|---|
| Có sẵn trong repo | **Có** (`react-markdown ^10.1.0`, kèm `remark-parse 11`, `mdast-util-*`, `unified 11`, `hast-util-to-jsx-runtime` trong `node_modules`; chưa dùng ở đâu) | Không |
| Tích hợp React | Native: AST → JSX, không `dangerouslySetInnerHTML` | Sinh HTML string → phải `dangerouslySetInnerHTML` hoặc thêm lớp chuyển đổi |
| AST + vị trí nguồn | mdast/hast có `position.start/end.offset` (offset ký tự thật) | Token chỉ có `map` theo dòng |
| Plugin rehype tự viết (bọc text node) | Tự nhiên | Không có khái niệm tương đương |
| HTML nhúng | **Mặc định bỏ qua** (không cần `rehype-raw`) → XSS bề mặt nhỏ nhất | `html:false` mới an toàn, phải đúng cấu hình |
| URL | `urlTransform` mặc định lọc scheme nguy hiểm; ta ghi đè allowlist | Phải tự `validateLink` |
| Bảng | Cần `remark-gfm` — **chưa cài** (dependency mới, Q2) | Có sẵn (`table`) |
| Chạy local, không API | Có | Có |

**Đề xuất**: giữ `react-markdown` + thêm `remark-gfm` (một dependency, chỉ khi duyệt). Không bật HTML nhúng ở MVP; không script/iframe/style từ file. Rủi ro/hạn chế: hast không giữ vị trí cho text node sau các transform → ta tính P từ hast *của chính pipeline đã dùng để render* (một nguồn sự thật); phải ghim phiên bản để quy tắc dựng P không đổi ngầm (có `planVersion`).
CSP: không tìm thấy thẻ/header Content-Security-Policy trong `index.html`/`main.ts` [chưa xác minh toàn bộ] — nên rà trước khi cho phép ảnh, vì ảnh đi qua protocol riêng.

---

## 7. Đề xuất database

- **Annotation: không cần migration.** `notes.note_json` mở; thêm key `mdAnnotation`; phân biệt với EPUB/PDF/TXT bằng chính sự có mặt của `mdAnnotation` + `locatorExtended.locator.blockId === 'md'` (cùng cách TXT/PDF tự phân biệt hôm nay). Xoá sách cascade như hiện nay.
- **Vị trí đọc**: `books.reading_state_json` hiện có.
- **Không cần bảng như `txt_documents`** (không sửa nội dung). Phát hiện "file đổi" dùng `books.sha256`/`servedSha256` sẵn có.
- **Cache P**: tính lại mỗi lần mở (parse file vài trăm KB ~ mili-giây [chưa đo]); lưu cache chỉ thêm độ phức tạp (invalidation, schema) → **không làm**, trừ khi đo thấy file lớn chậm; ngưỡng cảnh báo kích thước đề xuất 5 MB (Q4).
- **Ảnh tương đối**: không lưu gì vào DB; resolve lúc chạy trong Main theo thư mục của `books.file_path` (referenced). Nếu người dùng di chuyển file `.md`, `library:relinkBook` hiện có xử lý file chính; ảnh tự theo thư mục mới.
- Không đụng dữ liệu sách/annotation cũ: chỉ đọc thêm key mới, parse của các định dạng khác bỏ qua key lạ (cùng cơ chế TXT đã chứng minh trên DB có dữ liệu).
- Điểm cần xử lý: chunking/FTS cho `md` nên đổi sang văn bản P (hoặc bỏ cú pháp) để từ khoá không khớp `**`/URL; thay đổi này **ngoài đợt đầu** hoặc làm cuối (ảnh hưởng chỉ mục).

---

## 8. Kế hoạch triển khai theo giai đoạn

| # | Đầu việc | Phụ thuộc | Hoàn thành khi |
|---|---|---|---|
| M0 | Chốt Q1–Q5 | — | Chủ dự án trả lời |
| M1 | SDK `md/`: dựng P từ `segments`, `offsetsFromSelection`, `quoteMatchesText`, `relocate`, `splitAnnotationsByText`, kiểu `MdAnnotation` + `INoteState.mdAnnotation` | M0 | Vitest xanh (xem §9), `typecheck` SDK |
| M2 | Surface `'md'` trong `capabilities.ts` + `MdRenderer` render cơ bản (heading, đoạn, list, link, code) + store, trạng thái loading/lỗi | M1 | Mở `.md` thấy nội dung, không còn placeholder; `typecheck`/`lint` desktop |
| M3 | Plugin rehype `data-mdo` + bảng (`remark-gfm` nếu duyệt) + CSS typography theo theme/pref | M2 | Đổi theme/font/cỡ không đổi P (test thuần + spike) |
| M4 | Ảnh tương đối qua protocol Main-owned + chính sách link/HTML | M2 | Spike Main: chặn `..`, symlink, ngoài thư mục; E2E ảnh hiển thị |
| M5 | Vị trí đọc `text-offset` (session autosave) | M2 | Đóng/mở khôi phục đúng đoạn |
| M6 | Annotation: chọn vùng → offset, menu dùng chung, tô mark, note popup, sidebar, citation | M1, M3 | 4 loại mark + khôi phục sau restart |
| M7 | Validate `mdAnnotation` ở Main (`overlay:saveHighlight`) | M1 | Spike Main từ chối ref sai |
| M8 | Khôi phục có xác minh + relocate + notice ẩn | M6, M7 | Test sửa file ngoài app (§9) |
| M9 | (Sau) TOC từ heading, search hit, chunk FTS dùng P | M6 | Theo yêu cầu riêng |

Mỗi bước nhỏ, commit riêng; M3–M5 có thể song song sau M2.

---

## 9. Kế hoạch kiểm thử

| Mức | Nội dung | Cách chạy / cô lập |
|---|---|---|
| Unit (SDK, vitest, `tests/md/*`) | Dựng P: `# `, `**bold**`, `*i*`, inline code, code block, bảng, danh sách; tiếng Việt NFC & NFD, emoji, ZWJ; offset UTF-16 nửa mở; không cắt surrogate/grapheme; vùng chọn qua nhiều node/đoạn; relocate duy nhất/không duy nhất/không có; sửa file (thêm/xoá trước & sau); randomised oracle như TXT | `cd source/apps/book-reader-sdk && npm test` |
| Integration (Main) | `spike:md:main` (mới, mẫu `spike:txt:main`): `overlay:saveHighlight` với `mdAnnotation` hợp lệ/sai, DB đã migrate, dữ liệu EPUB/PDF/TXT cũ nguyên vẹn, protocol ảnh (path traversal, symlink, thư mục ngoài) trên file tạm | Node script, thư mục tạm, không mở Electron window |
| Integration (renderer store) | `spike:md:store` (mới): store thật + service giả, khôi phục/ẩn/relocate | Node script |
| Kiểu/lint | `typecheck`, `lint`, `e2e:typecheck`, `npx vite build` | Thủ công, không E2E |
| E2E (`e2e/specs/md-reader.spec.ts`, mới) | render các thành phần, ảnh, link, XSS (`<script>`, `<img onerror>` trong .md phải vô hiệu), 4 loại annotation, restart giữ vị trí & annotation, sửa file ngoài app | `npm run e2e:only -- md-` **chỉ khi người dùng yêu cầu** |

**Cô lập E2E [đã xác minh]**: `e2e/fixtures/app.ts` chạy với `userData` riêng trong `os.tmpdir()` (từ chối nếu không), fixture sinh tại chỗ, 1 worker, mặc định *hidden mode* (`READMATE_E2E_HIDDEN=1`, `E2E_HIDDEN` trong `electron/main.ts`, không `show()/focus()`); không có profile/DB dùng chung với phiên thật. Không script nào trong `dev`, HMR, hook, `postinstall`, CI chạy E2E; `.claude/settings.local.json` đặt lệnh E2E ở `permissions.ask`. Việc đã làm: **không chạy E2E** ở giai đoạn này; không cấu hình watcher/auto-run. `spike:reader:toolbar` hiện dùng Markdown làm mẫu "placeholder" (theo `txt_reader.md` §9) → phải cập nhật khi M2 hoàn tất (CI không chạy spike này nhưng cần sửa để khỏi sai).

---

## 10. Rủi ro và câu hỏi cần quyết định

**Rủi ro thật sự**
1. Sai lệch giữa P tính từ hast và chữ trên DOM (khoảng trắng giữa phần tử, `<br>`, ô bảng) → offset lệch. Giảm thiểu: một hàm dựng duy nhất + test so DOM thật trong spike/E2E.
2. Nâng cấp `react-markdown`/`remark` làm đổi cây → đổi P. Giảm thiểu: ghim phiên bản + `planVersion` + relocate bằng quote.
3. Cắt giữa grapheme/dấu kết hợp tiếng Việt (NFD) → snap grapheme.
4. Ảnh/link là bề mặt tấn công (path traversal, scheme lạ, tracking pixel từ xa).

**Quyết định đã chốt (2026-10-18): chấp nhận đề xuất mặc định cho Q1–Q5** — Q1 tự định vị lại khi khớp duy nhất; Q2 thêm `remark-gfm`; Q3 chặn ảnh http(s) từ xa; Q4 ngưỡng 5 MB; Q5 bỏ HTML nhúng. M0 hoàn thành.

**Câu hỏi đã được quyết (giữ lại để tham chiếu)**
- **Q1.** File `.md` bị sửa ngoài app: tự định vị lại khi *đúng một* khớp `before+quote+after` (đề xuất), hay luôn ẩn và chờ người dùng bấm "định vị lại"?
- **Q2.** Cho phép thêm `remark-gfm` (bắt buộc cho bảng, theo yêu cầu phạm vi)?
- **Q3.** Ảnh http(s) từ xa: chặn mặc định (đề xuất) hay cho phép có công tắc?
- **Q4.** Ngưỡng kích thước `.md` (đề xuất cảnh báo/ngưng ở 5 MB)?
- **Q5.** HTML nhúng: bỏ qua hoàn toàn ở MVP (đề xuất) hay hiển thị dạng văn bản?

---

## 11. Phạm vi ngoài kế hoạch

Sửa Markdown trong app; DOC/DOCX; OCR; AI; cloud sync; audiobook; search hit sơn lên trang MD và đổi chỉ mục FTS sang P (M9); read aloud/translate trên surface MD; bookmark riêng cho MD; render công thức/mermaid/footnote nâng cao; liên kết giữa các file `.md`; mobile; bất kỳ thay đổi nào tới EPUB/PDF/TXT.

---

## 12. Giai đoạn 2 — đã triển khai (2026-10-19): Markdown Reader chỉ đọc

Phạm vi: mở và đọc `.md`; **không** có annotation, DOM→offset, sửa file, tìm kiếm, TOC, khôi phục vị trí đọc. Không migration, không đổi schema. Đã xác minh lại các giả định của §1–§3 trên code (đúng; điểm khác ghi ở §12.2).

### 12.1 Đã làm

| Hạng mục | File | Vai trò |
|---|---|---|
| Chính sách thuần (dùng chung Main + renderer) | `book-reader-sdk/src/md/md-policy.ts` (+ `index.ts`, export ở `src/index.ts`) | `MD_MAX_FILE_BYTES` = 5 MB, `checkMdFileSize`, `classifyMdLink` / `isSafeExternalUrl` (anchor, http(s), mailto; còn lại bị chặn), `classifyMdImageSrc` (chỉ đường dẫn tương đối, đuôi ảnh), `slugifyHeading` / `findHeadingForAnchor`, `splitMdSource` + `collectMdReferenceDefinitions` (tách tài liệu dài) |
| Giới hạn dung lượng | `electron/files/open-book-content.ts`, `electron/ipc/api-types.ts` (`OpenBookErrorCode` + `too_large`) | `stat` trước khi đọc; từ chối > 5 MB trước khi nạp vào bộ nhớ / gửi qua IPC; kiểm lại sau khi đọc (file lớn lên giữa chừng) |
| Ảnh tương đối | `electron/md/md-asset-files.ts` (logic thuần), `electron/md/md-asset-protocol.ts` (`rb-md-asset://local/{bookId}/{path}`), `electron/main.ts`, `electron/files/cover-protocol.ts` | Main tra sách trong thư viện, `resolveBookFile`, chính sách SDK, rồi `realpath` của ảnh phải nằm trong `realpath` thư mục chứa `.md` (symlink/junction thoát ra ngoài bị chặn); chỉ đuôi ảnh, ≤ 20 MB; header `nosniff` + CSP kín. Hai scheme tuỳ biến đăng ký trong **một** lần gọi `registerSchemesAsPrivileged` |
| Mở liên kết ngoài | `AppChannels.openExternalLink`, `app.ipc.ts`, `preload.ts`, `api-types.ts`, `src/bridge/app.ts` | Chưa có cơ chế sẵn cho renderer → thêm 1 IPC tối thiểu; Main kiểm lại `isSafeExternalUrl` rồi `shell.openExternal` |
| Surface Markdown | `src/reader/renderers/md/{MdRenderer.tsx,mdSource.ts,md.css,index.ts}`, `renderers/textSurface.ts` | `react-markdown` + `remark-gfm`, `skipHtml`, link không có `href`, ảnh qua protocol, tách đoạn + mount dần, error boundary từng mảnh, thông báo file rỗng / UTF-8 lỗi |
| Tích hợp Reader shell | `reader/capabilities.ts` (surface `'md'`: snapshot, wordCount, readingSettings), `ReaderScreen.tsx` (`isMdSurface`, `isTextSurface`), `useReaderNavigation.ts`, `useReaderSessionBridge.ts` (kiểu `TextSurfaceApi` thay `TxtRendererApi`) | `.md` không còn rơi vào `ReadingCanvas`; chuyển trang / tua / % tiến độ / lưu % vào Library dùng lại đường của TXT |
| Dependency | `remark-gfm ^4.0.1` (Q2), `package-lock.json` | `react-markdown` đã có sẵn, nay mới được dùng |
| Script | `spike:md:main`, `spike:md:render`, `e2e:md` | xem §12.3 |

### 12.2 Khác với kế hoạch ban đầu

- **Tách tài liệu dài + mount dần** (không có trong §4). Đo trên máy dev: parse `remark` tăng nhanh hơn tuyến tính (nội dung hỗn hợp: 100 KB ≈ 0,4 s, 400 KB ≈ 4 s, 800 KB ≈ 14 s; 1 MB một lần ≈ 24 s) → một file 5 MB sẽ treo cửa sổ hàng chục giây. Tài liệu > 60 000 ký tự được cắt ở ranh giới an toàn (sau dòng trống, ngoài fenced code, trước heading ATX hoặc đoạn văn ở cột 0; không cắt trong list/quote/bảng/code thụt/HTML); mỗi mảnh ≈ 40 000 ký tự, 2 mảnh đầu hiện ngay (1 MB: ~330 ms), phần còn lại mount mỗi 40 ms một mảnh kèm dòng "Loading the rest of the document…". Link tham chiếu `[x][ref]` vẫn chạy nhờ nối các định nghĩa vào mọi mảnh. Footnote nằm ở mảnh khác sẽ không nối được.
- **Anchor `#heading`**: `react-markdown` không gắn id cho heading; thay vì thêm `rehype-slug`, tìm heading theo slug kiểu GitHub tại lúc bấm (`findHeadingForAnchor`). Anchor trỏ vào phần chưa mount → mount hết rồi cuộn.
- **Giải mã ở renderer** (không thêm IPC `md:open`): `openBookContent` trả bytes, `decodeMdSource` giải mã UTF-8 (bỏ BOM, `\r\n`→`\n` qua `normalizeTxtText`). Byte không phải UTF-8 hợp lệ → thay bằng U+FFFD **và hiện thông báo** (không đổi âm thầm). Chưa hỗ trợ UTF-16 / bảng mã cũ (khác TXT).
- **Link không có `href`** (kế hoạch chỉ nói "chặn scheme"): render `<a role="link" tabindex=0>` không `href`, nên ctrl/middle-click không thể mở cửa sổ mới. Link bị chặn hiện như chữ thường (gạch chấm).
- **Chưa lưu vị trí đọc**: cần ánh xạ DOM→offset (Giai đoạn 3). Phiên chỉ lưu % tiến độ cho Library; mở lại sách bắt đầu từ đầu.
- **`MdRendererApi.getCurrentLocation()` luôn `undefined`** — điểm mở rộng duy nhất chuẩn bị cho giai đoạn sau (nằm trong `TextSurfaceApi`).
- **Cập nhật spike cũ** `spike:reader:toolbar`: Markdown không còn là mẫu "placeholder" (đổi sang DOCX), thêm kiểm tra surface/capability/rail của `md`, regex kiểm `ReaderScreen` đổi sang `isTextSurface`.

### 12.3 Kiểm thử đã thêm và kết quả (chạy 2026-10-19)

| Mức | Test | Lệnh | Kết quả |
|---|---|---|---|
| Unit | `book-reader-sdk/tests/md/md-policy.test.ts`: giới hạn 5 MB (0 / vừa đủ / +1 byte), phân loại link (anchor / http(s) / mailto / `javascript:` / `file:` / `data:` / tương đối), phân loại ảnh (tương đối, từ xa, tuyệt đối, ổ đĩa, `..`, `%2e%2e`, NUL, ADS, đuôi lạ), slug + anchor (tiếng Việt, tiêu đề trùng), tách tài liệu (ghép lại = nguyên bản; không cắt trong fence ``` / ~~~, list/quote/bảng/code thụt/HTML; không có điểm cắt → giữ nguyên), định nghĩa tham chiếu | `cd source/apps/book-reader-sdk && npm test` | 19 test mới pass; toàn SDK 304 pass |
| Integration (Main) | `spikes/md/run-md-main.mjs`: `openBookContent` thật trên SQLite đã migrate (bytes BOM/Unicode nguyên vẹn, rỗng, đúng 5 MB mở / +1 byte `too_large` không trả data, file bị xoá `missing_file`, format khác không bị giới hạn, file `.md` không bị ghi); resolver ảnh thật trên file tạm (ảnh cạnh tài liệu, thư mục con, tên Unicode; từ chối traversal các dạng, tuyệt đối, ổ đĩa, UNC, từ xa, `file:`, `data:`, ADS, không phải ảnh; **junction trỏ ra ngoài bị chặn**; ảnh > 20 MB; parse URL protocol) | `npm run spike:md:main` | 12 / 12 |
| Integration (renderer) | `spikes/md/run-md-render.mjs`: `MdRenderer` thật qua Vite SSR → HTML: H1–H6, danh sách lồng, task list, đậm/nghiêng/gạch ngang/code, bảng GFM bọc cuộn ngang, tiếng Việt + emoji; **HTML thô bị bỏ** (script, iframe, `onerror`, style, `onclick`), link không `href` và `javascript:`/`file:`/`data:` vô hiệu, ảnh từ xa/`..`/tuyệt đối/`data:`/`file:` không thành `<img>`, ảnh tương đối chỉ qua `rb-md-asset://`, bookId độc hại không thoát URL; file rỗng, UTF-8 lỗi, 11 dạng Markdown hỏng không ném lỗi; 1 MB tách 27 mảnh, first paint ~330 ms; link tham chiếu xuyên mảnh | `npm run spike:md:render` | 19 / 19 |
| Hồi quy | `spike:reader:toolbar` (đã cập nhật), `spike:txt:main`, `spike:txt:store`, SDK `verify` | `npm run spike:reader:toolbar` … | 35 / 35, 37 / 37, 19 / 19, pass |
| Kiểu / lint / build | desktop `typecheck`, `lint` (0 warning), `e2e:typecheck`, `npx vite build`; SDK `verify` (typecheck + test typecheck + test + build) | script có sẵn | tất cả pass |
| E2E | `e2e/specs/md-reader.spec.ts` (A: import → mở từ Library → heading/list/bảng/code/ảnh cục bộ tải được/ảnh từ xa bị chặn/script không chạy/không link nào điều hướng cửa sổ/file gốc không đổi byte & mtime → về Library → mở lại; B: file > 5 MB báo lỗi; C: file rỗng) | `cd source/apps/reading-book-desktop && npm run e2e:md` (chỉ chạy tay; cửa sổ ẩn, `userData` tạm) | **CHƯA CHẠY** (đã `e2e:typecheck`). Chưa có xác nhận trong app thật rằng protocol `rb-md-asset` được Electron đăng ký và ảnh hiển thị |

### 12.4 Giới hạn còn lại

- Chưa chạy app Electron nên **protocol ảnh, `openExternalLink`, mount dần trong DOM thật và bố cục CSS chưa được kiểm trực quan/E2E**; các phần đó chỉ được kiểm bằng spike (logic) và SSR (cấu trúc HTML).
- Phát hiện ngoài phạm vi, chưa xử lý: `main.ts` **không** có `setWindowOpenHandler` / chặn `will-navigate` cho cửa sổ chính. Markdown không dựa vào chúng (link không `href`), nhưng nên bổ sung như biện pháp phòng thủ chung.
- Không tìm thấy Content-Security-Policy trong `index.html` / `main.ts` — cân nhắc thêm CSP (cho phép `rb-md-asset:` và `rb-cover:` ở `img-src`) ở một đợt riêng.
- Footnote GFM chéo mảnh; HTML nhúng bị bỏ hoàn toàn; ảnh `data:` bị chặn (chỉ ảnh tương đối); link tương đối tới `.md` khác bị vô hiệu.
- Parse vẫn chạy trên luồng UI (mỗi mảnh ≈ 100–250 ms); chưa dùng worker.
- Chỉ mục FTS / đếm từ của `md` vẫn tính trên **nguồn thô** (`extract-book-text.ts`), chưa trên văn bản hiển thị.
- Không khôi phục vị trí đọc.
- Chỉ UTF-8.

### 12.5 Để lại cho các giai đoạn sau

- **Giai đoạn 3**: plain text chuẩn P + bọc text node (`data-mdo`), DOM→offset, vị trí đọc `text-offset`, annotation (§5, M5–M8), `mdAnnotation` + validate ở Main. P phải dựng trên **toàn bộ tài liệu** (nhiều mảnh); `splitMdSource` giữ `join('') === text` nên offset tuyệt đối tính được từ độ dài các mảnh.
- **Giai đoạn 4**: relocate khi file bị sửa ngoài app, E2E annotation, FTS trên P, TOC từ heading, search hit.

### 12.6 Bổ sung: mục lục (Contents) từ heading (2026-10-19)

Theo yêu cầu sau Giai đoạn 2 (kế hoạch ban đầu để M9): sidebar **Contents** liệt kê heading của tài liệu, bấm để nhảy tới, mục đang đọc được đánh dấu theo vị trí cuộn.

- **Nguồn heading là DOM đã render** (`h1`–`h6`, đọc trong `MdRenderer` sau mỗi lần mount), không phải quét nguồn: bao gồm cả heading kiểu setext và định dạng inline, và chỉ số `N` luôn khớp phần tử heading thứ N của trang. Tài liệu dài: mục lục lớn dần khi các mảnh mount xong.
- `buildMdOutline` (SDK, có test) dựng cây lồng theo cấp heading (bỏ heading rỗng, vẫn tính chỉ số; không để khoảng trống khi nhảy cấp). Entry dùng `id = md-h-N`, `href = md-heading:N`; `ReaderScreen` đổi sang `EpubTocItem` cho `TocSidebar` sẵn có (chế độ `activeTocItemId` như PDF), không sửa sidebar.
- `MdRendererApi.scrollToHeading(N)`: heading chưa mount → mount phần còn lại rồi cuộn (cùng cơ chế anchor `#...`).
- Mục đang đọc: heading cuối cùng có đỉnh đã chạm đỉnh vùng đọc (tìm nhị phân trên danh sách heading đã cache, mỗi khung hình khi cuộn).
- Test: SDK `buildMdOutline` (4 test, tổng SDK 308 pass); E2E D trong `md-reader.spec.ts` (tài liệu dài tách mảnh: mục lục đủ 4 entry, nhảy tới heading cuối, entry hiện tại đổi theo cuộn, cuộn về đầu) — **chưa chạy**: `npm run e2e:md`.
