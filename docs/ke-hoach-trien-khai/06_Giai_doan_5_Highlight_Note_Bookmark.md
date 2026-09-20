# Giai đoạn 5 — Highlight, Note & Bookmark

**Mục tiêu:** Đánh dấu tri thức trong lúc đọc; xem lại và nhảy về đúng đoạn — **trong Reader theo từng sách**.

**Mockup:** sidebar Note · Bookmark trong `[reading.html](../mockups/reading.html)`  
**SRS:** FR-06, FR-07, FR-09, FR-11 · **UC-03–06** · **WF-04** · **BR-01, BR-02**  
**SDS:** không còn SCR-04 toàn cục · bảng thống nhất `notes` (migration `018`/`019`, sau khi đi qua `011`→`017` dưới tên `annotations`)

**Điều kiện vào:** G4 có LocationCodec + persist ổn.

> **Ký hiệu:** task **in đậm** = đã làm trong code hiện tại; không in đậm = chưa làm hoặc mới có shell.
>
> **Cập nhật sau khi hoàn thiện G5 (SDS 1.22):** kế hoạch gốc bên dưới có 2 nhánh **không** đi đến bản dựng cuối — giữ nguyên nội dung gốc để tham chiếu lịch sử, nhưng đọc kèm ghi chú "ĐÃ BỎ" ở §2.3/§2.4:
> - **Typewriter** (T5.6a–d, textbox tự do kéo-thả, rich text) **đã bị bỏ hẳn**. Việc "ghi chú không tô màu" nay là style kind **`textbox`** — một sticky-note 📝 gắn trực tiếp vào vị trí selection (giống highlight/underline), không phải ô văn bản đặt tự do trên canvas.
> - **Pencil / Shape / Eraser** (T5.11a–f, vẽ tự do) **chưa từng triển khai UI** — `freehand`/`stamp` chỉ còn là giá trị `type` hợp lệ trong schema (`note_json.type`), chờ một PDF renderer (chưa tồn tại) vì EPUB reflow không có mặt phẳng ổn định để vẽ/neo hình học. Xem `apps/reading-book-desktop/src/screens/Reader/logic/hooks/pdfAnnotationTools.ts`.
> - Việc "vẽ lại" highlight/underline/strikethrough/textbox khi mở sách/re-render **không** đi qua `DomCssOverlay`/`OverlayPainter` — engine tự lo (EPUB: `rendition.annotations` của epub.js). Xem SDS §2.6/2.8 (changelog 1.22).

---

## 0. Schema overlay (gộp bảng `annotations`, rồi gộp tiếp vào `notes`)

**Trạng thái cuối (SDS 1.22):** mọi markup **và bookmark** trên sách dùng **một bảng** `notes` với cột JSON `note_json` (migration `018` gộp `annotations`, `019` gộp thêm `bookmarks`) — không còn cột SQL cứng cho từng thuộc tính như bản kế hoạch gốc bên dưới mô tả cho `annotations` (migration `012`):


| Thay đổi                 | Chi tiết                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `notes.note_json.type`   | `highlight` \| `underline` \| `strikethrough` \| `textbox` \| `bookmark` (`freehand`/`stamp` còn trong schema, chưa có UI tạo mới) |
| `notes.note_json.group`  | `'annotation'` hay `'bookmark'` — thay cho 2 bảng riêng (`annotations` + `bookmarks`) |
| `note_json.style`        | JSON gom `colorHex`, `fontFamily`, `fontSize`, … — tương đương `style_properties` cột rời cũ |
| `note_json.locatorExtended` / `pdfAnnotation` | `locator` (jump target) + `raw` (payload vẽ lại) — tương đương `location_ref` + `location_data` cột rời cũ |
| `note_tags`              | N–N optional — UI tag **nợ G5+** (đổi tên từ `annotation_tags`)                        |
| Bỏ bảng cũ               | `highlights` (009), `typewriter_notes` (010), `comments` (004, xóa ở 010), `annotations`+`annotation_tags` (011–017, gộp ở 018), `bookmarks` đứng riêng (gộp ở 019), `book_signatures` (gộp thẳng vào cột `books`, 018) |
| **Không** `app_settings` | App prefs vẫn electron-store / MMKV (SDS 1.17)                                         |


Domain: `HighlightRecord` + `BookmarkRecord` (view models, `packages/domain/models/annotation/`) — không có class `Annotation` chung, chỉ có `INoteState` (shape JSON) làm hợp đồng persist.  
Port: `OverlayStore.saveHighlight` / `listHighlights` / `deleteHighlight` / `saveBookmark` / `listBookmarks` / `deleteBookmark` (không có `saveAnnotation`/`updateAnnotation` chung — mỗi khái niệm ứng dụng có method riêng, cùng ghi vào bảng `notes`).  
Overlay paint EPUB highlight: **không qua `OverlayPainter`/`DomCssOverlay`** — `EpubjsHandle.applyHighlight`/`removeHighlight` (trong `openEpubjs.ts`) gọi thẳng API annotation có sẵn của epub.js (`rendition.annotations`).

---



## 1. Outcome

