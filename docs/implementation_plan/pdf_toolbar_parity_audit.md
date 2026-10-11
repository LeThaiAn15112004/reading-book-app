# Audit: toolbar Reader EPUB vs PDF — cái gì thật sự thiếu ở PDF

Chỉ audit + đề xuất, **chưa sửa code**. Trạng thái lúc audit: nhánh `anle-dev`, commit `20cb71c`
(tìm kiếm PDF), working tree sạch. Đường dẫn tính từ `source/apps/reading-book-desktop/`.

Nguồn bằng chứng, ghi rõ ở từng dòng:
- **Code**: đã đọc và lần theo trong source (đây là hầu hết kết luận).
- **Runtime**: không có. App chưa được chạy cho audit này (Electron + cần file PDF thật), nên mọi
  hành vi "chạy được" dưới đây là suy ra từ code, không phải đã bấm thử.
- **Giả định**: ghi rõ chữ "giả định" / phân loại **F**.

Đọc kèm: `pdf_epub_reuse_audit.md` (audit trước, commit `6343fdb`), `reader_toolbar.md` (registry +
capabilities), `pdf_search.md`. Audit trước **đã lỗi thời** ở 3 điểm: PDF giờ đã có surface
`'pdf'` riêng, đã có Search, và bookmark PDF đã theo trang (`17b7405`).

## A. Tóm tắt

**Câu "toolbar PDF không hiện đủ công cụ" trong code nghĩa là:** toolbar được dựng từ
`TOOL_REGISTRY` (`src/screens/Reader/components/chrome/toolRegistry.ts`) lọc theo capability của
surface (`src/reader/capabilities.ts`). Công cụ thiếu capability **bị ẩn, không bị disable** — đúng
thiết kế trong `reader_toolbar.md`. Hiện tại:

| | Navigate | Annotation ⌄ | Tools ⌄ | Settings | ⋮ |
|---|---|---|---|---|---|
| EPUB | Hand, Select, Search, Audio, Translate | Highlight, Underline, Strikethrough | Snapshot, Word Count | Aa | More |
| PDF | Hand, Select, Search | — (cả nhóm ẩn) | Snapshot, Word Count | Aa | More |

PDF thiếu đúng 5 công cụ: **Audio, Translate, Highlight, Underline, Strikethrough**. Không công cụ
nào trong số đó bị ẩn "nhầm": PDF chưa có code cho cả 5 (xem B). Tức là **không có quick fix kiểu
"bật cờ capability lên là chạy"**.

Vấn đề thật gồm hai chiều:
1. **Thiếu chức năng** (chủ yếu): 5 công cụ trên cần tích hợp PDF; 2 trong số đó (Translate, menu
   khi chọn text) chỉ cần một nguồn sự kiện "chọn text" từ PDF, 3 công cụ markup cần thiết kế neo
   annotation PDF.
2. **Hiện nhưng không chạy** (ngược với yêu cầu, nhưng là lỗi thật): **Hand/Select** (PDF bỏ qua,
   hai nút cho kết quả như nhau), **Aa Settings** (toàn bộ là cài đặt reflow EPUB), nút **1 trang /
   2 trang** ở footer (PDF bỏ qua). Mấy nút này làm toolbar PDF *trông* đủ hơn thực tế.

Không có vấn đề "visibility" nào kiểu E (PDF làm được nhưng bị ẩn).

## B. Ma trận so sánh

Phân loại: **A** dùng chung, đã chạy · **B** UI dùng chung, thiếu nối PDF · **C** cần cài đặt riêng
cho PDF · **D** chỉ EPUB · **E** PDF làm được nhưng bị ẩn · **F** chưa xác minh.
⚠ = đang **hiện ở PDF nhưng không có tác dụng**.

### B.1 Toolbar trên (`ReaderTopbar` → `ToolsStrip`)

