# Reader Toolbar — nhóm công cụ theo khả năng của renderer

Thiết kế lại thanh công cụ trên cùng của Reader để **thêm công cụ mới không phải thiết kế lại thanh**: mỗi
định dạng chỉ hiện công cụ renderer của nó thực sự làm được, công cụ liên quan được gom nhóm, nhóm ít dùng tự
gập thành dropdown khi cửa sổ hẹp. Không thêm chức năng đọc / annotation mới.

## 1. Kết quả inspect (trước khi code)

| Thành phần | Hiện trạng |
|---|---|
| Toolbar | `screens/Reader/components/chrome/ReaderTopbar.tsx` → `ToolsStrip` (`ToolsMenu.tsx`), nút `⋮` → `MoreMenu.tsx`. ~25 props truyền từng công cụ một từ `ReaderScreen.tsx`. |
| Nhận diện định dạng | `useReaderBookOpen` → `book.bookFormat` (`'epub' \| 'pdf' \| 'txt' \| …`), `book.isEpubSurface` (epub + bytes + ready). |
| Renderer | **Chỉ EPUB có renderer thật** (`src/reader/renderers/epub`). PDF / TXT / MD / DOCX / DOC rơi vào `ReadingCanvas` với `FAKE_CHAPTERS` (nội dung demo). Chưa có `renderers/pdf` (xem `pdfAnnotationTools.ts`). |
| Search / Audio / Translate / Highlight… | Đều đi qua `EpubRendererApi` (`bookSearchStore.paintHits`, `useReadAloud.available = isEpubSurface && …`, `translationStore` nhận `EpubSelectionInfo`, `useReaderHighlights` gate `isEpubSurface`). Với định dạng khác bấm vào không làm gì / chỉ toast. |
| Snapshot | `webContents.capturePage` ở Main — không phụ thuộc renderer. |
| Word Count | `bookIndexApi` (chunk FTS trong Main) — không phụ thuộc renderer. |
| Zoom / Fit / Fullscreen | Đã có **một chỗ duy nhất**: footer (`ZoomControl`: −, %, +, Actual Size / Fit Page / Fit Width / Fit Visible; `FullscreenButton`). Phím tắt `view.*` qua registry. |
| Textbox / Freehand | Nút hiện với non-EPUB nhưng chỉ toast "coming soon". |
| Dropdown có sẵn | `ZoomControl` preset menu, `MoreMenu`, `ReadAloudMenu` + hook `useDismissOnOutsideOrEscape` (đóng khi click ngoài **kể cả trong iframe EPUB**, `consumeEscape` để Esc không chạy tiếp chuỗi Esc của reader). |
| Phím tắt | `shortcuts/shortcutDefinitions.ts` (registry, người dùng tuỳ chỉnh được), `useShortcutLabel`. Highlight / Underline / Strikethrough **chưa** có trong registry. |

Hệ quả cho thiết kế:
- Dropdown **View** (Zoom / Reset / Fullscreen) thêm ở commit `644cd97` **trùng** footer → gỡ khỏi toolbar.
- Định dạng chưa có renderer không được hiện Search / Audio / Translate / Highlight… (bấm không có tác dụng).
- Textbox / Freehand bỏ khỏi toolbar tới khi có renderer PDF (không làm nút "coming soon").

## 2. Cấu trúc toolbar

Ký hiệu: **inline** = nút trực tiếp; **gập** = inline khi đủ chỗ, thành dropdown khi hẹp; **dropdown** = luôn là
dropdown. Thứ tự trái → phải, các nhóm cách nhau bằng vạch dọc. `⋮ More` luôn ở cuối, chỉ chứa thao tác *tài
liệu* (Share, Favorites, Book info, Move to trash) — không bao giờ chứa công cụ đọc.

### 2.1 EPUB (hiện tại)

| Nhóm | Công cụ | Hiển thị |
|---|---|---|
| Navigate | Hand, Select, Search, Audio, Translate | inline (không gập) |
| Annotation | Highlight, Underline, Strikethrough | gập → `Annotation ⌄` (gập **sau cùng**) |
| Tools | Snapshot, Word Count | gập → `Tools ⌄` (gập **đầu tiên**) |
| Settings | Settings (Aa) | inline (không gập) |
| — | `⋮ More` | inline |

Zoom, Fit, Fullscreen: ở footer như cũ (không lặp lại trên toolbar).

### 2.2 PDF / TXT / MD / DOCX / DOC (hiện tại: chưa có renderer)

| Nhóm | Công cụ | Hiển thị |
|---|---|---|
| Navigate | Hand, Select | inline |
| Tools | Snapshot, Word Count | gập → `Tools ⌄` |
| Settings | Settings | inline |

