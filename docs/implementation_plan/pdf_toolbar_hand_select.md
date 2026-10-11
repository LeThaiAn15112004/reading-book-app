# PDF Reader: bỏ control không chạy + Hand / Select thật

Tiếp nối `pdf_toolbar_parity_audit.md` (mục D.1 và D.2 bước 3–4). Đường dẫn tính từ
`source/apps/reading-book-desktop/`. Trạng thái trước khi sửa: nhánh `anle-dev`, commit `20cb71c`,
chỉ có file audit chưa commit. **Chưa chạy thử trong Electron** — xem §5.

## 1. Kiểm chứng audit (trước khi sửa)

Không có commit nào sau audit; cả 5 phát hiện đều đúng với code:

| # | Phát hiện | Kết luận | Bằng chứng |
|---|---|---|---|
| 1 | PDF hiện Aa nhưng mọi mục là reflow EPUB | Đúng | `capabilities.ts`: `pdf` có `readingSettings`; `AaSettingsPanel` chỉ có font, cỡ chữ, độ đậm, chế độ xem, lề, giãn dòng, căn lề |
| 1b | Footer inset của PDF đọc pref EPUB | Đúng | `ReaderScreen`: `readerChromeBottomInset(book.prefs.viewMode, …)` cho mọi định dạng |
| 2 | Nút 1 trang / 2 trang hiện ở PDF nhưng bị bỏ qua | Đúng | `ReaderFooter` render nhóm "Page count" vô điều kiện; `PdfRenderer` không có prop layout |
| 3 | Hand và Select như nhau ở PDF | Đúng | `PdfRenderer` không nhận `interactionTool`; text layer PDF.js luôn chọn được; không có kéo trang |
| 4 | Click giữa trang chưa nối | Đúng | `PdfRenderer` không có callback click; `useReaderChromeUi.handleCenterTap` không được gọi cho PDF |
| 5 | Escape có bỏ chọn text PDF không | **Không** — chưa có gì làm việc này | Listener Escape trong `useReaderChromeUi` chỉ đóng panel rồi ẩn chrome; `useReaderNavigation` chỉ huỷ công cụ markup / chế độ dịch. (EPUB cũng không bỏ chọn bằng Escape) |

Cách EPUB làm (để dùng lại): `EpubRenderer` nhận `interactionTool`, `onHandPanBy`, `onCenterTap`.
Hand: pointerdown → `preventDefault` + `setPointerCapture`, kéo quá `PAN_DRAG_THRESHOLD_PX` (4 px)
là pan, gọi `onHandPanBy(dx, dy)` → `useReaderZoomControls.handleHandPanBy` cuộn viewport zoom;
nhả chuột mà không kéo, ở 25–75 % chiều ngang → `onCenterTap` → `chrome.handleCenterTap` (đóng
menu nổi, bỏ focus sidebar, bỏ chọn text).

## 2. Đã sửa