| Control / Feature | EPUB | PDF | Loại | Bằng chứng | Đề xuất |
|---|---|---|---|---|---|
| Hand ⚠ | Kéo để cuộn khi zoom > 1 (`onHandPanBy`), không chọn text; click mark → menu highlight | Nút hiện + bật được, nhưng `PdfRenderer` **không nhận** `interactionTool`; text layer PDF.js luôn chọn được; không có kéo trang | B | `ReaderScreen.tsx` truyền `interactionTool` cho `EpubRenderer`/`ReadingCanvas`, không cho `PdfRenderer` (dòng 905–919); `PdfRendererProps` không có prop này | Thêm `interactionTool` + `onHandPanBy` cho `PdfRenderer`: Hand = tắt chọn text (`user-select:none` trên `.textLayer`) + kéo cuộn qua `zoom.handleHandPanBy` (đã cuộn được viewport native) |
| Select ⚠ (một phần) | Chọn text trong iframe → menu ngữ cảnh | Chọn text chạy (text layer PDF.js) nhưng y hệt Hand; không mở menu | B | như trên | Cùng việc với Hand; menu xem B.3 |
| Search | Panel, FTS ở Main, tô + nhảy kết quả | Đã có từ `20cb71c`: trích text PDF ở Main, tô trên text layer, nhảy theo trang/lần xuất hiện | A | `capabilities.ts` (`pdf` có `search`), `useReaderSearch` nhận `pdfApiRef`, `PdfRendererApi.setSearchHighlights/goToSearchMatch`, `pdfSearchDom.ts` | Không đổi |
| Audio (Read Aloud) | Menu đọc to: đọc vùng nhìn thấy / từ vị trí, play/pause, tốc độ, âm lượng | Ẩn | C | Không có `readAloud` trong capability PDF; `useReadAloud.available = isEpubSurface && …`; nguồn text là `epub/readAloud/epubReadAloudDom.ts` (duyệt DOM iframe) | Giữ ẩn. Sau này: bộ duyệt text layer PDF (theo trang) + `PdfRendererApi` cho "đọc từ vị trí"; menu + store dùng lại |
| Translate | Chế độ: mỗi lần chọn xong → popover dịch | Ẩn | B | `translationStore.openForSelection(info: EpubSelectionInfo)` cần `{cfiRange, text, rect, lang}`; PDF không phát sự kiện chọn text | Thêm sự kiện chọn text từ `PdfRenderer` (text + rect + lang rỗng); nới kiểu input của store (không cần `cfiRange`); rồi bật capability `translate` |
| Highlight / Underline / Strikethrough | Bật công cụ, kéo qua text → tạo mark (sticky) | Ẩn (cả nhóm Annotation) | C | `highlightsStore` neo bằng `CfiLocation`, vẽ qua handle EPUB, gate `isEpubSurface` (`useReaderHighlights.ts`) | Giữ ẩn tới khi có thiết kế neo + vẽ annotation PDF (giai đoạn riêng) |
| Snapshot | Kéo chọn vùng → copy ảnh (Main `capturePage`) | Như EPUB | A | `useSnapshotTool`, không phụ thuộc renderer | Không đổi |
| Word Count | Panel thống kê từ `book_chunks` | Chạy được từ khi PDF được chunk (`CHUNKABLE_FORMATS` có `'pdf'`) | A (F với PDF scan) | `electron/wordcount/word-count-service.ts`; với PDF không có text sẽ trả `ok` + 0 từ, không báo "không có text" như Search | Không đổi; tuỳ chọn: trả trạng thái "no text" giống `pdf_search.md` |
| Settings (Aa) ⚠ | Panel phải: font, cỡ chữ, độ đậm, chế độ xem, lề, giãn dòng, căn lề | Hiện, nhưng **mọi mục là reflow**: không mục nào đổi được trang PDF. Mục "Chế độ xem" còn có tác dụng phụ: đổi `book.prefs.viewMode` → `readerChromeBottomInset` thay đổi khoảng chừa footer khi đang đọc PDF | D (nội dung) | `AaSettingsPanel.tsx` (7 mục), `capabilities.ts` (`pdf` có `readingSettings`), `ReaderScreen.tsx:457` | Bỏ `readingSettings` khỏi surface `pdf` (nhóm Settings tự ẩn). Nếu sau này có cài đặt PDF (xoay, trang đôi, nền tối) thì làm panel riêng |
| Nhóm View | Không có công cụ (nhóm rỗng, không render) | Như EPUB | — | `TOOL_GROUPS` có `view`, `TOOL_REGISTRY` không có tool nào thuộc `view` | Nơi đặt Rotate / chế độ trang PDF sau này (C) |
| More ⋮: Share, Add to Favorites, Book info, Move to trash | Share/Favorites/Trash là stub (toast), Book info chạy | Như EPUB | A | `MoreMenu.tsx`, handler trong `ReaderScreen.tsx` không phân nhánh theo định dạng | Không đổi (stub là việc chung, không phải của PDF) |

