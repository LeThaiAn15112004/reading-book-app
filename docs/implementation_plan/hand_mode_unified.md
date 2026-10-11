# Hand mode thống nhất cho mọi định dạng (theo mẫu EPUB)

Tiếp nối `pdf_toolbar_hand_select.md`. Đường dẫn tính từ `source/apps/reading-book-desktop/`.
Trạng thái trước khi sửa: nhánh `anle-dev`, commit `d62d456`, working tree sạch. **Chưa chạy thử
trong Electron** — xem §6.

## 1. Định dạng và renderer (đã kiểm tra trong code)

`packages/config/formats.ts` khai báo epub, pdf, txt, md, docx, doc. `ReaderScreen.tsx` chọn surface:

| Định dạng | Renderer | Text chọn được | Link | Cuộn / pan | Sự kiện chọn text |
|---|---|---|---|---|---|
| EPUB | `reader/renderers/epub` — epub.js trong **iframe** | Có (DOM sách) | Có (`a[href]` trong sách) | Viewport zoom kiểu transform: pan chỉ khi zoom > 100 % (`onHandPanBy` chỉ truyền khi đó); chế độ cuộn dọc cuộn container của epub.js | Có — chọn → menu, dịch, highlight |
| PDF | `reader/renderers/pdf` — PDF.js canvas + text layer trong **document chính** | Có nếu trang có text layer; **PDF scan không có** (không OCR) | **Không** — chưa render annotation/link layer | Viewport zoom kiểu native: luôn là nơi cuộn, pan ở mọi mức zoom | Chỉ chọn native (Ctrl+C); chưa báo lên app |
| TXT, MD, DOCX, DOC | `screens/Reader/components/canvas/ReadingCanvas.tsx` — **placeholder** hiển thị `FAKE_CHAPTERS` (nội dung demo, **không phải nội dung sách**) | Có (DOM demo) | Không | `<main>` tự cuộn; zoom > 100 % thì cuộn viewport zoom | Không |

Không có renderer thật nào cho TXT / MD / DOCX / DOC; quy tắc Hand dưới đây áp dụng cho placeholder
để hành vi nhất quán, nhưng nội dung vẫn là demo.

## 2. Quy tắc Hand chung (mẫu: EPUB)

Lấy từ `EpubRenderer.tsx` (`onPointerHoverMove`, `onPointerDown`, `onPointerMove`, `endGesture`) và
`reader/interaction/cursors.ts`:

1. Con trỏ mặc định `grab`, kể cả trên chữ (kéo nhanh lướt qua chữ vẫn là pan).
2. Chuột **dừng** trên chữ (hoặc link) `HAND_HOVER_CURSOR_DELAY_MS` = 300 ms → "armed": I-beam
   trên chữ (pointer trên link). Rời khỏi chữ → về `grab`. Không cập nhật khi đang nhấn chuột.
3. Nhấn lên chữ khi đang armed → chọn text native.
4. Mọi lần nhấn khác → pan: bỏ armed, chặn chọn text, `grabbing`, kéo cuộn viewport.
5. Kéo ≥ `PAN_DRAG_THRESHOLD_PX` = 4 px là drag, không phải click.
6. Nhả chuột không drag, không để lại vùng chọn, ở 25–75 % chiều ngang → `onCenterTap`
   (`chrome.handleCenterTap`).
7. Đổi công cụ, mất focus cửa sổ, unmount: huỷ timer, trả pointer capture, bỏ `grabbing` / armed.

## 3. Phần dùng chung vs. riêng từng renderer

**Dùng chung — `src/reader/interaction/hand-gesture.ts` (mới, xuất qua `reader/interaction`):**
- `createHandHoverDwell(onArmedChange, delayMs = 300)` → `update(overTarget)`, `disarm()`,
  `isArmed()`, `dispose()`: máy trạng thái hover dwell (quy tắc 1–2), không phụ thuộc DOM, không
  phải React hook (trạng thái nằm trong closure; renderer tự giữ cờ hiển thị của mình).
- `exceedsDragThreshold(startX, startY, x, y)` (quy tắc 5).
- `isInCenterTapZone(clientX, { left, width })` (quy tắc 6).

Dùng bởi PDF và placeholder. **EPUB không bị sửa**: nó đã chạy đúng các quy tắc này trong iframe với
cùng hằng số (`HAND_HOVER_CURSOR_DELAY_MS`, `PAN_DRAG_THRESHOLD_PX`, `isHandHoverCursorTargetAtPoint`);
viết lại nó trên helper mới có rủi ro hồi quy (iframe, highlight, dịch, chuyển chương) mà không thay
đổi hành vi. Còn trùng lặp logic dwell giữa EPUB và helper — xem §7.

**Riêng từng renderer:**

| | Hit-test "đang trên chữ" | Bật / tắt chọn text | Con trỏ | Pan |
|---|---|---|---|---|
| EPUB (không đổi) | `isHandHoverCursorTargetAtPoint(doc, …)` trong iframe | CSS chèn vào iframe: `rb-tool-hand`, `rb-hover-text`, `rb-grabbing` | như trái | `onHandPanBy` → `handleHandPanBy`, hoặc scroll container epub.js |
| PDF | `elementFromPoint` → `.textLayer span` trong khối trang | Thuộc tính `data-pdf-tool`, `data-pdf-hover-text`, `data-pdf-grabbing` (hai cờ sau đặt bằng `toggleAttribute`, đồng bộ, để `user-select:none` có hiệu lực trước khi trình duyệt kịp bắt đầu chọn) + quy tắc trong `index.css` (ngoài `@layer`, đè `pdf_viewer.css`) | như trái | `onHandPanBy` → `handleHandPanBy` (viewport native); thiếu callback thì cuộn scroll root |
| Placeholder | `isHandHoverCursorTargetAtPoint(document, …)` (như EPUB) | `applySurfaceSelect(false/true)` khi bắt đầu / kết thúc pan | class `cursor-hand-tool` / `cursor-select-tool` | `onHandPanBy` hoặc cuộn `<main>` |