Ẩn: Search, Audio, Translate, Highlight / Underline / Strikethrough, Textbox, Freehand (trước đây hiện nhưng không
chạy).

### 2.3 PDF (định hướng — khi có `src/reader/renderers/pdf`)

| Nhóm | Công cụ | Hiển thị |
|---|---|---|
| Navigate | Hand, Select, Search | inline |
| Annotation | Highlight, Underline, Strikethrough, Comment, Pencil, Text Box, Shapes, Eraser | dropdown (> 4 công cụ) |
| View | Rotate Left, Rotate Right, chế độ trang (single / spread / scroll) | gập → `View ⌄` |
| Tools | Snapshot, Word Count | gập |
| Settings | Settings | inline |

Zoom In / Out / Fit Width / Fit Page **giữ ở footer** (đã có, dùng chung mọi định dạng). Nếu sau này muốn zoom
nằm trên toolbar PDF thì *chuyển* (bỏ ở footer cho PDF), không đặt cả hai.

### 2.4 TXT / Markdown (định hướng — khi có renderer text)

| Nhóm | Công cụ | Hiển thị |
|---|---|---|
| Navigate | Hand, Select, Search, Go to Line | inline |
| View | Word Wrap, Line Numbers (toggle, hiện dấu active) | gập → `View ⌄` |
| Annotation | Highlight, Underline, Strikethrough — chỉ khi renderer hỗ trợ | gập |
| Tools | Snapshot, Word Count | gập |
| Settings | Settings | inline |

Find Next / Find Previous **không** lên toolbar: đã có trong panel Search (Enter / Shift+Enter, `search.*`).

## 3. Quy tắc bố trí

1. **Capability, không phải if-format.** Mỗi renderer khai báo một tập `ReaderCapability`
   (`src/reader/capabilities.ts`); công cụ khai báo `requires`. Thiếu capability → không render (không disable).
2. **Nhóm** (`TOOL_GROUPS` trong `toolRegistry.ts`): `navigate`, `annotation`, `view`, `tools`, `settings`.
   `navigate` và `settings` không bao giờ gập (công cụ dùng thường xuyên; menu Audio neo vào nút của nó).
3. Nhóm có **> 4 công cụ** (`INLINE_MAX`) luôn là dropdown.
4. Khi thanh tràn: gập lần lượt theo `FOLD_ORDER` = `tools` → `view` → `annotation` (ít dùng trước). Rộng ra
   lại thì bung theo thứ tự ngược. Đo bằng `ResizeObserver` (`useToolbarOverflow`). Hết nhóm để gập thì thanh
   vẫn cuộn ngang — phương án cuối, không mất công cụ.
5. Nhóm rỗng (renderer không hỗ trợ công cụ nào trong nhóm) không render, kể cả vạch phân cách.

## 4. Hành vi dropdown

- Nút: icon + nhãn nhóm + chevron (xoay khi mở), `aria-haspopup="menu"`, `aria-expanded`.
- Khi một công cụ trong nhóm đang bật (vd. Underline): nút hiện icon + nhãn của công cụ đó, viền/nền accent —
  trạng thái active nhìn thấy được kể cả khi đã gập.
- Menu: portal + `position: fixed` (thanh có `overflow-x-auto` sẽ cắt menu absolute), căn theo nút và kẹp trong
  cửa sổ, `max-height: 60vh` + cuộn để không che quá nhiều nội dung đọc.
- Đóng khi: chọn một mục, Esc (tiêu thụ Esc — không đồng thời huỷ tool / ẩn chrome), click ngoài (kể cả trong
  iframe EPUB — dùng lại `useDismissOnOutsideOrEscape`), resize, cửa sổ mất focus, thanh công cụ bị ẩn.
- Bàn phím: mở → focus mục đầu; ↑ / ↓ / Home / End di chuyển; Enter / Space chọn (nút gốc).
- Mỗi mục: icon, nhãn, phím tắt bên phải (từ registry, theo tuỳ chỉnh người dùng), `aria-checked` cho công cụ
  đang bật.

## 5. Tooltip & phím tắt

- `title` = mô tả ngắn (vd. "Hand — pan and turn pages") + phím tắt nếu có: `Search in book (Ctrl+F)`.
- `ToolDef.shortcutId` trỏ vào `ShortcutId`; nhãn đọc qua `effectiveShortcutKeys` nên đổi phím trong Settings là
  tooltip / menu đổi theo. Thêm phím cho Highlight… sau này = thêm vào `shortcutDefinitions.ts` + `shortcutId`.