### B.2 Footer (`ReaderFooter`)

| Control / Feature | EPUB | PDF | Loại | Bằng chứng | Đề xuất |
|---|---|---|---|---|---|
| Thanh tiến độ + bấm để nhảy | % theo spine/CFI | % = trang/tổng; bấm nhảy qua `nav.goToProgress` | A | `ReaderScreen.tsx:275–279, 523` | Không đổi |
| `<<` `<` ô trang `>` `>>`, Go to Page (phím tắt) | Trang tham chiếu EPUB | Trang PDF thật | A | `useReaderNavigation` → `PdfRendererApi.goToPage/nextPage/prevPage` | Không đổi |
| Bookmark | Theo CFI | Theo trang (`PageRectLocation`) từ `17b7405` | A | `useReaderBookmarks.ts:115, 236` | Không đổi |
| 1 trang / 2 trang ⚠ | Đổi layout EPUB | Hiện, bấm được, lưu pref, **PDF bỏ qua** (`PdfRenderer` không có prop layout) | C (2 trang cho PDF) | `ReaderFooter.tsx:354–370` render vô điều kiện; `ReaderScreen.tsx:535` | Ngay: ẩn nhóm này với PDF (prop tuỳ chọn như `onViewModeChange`). Về sau: trang đôi PDF là tính năng riêng |
| Lật trang / Cuộn dọc | Đổi chế độ xem EPUB | Đã ẩn đúng (PDF luôn cuộn liên tục) | D | `ReaderScreen.tsx:541–549` | Không đổi |
| Gợi ý "đang tối ưu tìm kiếm" | Có | Có | A | `useBookIndexing` | Không đổi |
| Zoom −, %, +, preset (Actual Size / Fit Page / Fit Width / Fit Visible), Ctrl+wheel | Zoom transform | Zoom native (trang render lại theo zoom) | A (F: "vừa" với PDF trang khác cỡ) | `ReaderZoomViewport mode="native"`, `focusZoomEnabled` luôn bật với PDF | Không đổi; kiểm tra runtime fit với PDF trang lẫn cỡ |
| Fullscreen / immersive | Có | Có | A | `useImmersiveReading`, không phụ thuộc định dạng | Không đổi |

### B.3 Sidebar trái, menu ngữ cảnh, panel