| File | Thay đổi |
|---|---|
| `src/reader/capabilities.ts` | Bỏ `readingSettings` khỏi surface `pdf` → nhóm Settings (Aa) không render với PDF. EPUB và placeholder giữ nguyên |
| `src/screens/Reader/components/chrome/ReaderFooter.tsx` | `onLayoutChange` thành tuỳ chọn; không có thì không render nhóm 1 trang / 2 trang (cùng kiểu với `onViewModeChange`) |
| `src/screens/Reader/ReaderScreen.tsx` | PDF: không truyền `onLayoutChange`; inset footer dùng `'scroll'` (PDF luôn cuộn liên tục) thay vì `book.prefs.viewMode`; truyền `interactionTool`, `onHandPanBy={zoom.handleHandPanBy}`, `onCenterTap={chrome.handleCenterTap}` cho `PdfRenderer`; `escapeUiRef` có thêm `isPdfSurface`; `pdfApiRef` vào `useReaderChromeUi` |
| `src/reader/renderers/pdf/PdfRenderer.tsx` | Props `interactionTool`, `onHandPanBy`, `onCenterTap`; xử lý pointer trên khối trang (Hand pan / Select / center tap); `PdfRendererApi.clearSelection(): boolean` (chỉ bỏ vùng chọn nằm trong PDF) |
| `src/screens/Reader/logic/hooks/useReaderChromeUi.ts` | Escape: sau khi đóng panel, nếu là PDF và có vùng chọn → bỏ chọn rồi dừng (mỗi lần bấm một cấp); lần sau mới ẩn chrome. `handleCenterTap` gọi `pdfApiRef.clearSelection()` cho PDF. **Không thêm listener mới** — dùng listener Escape sẵn có |
| `src/index.css` | `[data-pdf-tool='hand'] .textLayer …`: tắt chọn text + I-beam của text layer khi Hand. Để ngoài `@layer` vì `pdf_viewer.css` cũng không có layer (utility Tailwind trong `@layer utilities` sẽ thua) |
| `spikes/reader-toolbar/run-toolbar.mjs` | PDF = placeholder + search − Aa; layout PDF không còn nhóm Settings; kiểm tra tĩnh: `PdfRenderer` nhận tool / pan / center tap, footer không có toggle layout cho PDF, inset không đọc pref EPUB |

Chi tiết `PdfRenderer` (một bộ handler React trên khối trang, không có listener cấp window):
- **Hand**: pointerdown nút trái → `preventDefault`, `setPointerCapture`, class `rb-grabbing`
  (con trỏ grabbing, quy tắc sẵn có trong `index.css`). pointermove → `onHandPanBy(dx, dy)` (cuộn
  `ReaderZoomViewport`, chính là nơi cuộn của PDF); thiếu callback thì cuộn thẳng scroll root.
  Kết thúc ở pointerup / pointercancel / lostpointercapture / khi nút chuột đã nhả; đổi công cụ
  giữa chừng hoặc unmount cũng kết thúc và trả pointer (effect theo `hand`).
- **Select** (và mọi công cụ khác không phải `hand`): không chặn gì, text layer PDF.js chọn tự
  nhiên; con trỏ text.
- **Center tap**: chỉ khi nhả chuột mà chưa kéo ≥ 4 px, ở 25–75 % chiều ngang viewport. Ở Select,
  nếu sau khi nhả còn vùng chọn (double/triple click) thì không tính. Click trong panel tìm kiếm,
  toolbar, footer, sidebar không đi qua khối trang nên không bao giờ là center tap.
- Ctrl+wheel zoom: không đổi (listener capture của `ReaderZoomViewport`, `focusZoomEnabled` luôn
  bật với PDF). Cuộn thường: không đổi. Tô kết quả tìm kiếm: không đụng tới.

## 3. Hành vi sau thay đổi

| | EPUB | PDF |
|---|---|---|
| Toolbar | Không đổi: Hand, Select, Search, Audio, Translate · Annotation ⌄ · Tools ⌄ · Aa | Hand, Select, Search · Tools ⌄ (Snapshot, Word Count). Không còn Aa |
| Footer | Không đổi (có 1/2 trang, lật/cuộn) | Không có 1/2 trang, không có lật/cuộn; inset footer luôn như chế độ cuộn |
| Hand | Không đổi (pan; dừng trên chữ một lúc thì chọn được) | Kéo = cuộn trang ở mọi mức zoom; **không bao giờ** chọn text |
| Select | Không đổi | Chọn text trên text layer |
| Click giữa | Không đổi | Đóng menu nổi / bỏ chọn (không bật/tắt toolbar — giống EPUB) |
| Escape | Không đổi | Panel đang mở → đóng; còn vùng chọn PDF → bỏ chọn; rồi mới ẩn toolbar |

Lưu ý: công cụ mặc định khi mở sách là **Hand** (`ReaderScreen`, như trước). Với PDF điều đó nghĩa
là kéo chuột giờ cuộn trang thay vì chọn text; muốn chọn phải bấm Select. Đây là khác biệt so với
EPUB, nơi Hand vẫn chọn được chữ sau khi dừng chuột trên đó — xem câu hỏi mở §6.