1. Bôi chọn text → Highlight trong **≤ 2 thao tác**.
2. Thêm / sửa ghi chú **inline** trên highlight (`note_json.note`); note rỗng không tạo mới.
3. **Textbox:** sticky-note 📝 gắn vào một selection (thay cho Typewriter tự do — xem §2.3, bị bỏ khỏi kế hoạch gốc).
4. ~~Pencil / Shape~~ — chưa triển khai (xem §2.4).
5. Bookmark vị trí để quay lại nhanh.
6. Mở lại sách → highlight (và markup khác) vẽ lại đúng chỗ.
7. Sidebar list Note / Bookmark → Jump đúng location.
8. Từ Library “Notes (n)” → mở Reader + tab Note của sách đó (đếm highlight có `note`).

---



## 2. Việc cần làm



### 2.1 Schema & domain (sau gộp bảng)


| Task      | Chi tiết                                                                                               | FR       |
| --------- | ------------------------------------------------------------------------------------------------------ | -------- |
| **T5.0**  | Migration `009` → `011` → `012` + domain `Annotation` / `Highlight` / `Tag`; bỏ entity `Note` riêng    | SDS §3   |
| **T5.0b** | Port `OverlayStore`: `saveAnnotation`, `listAnnotations`, `updateAnnotation`, `deleteAnnotation` + IPC | SDS §2.6 |




### 2.2 Highlight — bôi chọn / tô màu


| Task      | Chi tiết                                                                      | FR    |
| --------- | ----------------------------------------------------------------------------- | ----- |
| **T5.1**  | Selection → context action Highlight (tooltip / menu)                         | FR-06 |
| **T5.1b** | Tool **Highlight** trên toolbar: bôi chọn → tô màu ≤ 2 thao tác (EPUB + fake) | FR-06 |
| **T5.2**  | Lưu highlight (`location_data`, màu) vào `annotations` (`type=highlight`)     | FR-06 |
| **T5.3**  | Vẽ lại mark khi mở sách / sau khi thêm / đổi màu — **không qua `DomCssOverlay`**, epub.js tự tái gắn mark (xem §0) | FR-06 |
| **T5.3b** | Panel sửa màu highlight đã có + persist `style_properties.colorHex`           | FR-06 |
| **T5.4**  | Sửa `style.note` trên highlight (selection hoặc sidebar / modal)              | FR-07 |
| **T5.10** | Xóa highlight — đồng bộ overlay + DB + undo stack                             | FR-07 |




### 2.3 Typewriter — viết chữ đè trang **(ĐÃ BỎ — xem ghi chú đầu file)**

> Kế hoạch gốc bên dưới hình dung Typewriter là một ô văn bản tự do kéo-thả trên canvas, tách biệt highlight. Bản dựng cuối **không đi theo hướng này**: thư mục `src/reader/typewriter/` (`TypewriterRichEditor.tsx` và các file liên quan) đã bị xóa khỏi codebase. Nhu cầu "ghi chú không tô màu, gắn vào một điểm trong text" được `textbox` — một `HighlightStyleKind` — đảm nhiệm: cùng cơ chế selection → mark như highlight/underline, chỉ khác không tô màu mà hiện icon 📝 (xem `useReaderHighlights.ts`, `NoteTextboxPopup.tsx`).

| Task      | Chi tiết (kế hoạch gốc, **không** phản ánh trạng thái cuối)                                     | FR         |
| --------- | ----------------------------------------------------------------------------------------------- | ---------- |
| ~~T5.6a~~ | ~~Tool **Typewriter** trên toolbar + đặt textbox trên fake canvas~~ — thay bằng style kind `textbox` áp lên một selection | SDS SCR-03 |
| ~~T5.6b~~ | ~~Persist `type=textbox` (ô tự do)~~ — `textbox` persist như một `HighlightRecord` trong `notes` | SDS SCR-03 |
| ~~T5.6c~~ | ~~Kéo vị trí textbox tự do~~ — không áp dụng (textbox neo cố định vào vị trí selection, không kéo được) | SDS SCR-03 |
| ~~T5.6d~~ | ~~Neo theo `location_data` riêng cho ô tự do~~ — dùng chung `NoteLocator`/CFI như mọi highlight khác | SDS SCR-03 |




### 2.4 Pencil & Shape — vẽ hình **(ĐÃ BỎ — chưa từng có UI, xem ghi chú đầu file)**

> `freehand`/`stamp` vẫn là giá trị `type` hợp lệ trong `note_json` (tương thích dữ liệu cũ) nhưng **không có** tool Pencil/Shape/Eraser trên toolbar hiện tại và chưa từng được triển khai cho EPUB. `pdfAnnotationTools.ts` để sẵn 2 hàm rỗng (`beginFreehandStroke`, `placeStamp`) làm placeholder, chờ một PDF renderer thực sự tồn tại — EPUB reflow (text chảy lại theo font-size/viewport) không có "mặt phẳng" ổn định để vẽ/neo hình học lên.