| Control / Feature | EPUB | PDF | Loại | Bằng chứng | Đề xuất |
|---|---|---|---|---|---|
| Contents (mục lục) | TOC EPUB, tô mục đang đọc | Outline PDF (`pdf-page:N`), bấm nhảy được; **không tô mục đang đọc** | B | `ReaderScreen.tsx:606–609` (`activeTocHref` chỉ cho EPUB); PDF không outline → danh sách rỗng (`chapters=[]`) | Tính mục outline đang đọc từ trang hiện tại; thông điệp rõ khi PDF không có outline (F: chưa xem empty state thật) |
| Bookmark (tab) | Danh sách, nhảy, xoá | Như EPUB | A | `useReaderBookmarks` | Không đổi |
| Notes (tab) | Danh sách highlight/ghi chú | Hiện nhưng luôn rỗng (PDF chưa có annotation) | C | phụ thuộc annotation PDF | Giữ (trạng thái rỗng hợp lệ); tự có khi có annotation PDF |
| Page layout (tab) | Lưới ô trang / section | Lưới ô "Page N", bấm nhảy được; ô là số, không phải ảnh thu nhỏ | A (ảnh thu nhỏ = C) | `PageLayoutPanel.tsx`, `sectionLabels` cho PDF ở `ReaderScreen.tsx:266–274` | Ảnh thu nhỏ trang thật là tính năng riêng (render PDF cỡ nhỏ, ảo hoá với 1000+ trang) |
| Attachment (tab) | Stub "No attachments" | Stub như EPUB | A (stub) | `TocSidebar.tsx:848` | Không đổi (file đính kèm nhúng trong PDF là tính năng khác) |
| Menu khi chọn text: Highlight, Underline, Strikethrough, Add note, Bookmark here, Copy, Translate, Copy with citation | Có | **Không có**: `highlights.selectionMenu` chỉ được set từ sự kiện EPUB | B (Copy, Translate, Bookmark here, Copy with citation) / C (4 mục markup) | `ReaderScreen.tsx:696–731`, `useReaderHighlights` gate `isEpubSurface` | Cùng nguồn sự kiện chọn text như Translate; menu PDF chỉ hiện các mục chạy được (ẩn markup tới khi có annotation). Citation dùng nhãn `Page N` thay vì `epubNav.label` |
| Copy bằng Ctrl+C | Có | Giả định chạy (chọn text native trên text layer) | F | Không có code chặn; chưa thử runtime | Kiểm tra runtime |
| Popup highlight (NoteFloatingMenu, HighlightEditPopup, NoteTextboxPopup) | Có | Không (chưa có highlight) | C | phụ thuộc annotation | Theo annotation PDF |
| Popover dịch | Có | Không (không có đầu vào) | B | xem Translate | Theo Translate |
| Menu đọc to | Có | Không | C | xem Audio | Theo Audio |
| Overlay snapshot, panel Word Count | Có | Có | A | | Không đổi |
| Click giữa trang | `onCenterTap` → đóng menu nổi, bỏ chọn, đóng UI annotation | Không nối (`PdfRenderer` không có callback click) | B | `useReaderChromeUi.handleCenterTap` đã có nhánh non-EPUB (`window.getSelection().removeAllRanges()`) | Thêm `onSurfaceClick`/`onCenterTap` cho `PdfRenderer` (phân biệt click với kết thúc chọn text) |
| Escape | Bỏ chọn text, thoát công cụ, đóng panel | Đóng panel / thoát công cụ chạy (listener cấp window); bỏ chọn text PDF chưa xác minh | F | `useReaderChromeUi.ts` nhiều nhánh `isEpubSurface` | Kiểm tra runtime; nối cùng việc click giữa trang nếu thiếu |
| Phím tắt (registry) | Tất cả | Tất cả nhóm Navigation / Search / View chạy với PDF | A | `useReaderShortcuts` nhận `pdfApiRef` | Không đổi |

## C. Bốn cách hiểu "hiện đủ công cụ"

| Cách hiểu | Ý nghĩa | Đánh giá |
|---|---|---|
| 1. Giống về hình | Cùng bố cục, cùng nhóm | Đã giống: cùng `ToolsStrip`, cùng nhóm, cùng thứ tự. Khác duy nhất là công cụ bị lọc |
| 2. Giống về nút | PDF có cùng các nút áp dụng được | Bật nút mà không có code = vi phạm quy tắc "ẩn, không disable / không nút vô tác dụng" của `reader_toolbar.md` |
| 3. Giống về chức năng | Mọi nút PDF đang hiện đều chạy | **Đang hỏng ở 3 chỗ** (Hand/Select, Aa, 1/2 trang) |
| 4. Giống về năng lực | Người đọc PDF làm được điều tương đương, có thể bằng cách khác | Mục tiêu dài hạn đúng |