Pref `layout` / `viewMode` đã lưu của sách không bị đổi hay xoá; PDF chỉ không đọc/ghi chúng nữa.

## 4. Kiểm tra đã chạy

| Lệnh | Kết quả |
|---|---|
| `npm run typecheck` | Đạt |
| `npm run lint` | **Không đạt — lỗi có sẵn**: 12 lỗi + 14 cảnh báo, tất cả ở file không bị sửa (vd. `useCloudSources.ts`, `AppNavContext.tsx`, `EpubRenderer.tsx`, `PageLayoutPanel.tsx`). `npx eslint --report-unused-disable-directives` trên 5 file TS/TSX đã sửa: sạch |
| `npx vite build` | Đạt; quy tắc `[data-pdf-tool=hand] …` có trong CSS bundle, ngoài `@layer` |
| `npm run spike:reader:toolbar` | Đạt, 22 kiểm tra |
| `npm run spike:session:roundtrip` | Đạt |
| `npm run spike:settings:reset` | Đạt, 14 kiểm tra |

Repo không có test runner; ngoài các spike trên không có test reader nào khác.

## 5. Cần kiểm tra thủ công trong Electron (chưa làm)

Không chạy được app Electron trong phiên này, nên **tất cả mục dưới đây chưa xác minh** — build
thành công không chứng minh chúng chạy.

1. EPUB: toolbar + footer giống hệt trước (Aa, 1/2 trang, lật/cuộn còn; Hand pan, Select, highlight).
2. PDF: không có Aa, không có 1/2 trang; trang cuối không bị footer che khi cuộn hết.
3. PDF Select: kéo chọn được text, Ctrl+C copy được; double-click chọn từ.
4. PDF Hand: kéo cuộn dọc/ngang (zoom > 100 %), không bôi đen chữ, con trỏ grab → grabbing.
5. Hand ↔ Select đổi qua lại nhiều lần; đổi khi vừa kéo xong.
6. Ctrl+wheel zoom ở cả hai chế độ; tìm kiếm (Ctrl+F) vẫn tô và nhảy đúng sau khi đổi công cụ.
7. Không có center tap sau khi kéo (Hand) hoặc sau khi chọn text (Select); có khi click giữa.
8. Escape: đóng panel Search trước; sau đó bỏ vùng chọn PDF; sau đó ẩn toolbar. Snapshot đang bật
   thì Escape vẫn huỷ snapshot trước (listener capture của nó).
9. Điều hướng PDF và EPUB (footer, phím, mục lục, bookmark) vẫn chạy.
10. Thả chuột ngoài cửa sổ khi đang kéo Hand: không bị kẹt trạng thái grabbing.

## 6. Còn lại / câu hỏi mở

- **Hand ở PDF có nên chọn được chữ** sau khi dừng chuột trên đó (như EPUB)? Hiện tại không: Hand
  ở PDF là pan thuần, giống trình xem PDF thông thường.
- **Translate**: cần nguồn sự kiện chọn text từ PDF + kiểu input trung lập cho `translationStore`
  (hiện đòi `EpubSelectionInfo` có `cfiRange`). Kèm menu khi chọn text (Copy, Copy with citation,
  Translate, Bookmark here). Audit D.2 bước 5–7.
- **Annotation PDF** (Highlight / Underline / Strikethrough, tab Notes): cần thiết kế neo
  (`PageRectLocation(page, rect)` + quads/offset text layer) và overlay vẽ riêng. Không đổi schema.
- **Read Aloud**: bộ duyệt text layer PDF + "đọc từ vị trí".
- Trang đôi, xoay trang, ảnh thu nhỏ trang, nền tối cho trang PDF, tô mục lục đang đọc: chưa làm.
- Word Count với PDF scan vẫn báo `ok` + 0 từ thay vì "không có text".