## 6. Thêm một công cụ sau này

1. `toolRegistry.ts`: thêm id vào `ToolId`, một dòng `TOOL_REGISTRY` (`group`, `requires`, `shortcutId`,
   `description`), icon trong `ToolIcon`.
2. `capabilities.ts`: thêm capability vào renderer hỗ trợ nó.
3. `ReaderScreen.tsx`: một nhánh trong `handleTool(id)` và trạng thái trong `toolStates`.

Không sửa `ToolsStrip`, `ToolGroupMenu`, quy tắc gập.

## 7. Thay đổi code

| File | Thay đổi |
|---|---|
| `src/reader/capabilities.ts` | `ReaderSurface` (`epub` \| `placeholder`), capability thật của từng surface, `getReaderCapabilities(format)`. |
| `components/chrome/toolRegistry.ts` | `TOOL_REGISTRY`, `TOOL_GROUPS`, `INLINE_MAX`, `FOLD_ORDER`; bỏ View (zoom/fullscreen), Textbox, Freehand. |
| `components/chrome/toolbarLayout.ts` (mới) | Hàm thuần `resolveToolbarLayout(capabilities, foldLevel)` → nhóm + chế độ inline/menu. |
| `components/chrome/ToolsMenu.tsx` | `ToolsStrip` generic: render từ layout, nhận `toolStates` + `onTool(id)`. |
| `components/chrome/ToolGroupMenu.tsx` | Dùng `useDismissOnOutsideOrEscape` (iframe + consumeEscape), phím mũi tên, max-height, đóng khi chrome ẩn. |
| `ReaderTopbar.tsx`, `ReaderScreen.tsx` | Gom ~15 prop công cụ thành `toolStates` + `onTool`; bỏ `onViewTool`. |
| `spikes/reader-toolbar/run-toolbar.mjs` (mới) | `npm run spike:reader:toolbar`. |

## 8. Kiểm tra (chạy thật)

| Lệnh | Kết quả |
|---|---|
| `npm run typecheck` | Sạch. |
| `npx eslint` trên các file đã đổi (`--max-warnings 0`) | Sạch. |
| `npm run lint` (toàn repo) | 27 problems (12 errors, 15 warnings) — **giống hệt HEAD trước thay đổi** (EpubRenderer, ShelfDetailView, useCloudSources…), không có lỗi mới. |
| `npx vite build` | Build được (renderer, main, preload). |
| `npm run spike:reader:toolbar` | 17/17 checks: registry, surface mapping, layout EPUB / placeholder, thứ tự gập, không trùng footer, mọi tool có nhánh `handleTool`, dropdown dùng `useDismissOnOutsideOrEscape` + `consumeEscape`. |
| `npm run spike:settings:shortcuts` | Đạt (registry phím tắt không đổi). |

### Kiểm tay (repo không có UI test)

- [ ] EPUB, cửa sổ rộng: thanh giống trước (Hand … Settings), không còn nút View.
- [ ] Thu hẹp cửa sổ: `Snapshot / Word Count` gập thành `Tools ⌄` trước, rồi `Annotation ⌄`; kéo rộng ra bung lại.
- [ ] Đang bật Underline khi đã gập: nút hiện "Underline" màu accent; mở menu thấy mục Underline được đánh dấu.
- [ ] Dropdown: Esc đóng menu và *không* đồng thời tắt tool / ẩn chrome; click vào trang sách (iframe) đóng menu;
      ↑ / ↓ di chuyển; ẩn chrome (immersive) thì menu đóng.
- [ ] Audio vẫn mở menu đọc to neo dưới nút; Translate vẫn bỏ trạng thái pressed của Select.
- [ ] Mở sách PDF / TXT: chỉ có Hand, Select, Snapshot, Word Count, Settings.
- [ ] Zoom, Fit, Fullscreen ở footer và phím `Ctrl/Cmd + = / - / 0`, `F11` vẫn hoạt động.

## 9. Hành vi đổi so với trước

- Gỡ dropdown **View** (Zoom / Reset / Fullscreen) khỏi toolbar EPUB (thêm ở `644cd97`) — trùng footer.
- Định dạng chưa có renderer không còn hiện Search, Audio, Translate, Highlight / Underline / Strikethrough,
  Textbox, Freehand (trước đó bấm không có tác dụng hoặc chỉ toast "coming soon").
- Thứ tự gập đổi thành Tools → Annotation (trước: Annotation → Tools) — Annotation dùng nhiều hơn khi đọc.
- Tooltip có mô tả + phím tắt (vd. Search: `Search in book (Ctrl+F)`).