**Khuyến nghị:** làm theo thứ tự **3 → 4**: trước hết mọi nút PDF đang hiện phải chạy (hoặc ẩn đi),
rồi thêm từng năng lực, mỗi năng lực bật capability tương ứng *khi* nó chạy. Kiến trúc hiện có đã
hỗ trợ đúng cách này: thêm một capability vào `SURFACE_CAPABILITIES.pdf` là nút tự hiện, không cần
sửa toolbar. Không copy công cụ EPUB sang PDF chỉ để toolbar trông giống.

## D. Phạm vi đề xuất

### D.1 Quick fix (ẩn những gì hiện mà không chạy)

Không có công cụ nào thuộc loại E. Quick fix là theo chiều ngược lại:

1. **Ẩn Aa với PDF** — bỏ `'readingSettings'` khỏi `SURFACE_CAPABILITIES.pdf`.
   Tiêu chí: PDF không còn nút Settings / panel Aa; EPUB và placeholder không đổi;
   `spike:reader:toolbar` cập nhật và qua.
   Lưu ý: khi đó PDF không có chỗ nào đổi pref đọc, nên tác dụng phụ "Chế độ xem → bottom inset"
   cũng hết; vẫn nên cho `readerChromeBottomInset` nhận giá trị cố định với PDF.
2. **Ẩn nút 1 trang / 2 trang với PDF** — `ReaderFooter` nhận `onLayoutChange` tuỳ chọn (giống
   `onViewModeChange`), `ReaderScreen` không truyền cho PDF.
   Tiêu chí: footer PDF không có nhóm "Page count"; footer EPUB không đổi.

### D.2 Tích hợp PDF (UI dùng chung, nối thêm)

3. **Hand / Select cho PDF** — `PdfRenderer` nhận `interactionTool` + `onHandPanBy`.
   Hành vi: Hand = không chọn được text, kéo chuột cuộn trang (khi zoom bất kỳ — PDF luôn cuộn
   được, khác EPUB chỉ pan khi > 1; cần chốt, xem E); Select = chọn text, con trỏ text.
   Tiêu chí: hai nút cho hành vi khác nhau thấy được; Ctrl+wheel zoom vẫn chạy ở cả hai; tìm kiếm vẫn
   tô đúng.
4. **Click giữa trang / Escape** — callback click từ `PdfRenderer` → `chrome.handleCenterTap`.
   Tiêu chí: click vào trang đóng menu nổi / panel; Escape bỏ chọn text.
5. **Sự kiện chọn text PDF** (nền cho 6 và 7) — khi Select kết thúc một vùng chọn trong text
   layer: phát `{ text, rect, lang: '' , page }`. Tách kiểu input trung lập (không `cfiRange`) cho
   `translationStore` và menu chọn text.
6. **Translate cho PDF** — bật `translate`. Tiêu chí: bật Translate → chọn text → popover dịch
   đúng đoạn; Esc thoát chế độ; EPUB không đổi.
7. **Menu khi chọn text cho PDF** — chỉ Copy, Copy with citation (nhãn `Page N`), Translate,
   Bookmark here. Không có mục markup. Tiêu chí: chuột phải / kết thúc chọn → menu; mọi mục chạy.
8. **Mục lục: tô mục đang đọc** — mục outline có trang lớn nhất ≤ trang hiện tại.

### D.3 Tính năng lớn (cài đặt riêng cho PDF, cần thiết kế)

9. **Annotation PDF** (Highlight / Underline / Strikethrough, menu markup, tab Notes, popup) —
   neo `PageRectLocation(page, rect)` + quads / offset text layer, overlay vẽ riêng. Lưu trữ dùng
   chung `HighlightDto.locatorRef`, **không đổi schema**. Cần tài liệu thiết kế trước.
