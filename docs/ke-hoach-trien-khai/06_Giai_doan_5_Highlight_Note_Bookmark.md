# Giai đoạn 5 — Highlight, Note & Bookmark

**Mục tiêu:** Đánh dấu tri thức trong lúc đọc; xem lại và nhảy về đúng đoạn — **trong Reader theo từng sách**.

**Mockup:** sidebar Note · Typewriter · Bookmark trong `[reading.html](../mockups/reading.html)`  
**SRS:** FR-06, FR-07, FR-09, FR-11 · **UC-03–06** · **WF-04** · **BR-01, BR-02**  
**SDS:** không còn SCR-04 toàn cục · bảng thống nhất `annotations` (migration `011` → `012`)

**Điều kiện vào:** G4 có LocationCodec + persist ổn.

> **Ký hiệu:** task **in đậm** = đã làm trong code hiện tại; không in đậm = chưa làm hoặc mới có shell.

---

## 0. Schema overlay (gộp bảng `annotations`)

Sau G5, mọi markup trên sách dùng **một bảng** `annotations` (SDS 1.21 / migration `012`):


| Thay đổi                 | Chi tiết                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `annotations`            | `type`: `highlight` | `underline` | `strikethrough` | `freehand` | `textbox` | `stamp` |
| `style_properties`       | JSON gom `colorHex`, `note`, `fontFamily`, `fontSize`, … — tránh cột NULL theo type    |
| `location_data`          | Opaque theo type: packed CFI/`start|end`, JSON geometry (vẽ), `{xPct,yPct}` (textbox)  |
| `annotation_tags`        | N–N optional — UI tag **nợ G5+**                                                       |
| Bỏ bảng cũ               | `highlights`, `typewriter_notes`, `comments` — migrate qua `011`/`012`                 |
| **Không** `app_settings` | App prefs vẫn electron-store / MMKV (SDS 1.17)                                         |


Domain: `Annotation` (persist) + `Highlight` (view model text-range cho renderer).  
Port: `OverlayStore.saveAnnotation` / `listAnnotations` / `updateAnnotation` / `deleteAnnotation`.  
Overlay paint EPUB highlight: `DomCssOverlay` implements `OverlayPainter`.

---



## 1. Outcome

1. Bôi chọn text → Highlight trong **≤ 2 thao tác**.
2. Thêm / sửa ghi chú **inline** trên highlight (`style.note`); note rỗng không tạo mới.
3. **Typewriter:** gõ chữ đè lên trang; lưu local, xem lại trong sidebar.
4. **Pencil / Shape:** vẽ nét tự do / hình cơ bản trên bề mặt đọc; lưu local, repaint khi mở lại.
5. Bookmark vị trí để quay lại nhanh.
6. Mở lại sách → highlight (và markup khác) vẽ lại đúng chỗ.
7. Sidebar list Note / Typewriter / Bookmark → Jump đúng location.
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
| **T5.3**  | `DomCssOverlay` vẽ lại khi mở sách / sau khi thêm / đổi màu                   | FR-06 |
| **T5.3b** | Panel sửa màu highlight đã có + persist `style_properties.colorHex`           | FR-06 |
| **T5.4**  | Sửa `style.note` trên highlight (selection hoặc sidebar / modal)              | FR-07 |
| **T5.10** | Xóa highlight — đồng bộ overlay + DB + undo stack                             | FR-07 |




### 2.3 Typewriter — viết chữ đè trang


| Task      | Chi tiết                                                                                        | FR         |
| --------- | ----------------------------------------------------------------------------------------------- | ---------- |
| **T5.6a** | Tool **Typewriter** trên toolbar + đặt textbox trên fake canvas (`activeTool === 'typewriter'`) | SDS SCR-03 |
| **T5.6b** | Persist `type=textbox`: IPC save/list/update/delete + hydrate khi mở sách                       | SDS SCR-03 |
| **T5.6c** | Sửa nội dung / xóa / kéo vị trí textbox (desktop); click textbox cũ trong tool → edit            | SDS SCR-03 |
| **T5.6d** | EPUB / PDF: neo textbox theo `location_data` ổn định (CFI+offset EPUB; `page-rect` contract PDF — render **G6**) | SDS SCR-03 |




### 2.4 Pencil & Shape — vẽ hình


| Task       | Chi tiết                                                                                | FR         |
| ---------- | --------------------------------------------------------------------------------------- | ---------- |
| **T5.11a** | Tool **Pencil** / **Shape** / **Eraser** trên toolbar + popover tuỳ chọn (màu, độ dày)  | SDS SCR-03 |
| T5.11b     | Vẽ **freehand** (pencil) trên reading surface — pointer down/move/up                    | —          |
| T5.11c     | Vẽ **shape** cơ bản (rect / ellipse) — kéo thả                                          | —          |
| T5.11d     | **Eraser** xóa stroke/shape đã chọn hoặc hit-test                                       | —          |
| T5.11e     | Persist `type=freehand` + `location_data` geometry JSON; repaint khi đổi trang / resume | —          |
| T5.11f     | EPUB / PDF: neo geometry theo `page_number` + location (Canvas overlay — PDF **G6**)    | —          |




### 2.5 Bookmark · Sidebar · Library


| Task      | Chi tiết                                                                                            | FR    |
| --------- | --------------------------------------------------------------------------------------------------- | ----- |
| **T5.5**  | Bookmark add / list / jump / xóa (persist SQLite)                                                   | FR-11 |
| **T5.7a** | Sidebar tabs **Note · Typewriter · Bookmark** — list scoped `bookId` (highlight, textbox, bookmark) | FR-09 |
| T5.7b     | Tab Note chỉ liệt kê highlight **có** `note`; empty state “No notes yet”                            | FR-09 |
| T5.8      | Jump từ list → scroll/navigate đúng CFI / trang / vị trí overlay (Note · Bookmark · Typewriter)     | FR-09 |
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

- [ ] Migration `011`/`012` chạy trên DB dev
- [ ] ≥ 3 highlight + ≥ 1 highlight có `note`; restart app vẫn còn
- [ ] File EPUB không đổi trên đĩa
- [ ] Highlight từ selection ≤ 2 thao tác chính
- [ ] Typewriter đặt → đóng sách → mở lại còn đúng chỗ (sau T5.6b)
- [ ] T5.6c: tool Typewriter → click textbox cũ → edit (không tạo mới); kéo vị trí persist; xóa (sidebar / empty / Delete) + undo
- [ ] T5.6d: EPUB textbox neo CFI+offset — đổi font/margin vẫn đúng chỗ; sidebar jump qua CFI; kéo thả nâng cấp legacy `%`; PDF: contract `page-rect` + chặn đặt mới đến G6
- [ ] Pencil vẽ → persist → mở lại còn nét (sau T5.11e)
- [ ] Jump từ sidebar đúng đoạn / đúng trang
- [ ] Không có màn Notes toàn cục trong nav

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
| **TOOL-TW1** | Typewriter overlay persist + EPUB neo            | **G5** (T5.6b–d) · [12](./12_Reader_Tools_Search_Speech_Translate_Typewriter.md) |
| —            | Pencil / Shape / Eraser persist                  | **G5** (T5.11b–f) · canvas PDF **G6**                                            |