| Task       | Chi tiết (kế hoạch gốc, **không** phản ánh trạng thái cuối)                            | FR         |
| ---------- | --------------------------------------------------------------------------------------- | ---------- |
| ~~T5.11a~~ | ~~Tool **Pencil** / **Shape** / **Eraser** trên toolbar~~ — chưa triển khai              | SDS SCR-03 |
| ~~T5.11b~~ | ~~Vẽ **freehand** (pencil)~~ — chưa triển khai                                           | —          |
| ~~T5.11c~~ | ~~Vẽ **shape** cơ bản~~ — chưa triển khai                                                | —          |
| ~~T5.11d~~ | ~~**Eraser**~~ — chưa triển khai                                                         | —          |
| ~~T5.11e~~ | ~~Persist `type=freehand` + geometry JSON~~ — schema (`note_json.type='freehand'`) sẵn sàng, không có caller tạo mới | —          |
| ~~T5.11f~~ | ~~Neo theo `page_number` + Canvas overlay (PDF)~~ — chờ PDF renderer (chưa tồn tại)      | —          |




### 2.5 Bookmark · Sidebar · Library


| Task      | Chi tiết                                                                                            | FR    |
| --------- | --------------------------------------------------------------------------------------------------- | ----- |
| **T5.5**  | Bookmark add / list / jump / xóa (persist SQLite)                                                   | FR-11 |
| **T5.7a** | Sidebar tabs **Note · Bookmark** — list scoped `bookId` (highlight/underline/strikethrough/textbox trong Note, bookmark riêng) | FR-09 |
| T5.7b     | Tab Note chỉ liệt kê highlight **có** `note`; empty state “No notes yet”                            | FR-09 |
| T5.8      | Jump từ list → scroll/navigate đúng CFI / trang / vị trí overlay (Note · Bookmark)                   | FR-09 |
| T5.9      | Đếm highlight có note trên Continue Reading → `Notes (n)` → mở Reader + tab Note                    | FR-09 |


**Nợ G5 (chấp nhận):** `status` / `is_checked` / **tags** — schema sẵn, UI sau; `underline` / `strikethrough` / `stamp` — type sẵn, UI sau G5.

---



## 3. Thứ tự khuyến nghị

```text
T5.0 / T5.0b (schema + port)
  → T5.1 / T5.1b → T5.2 → T5.3 / T5.3b
  → T5.4 → T5.10
  → T5.5 → T5.7a / T5.7b → T5.8 → T5.9
  → T5.6a → T5.6b → T5.6c → T5.6d
  → T5.11a → T5.11b → T5.11c → T5.11d → T5.11e → T5.11f
```

---



## 4. Nghiệm thu

- [x] Migration `011`→`019` chạy trên DB dev (schema cuối: `notes` + `note_tags`)
- [x] ≥ 3 highlight + ≥ 1 highlight có `note`; restart app vẫn còn
- [x] File EPUB không đổi trên đĩa
- [x] Highlight từ selection ≤ 2 thao tác chính (drag-to-select với tool Highlight/Underline armed)
- [x] `textbox` (sticky-note) đặt → đóng sách → mở lại còn đúng chỗ (thay Typewriter — xem §2.3)
- [x] Click mark (highlight/underline/strikethrough/textbox) cũ → mở popup edit (không tạo mới); kéo đầu mút resize (`beginRangeResize`/`commitRangeResize`) persist; xóa (sidebar / popup / phím Delete) + undo/redo
- [ ] ~~T5.6d EPUB textbox neo CFI+offset~~ — `textbox` dùng chung CFI range như highlight, không có contract `page-rect` riêng nữa; PDF vẫn chưa có renderer nên chưa render được
- [ ] ~~Pencil vẽ → persist~~ — không áp dụng, Pencil/Shape chưa từng triển khai (xem §2.4)
- [x] Jump từ sidebar đúng đoạn / đúng trang
- [x] Không có màn Notes toàn cục trong nav

---



## 5. Nợ được chấp nhận (G5) + backlog từ note.txt

Nguồn map: [11_Backlog_tu_note_san_pham.md](./11_Backlog_tu_note_san_pham.md).


| ID           | Nợ (ý note.txt)                                  | Trả ở                                                                            |
| ------------ | ------------------------------------------------ | -------------------------------------------------------------------------------- |
| —            | Overlay Canvas PDF                               | **G6**                                                                           |
| —            | Export notes / quote cards                       | **G8+**                                                                          |
| **NOTE-R5**  | **Đánh dấu trang** (bookmark) persist + jump     | **G5** ✓                                                                         |
| **NOTE-R7**  | **Note văn bản** inline trên highlight + sidebar | **G5** (T5.4 / T5.7b)                                                            |
| —            | Highlight màu + status / tags UI                 | **G5+** / Phase 3                                                                |
| **TOOL-TW1** | ~~Typewriter overlay persist + EPUB neo~~ — bỏ, thay bằng style kind `textbox` (§2.3) | Đã đóng — xem [12](./12_Reader_Tools_Search_Speech_Translate_Typewriter.md) |
| —            | ~~Pencil / Shape / Eraser persist~~ — chưa triển khai, `freehand`/`stamp` chỉ còn giá trị schema chờ PDF renderer | Sau khi có PDF renderer (chưa tồn tại) |