10. **Read Aloud PDF** — đọc text layer theo trang, "đọc từ vị trí", tô câu đang đọc (tuỳ chọn).
11. **Chế độ trang PDF** (trang đôi / trang đơn có lật) và **Xoay trang** — nhóm `View` trên toolbar
    như `reader_toolbar.md` §2.3 định hướng.
12. **Ảnh thu nhỏ trang** trong tab Page layout.
13. **Nền tối / theme cho trang PDF** (hiện trang luôn trắng) — không phải toolbar, ghi lại để
    quyết định.

### D.4 Không copy sang PDF

- Các mục reflow trong Aa: font family, cỡ chữ, độ đậm, giãn dòng, căn lề, lề. PDF có bố cục cố
  định; "cỡ chữ" tương đương ở PDF là zoom (đã có ở footer).
- Toggle Lật trang / Cuộn dọc kiểu EPUB (đã ẩn đúng); nếu PDF có chế độ trang thì là control riêng
  (mục 11), không dùng lại toggle EPUB.
- Phân trang tham chiếu / "Calculating…" của EPUB (PDF có trang thật).
- Chuyển tiếp phím từ iframe EPUB (PDF không có iframe).

## E. Trình tự triển khai

1. **D.1 (1–2)** — nhỏ, độc lập, an toàn: chỉ ẩn. Cập nhật `spikes/reader-toolbar/run-toolbar.mjs`
   (đang assert PDF = placeholder + search). Hồi quy: toolbar/footer EPUB.
2. **D.2 (3–4)** — Hand/Select + click giữa trang. Cùng file (`PdfRenderer.tsx`, `ReaderScreen.tsx`),
   không phụ thuộc gì.
3. **D.2 (5)** — sự kiện chọn text PDF. Nền cho bước 4.
4. **D.2 (6–7)** — Translate + menu chọn text (cùng nguồn sự kiện). Bật capability `translate`.
5. **D.2 (8)** — tô mục lục; độc lập, có thể làm bất kỳ lúc nào.
6. **D.3** — mỗi mục một tài liệu thiết kế + quyết định riêng; annotation (9) nên đi trước vì nó
   mở khoá menu markup và tab Notes.

Mỗi bước: `npm run typecheck`, `npm run lint`, `npx vite build`, `spike:reader:toolbar`, và kiểm
tra thủ công với một PDF có text, một PDF scan, một EPUB.

## F. Câu hỏi mở

1. Ẩn **Aa** với PDF ngay bây giờ (toolbar PDF sẽ ngắn hơn nữa), hay giữ nút và thay bằng một
   panel cài đặt PDF tối thiểu (vd. chỉ zoom mặc định / nền trang)?
2. Hand ở PDF: kéo để cuộn **ở mọi mức zoom** (giống trình xem PDF thông thường) hay chỉ khi
   zoom > 100% như EPUB?
3. **Annotation PDF** có thuộc phạm vi gần không? Đây là phần lớn nhất của khoảng cách và là thứ
   duy nhất làm nhóm Annotation xuất hiện ở PDF.
4. Trang đôi / xoay trang cho PDF: có cần không, hay PDF chỉ cuộn liên tục một cột?

## G. Cách kiểm chứng audit này

Đọc source, không chạy app: `capabilities.ts`, `toolRegistry.ts`, `toolbarLayout.ts`,
`ToolsMenu.tsx`, `ReaderTopbar.tsx`, `MoreMenu.tsx`, `ReaderFooter.tsx`, `ReaderScreen.tsx`,
`PdfRenderer.tsx`, `AaSettingsPanel.tsx`, `TocSidebar.tsx` / `sidebarTabs.ts`, các hook trong
`screens/Reader/logic/hooks/`, `electron/wordcount/word-count-service.ts`,
`electron/chunking/extract-book-text.ts`, `spikes/reader-toolbar/run-toolbar.mjs`. Không đổi code,
dependency, schema hay IPC; không commit.