## 4. Select vẫn khác Hand

- **EPUB:** không đổi.
- **PDF:** Select = chọn text ở mọi chỗ trên text layer, con trỏ text, không pan.
- **Placeholder:** Select giữ nguyên hành vi cũ: chữ → chọn, lề → pan (chỉ thêm: tắt chọn text trong
  lúc pan lề và kết thúc pan khi nút chuột đã nhả).
- Highlight / Underline / Strikethrough: chỉ EPUB có; không đổi.

## 5. File đã sửa

| File | Thay đổi |
|---|---|
| `src/reader/interaction/hand-gesture.ts` (mới) | Helper dùng chung ở §3 |
| `src/reader/interaction/index.ts` | Xuất helper |
| `src/reader/renderers/pdf/PdfRenderer.tsx` | Hand theo quy tắc chung: dwell trên text layer, nhấn chữ đã armed → chọn, còn lại → pan; cờ `data-pdf-hover-text` / `data-pdf-grabbing`; huỷ khi đổi công cụ, blur cửa sổ (listener `blur` riêng của component), pointercancel, lostpointercapture, rời khối trang, unmount. Bỏ class Tailwind con trỏ / select (chuyển hết sang CSS theo `data-pdf-tool`) |
| `src/index.css` | Quy tắc PDF: `select` (text + I-beam), `hand` (grab, không chọn), `hand` + hover-text (I-beam, chọn được trên text layer), `hand` + grabbing (grabbing, không chọn, `!important`) |
| `src/screens/Reader/components/canvas/ReadingCanvas.tsx` | Hand: dwell thay cho "I-beam ngay khi chạm chữ"; chỉ chữ đã armed mới chọn, nhấn chữ chưa armed thì pan; tắt chọn text khi pan; kết thúc pan khi nhả chuột ngoài / blur / pointercancel |
| `spikes/reader-hand/run-hand.mjs` (mới), `package.json` | `npm run spike:reader:hand` |

Không đổi schema, IPC, dependency, capability toolbar.

## 6. Kiểm tra

### Tự động (đã chạy)

| Lệnh | Kết quả |
|---|---|
| `npm run typecheck` | Đạt |
| `npx eslint --report-unused-disable-directives --max-warnings 0` trên file đã sửa | Đạt |
| `npm run lint` (toàn repo) | Không đạt — **26 lỗi/cảnh báo có sẵn**, đều ở file không sửa (cùng con số trước khi sửa) |
| `npx vite build` | Đạt; CSS bundle có các quy tắc `[data-pdf-tool=…]` và biến `--cursor-hand-tool` |
| `npm run spike:reader:hand` (mới) | Đạt, 12 kiểm tra: dwell (arm sau delay, lướt qua không arm, rời → disarm, disarm/dispose huỷ timer), ngưỡng drag 4 px, vùng center tap, wiring tĩnh PDF / placeholder / EPUB |
| `npm run spike:reader:toolbar` | Đạt, 22 kiểm tra |
| `npm run spike:session:roundtrip` | Đạt |

Repo không có test runner; các spike là toàn bộ kiểm tra tự động.

### Thủ công trong Electron (CHƯA làm — build đạt không chứng minh cử chỉ chạy đúng)

Với EPUB, PDF có text, **PDF scan**, và một file TXT (placeholder):

1. Hover: grab → sau ~300 ms trên chữ thành I-beam; rời chữ về grab; lướt nhanh qua chữ vẫn grab.
2. Hand: dừng trên chữ rồi kéo → bôi đen; vùng bôi đen khớp chữ (PDF).
3. Hand: nhấn lề / khoảng trống / chữ chưa armed rồi kéo → trang cuộn, không bôi đen, con trỏ grabbing.
4. PDF scan: Hand luôn pan (không có chữ để arm); Select không chọn được gì.
5. Click không kéo ở giữa → đóng menu nổi; sau khi kéo hoặc sau khi bôi đen → không.
6. Thả chuột ngoài cửa sổ, Alt+Tab khi đang kéo → không kẹt grabbing / không kẹt tắt chọn text.
7. Đổi Hand ↔ Select nhiều lần, kể cả khi I-beam đang armed → không còn con trỏ / cờ cũ.
8. Ctrl+wheel zoom, cuộn thường, tìm kiếm (tô + nhảy), điều hướng trang, bookmark vẫn chạy.
9. EPUB: Hand / Select / highlight / dịch / link / chuyển chương như trước.

## 7. Giới hạn và việc còn lại

- **PDF không có link**: chưa render annotation layer của PDF.js, nên Hand không có trạng thái
  "pointer trên link" ở PDF.
- **PDF scan**: không có text layer → không chọn được text ở cả hai công cụ; Hand chỉ pan. Không OCR.
- **TXT / MD / DOCX / DOC**: chỉ là placeholder nội dung demo; cần renderer thật để quy tắc Hand có ý
  nghĩa với sách thật.
- **EPUB vẫn có bản sao logic dwell riêng** (`EpubRenderer.onPointerHoverMove`, `applyHandSurface`).
  Có thể chuyển sang `createHandHoverDwell` sau, kèm kiểm tra thủ công EPUB đầy đủ.
- PDF Hand chỉ pan khi zoom bất kỳ (viewport native luôn cuộn được); EPUB chỉ pan khi zoom > 100 %
  hoặc ở chế độ cuộn — khác biệt do cách dàn trang, không phải do quy tắc Hand.
