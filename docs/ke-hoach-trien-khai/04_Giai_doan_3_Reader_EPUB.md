# Giai đoạn 3 — Reader (EPUB trước)

**Mục tiêu:** Mở sách từ Library vào Reader đúng mockup; đọc được ngay (fake OK trước) → rồi mới gắn EPUB thật + Invisible UI đầy đủ.

**Mockup:** `[reading.html](../mockups/reading.html)`  
**SRS:** FR-02, FR-03 · **UC-02** · **WF-03** · **BR-01, BR-04**  
**SDS:** SCR-03 (§4.6) · SCR-05 panel tạm (hardcode OK)

**Điều kiện vào:** G2 import được ≥ 1 sách. ✅ (G2 đã đạt — 2026-07-25)

**Trạng thái:** **T3.0–T3.9 đạt** — UI SCR-03; IPC bytes; **`EpubRenderer`**; **`ReaderShell`**; nav page/section/scroll + footer scrub spine + go-to-page; tap-center Invisible UI; TOC `nav.toc`; Library back; loading/error. Polish còn lại: smooth scroll máy yếu; không panel AI (đã đúng MVP).

---



## 1. Outcome



### Milestone A — UI Reader (ưu tiên trước)

1. Tap **bất kỳ sách nào** trên Library / shelf detail → vào SCR-03 **ngay**, không placeholder trống.
2. Layout bám `[reading.html](../mockups/reading.html)`: vùng đọc, top/footer chrome, Tools / Settings / More, sidebar (Chapters · Bookmark · Note · Comment).
3. Vùng đọc hiện **nội dung fake** (lorem / mẫu cố định) — title/author lấy từ sách đã chọn nếu có; **không** bắt buộc parse EPUB ở bước này.
4. Back → Library.



### Milestone B — EPUB thật (sau khi A ổn)

1. Nội dung EPUB sandbox hiện thay fake; chrome **ẩn mặc định**; tap giữa → hiện / ẩn.
2. Lật trang hoặc cuộn mượt; không popup giữa phiên.
3. File `.epub` gốc / sandbox **không** bị ghi đè khi đọc.

---



## 2. Việc cần làm


| Task     | Chi tiết                                                                                                                                                                                                                                                                                                                                                  | FR / SCR     |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **T3.0** | **Thiết kế chi tiết màn SCR-03 theo mockup** — port UI từ `reading.html` vào `ReaderScreen` (shell, typography, theme tạm, chrome, sidebar tabs). Nội dung vùng đọc = **fake** (đủ dài để cuộn / lật giả). Wire: tap card sách / Resume → `openReader(bookId)` → màn đọc **ngay lập tức** (mọi format trong list đều vào được; fake không phụ thuộc file) | SCR-03       |
| **T3.1** | ~~Spike chọn EPUB engine~~ **Đạt** — chốt `epubjs` ^0.3.93; ma trận `[spikes/epub-engine/MATRIX.md](../../source/apps/reading-book-desktop/spikes/epub-engine/MATRIX.md)`; SDS §2.10.1                                                                                                                                                                    | —            |
| **T3.2** | ~~Chốt `ReaderShell`~~ **Đạt** — `src/reader/ReaderShell.tsx`: vùng nội dung + chrome ẩn mặc định (reveal chevron; tap-center → T3.6)                                                                                                                                                                                                                    | FR-02, FR-03 |
| **T3.3** | ~~`EpubRenderer`~~ **Đạt** — `src/reader/renderers/epub/`; mở ArrayBuffer qua epubjs; thay fake khi `format === epub`                                                                                                                                                                                                                                      | FR-02        |
| **T3.4** | ~~Mở sách qua IPC~~ **Đạt** — `library:openBookContent(bookId)` → Main `assertPathAllowed` + `readFile` → `ArrayBuffer`; Renderer không nhận path FS                                                                                                                                                                                                      | FR-02        |
| **T3.5** | ~~Navigation~~ **Đạt** — page next/prev (phím Arrow ± iframe EPUB + click cạnh 25%; footer focus vẫn lật trang); Ctrl/Cmd+Arrow / `[` `]` = spine section; scroll `scrolled-doc`; footer scrub + go-to-page theo spine index (không CFI) | FR-03        |
| **T3.6** | ~~Tap center toggle Tools / Settings / More~~ **Đạt** — tap giữa vùng đọc (fake + EPUB iframe 25%–75%) bật/tắt chrome; đóng Settings/More/Comment rồi toggle; sidebar đóng không flip chrome; Escape dismiss chain; giữ `ToolsStrip` + `ChromeRevealButton` | FR-03        |
| **T3.7** | ~~Sidebar TOC~~ **Đạt** — mục lục từ EPUB `nav.toc` (sidebar Contents)                                                                                                                                                                                                                                                          | FR-03        |
| **T3.8** | ~~Library từ Reader~~ **Đạt** — Menubar Library → SCR-01; giữ scroll hub                                                                                                                                                                                                                                                        | WF-01        |
| **T3.9** | ~~Loading / lỗi~~ **Đạt** — IPC + EPUB timeout/message; không kẹt trắng                                                                                                                                                                                                                                                         | —            |


---



## 3. Thứ tự khuyến nghị

```text
T3.0  ← làm trước, DoD: tap sách nào cũng “đọc” được (fake)
  → T3.1 → T3.4 → T3.3 → T3.2
  → T3.5 → T3.6 → T3.7 → T3.8 → T3.9
```

Không chờ engine EPUB mới làm UI. Fake content được phép đến hết T3.0; từ T3.3 trở đi ưu tiên thay bằng EPUB thật cho sách `.epub`.

---



## 4. Nghiệm thu



### A — UI + fake (T3.0)

- [x] Tap sách bất kỳ trong Library / SCR-01a → vào Reader ngay (không màn trống / “coming soon”)
- [x] Layout khớp mockup: chrome + vùng đọc + sidebar tabs (có thể stub action)
- [x] Vùng đọc có chữ fake đủ để cuộn; hiện ít nhất title sách đã chọn
- [x] Back về Library



### B — EPUB thật (phần còn lại G3)

- [x] Mở EPUB đã import → đọc được nội dung thật (thay fake) — T3.3
- [x] Chrome ẩn mặc định (`ReaderShell` T3.2); tap giữa bật/tắt — **T3.6**
- [x] **T3.5** Paginated: Arrow / click trái–phải lật trang (gồm spine bìa; phím hoạt động cả khi focus footer hoặc iframe EPUB)
- [x] **T3.5** Aa → Scroll: EPUB cuộn được; dual vẫn paginated
- [x] **T3.5** Section next/prev (Ctrl/Cmd+Arrow hoặc `[` / `]`)
- [x] **T3.5** Footer scrub nhảy vị trí thô theo spine (không chỉ FAKE_CHAPTERS); click số trang → go-to-page
- [ ] Lật / cuộn không giật nặng trên máy dev trung bình
- [x] Không sửa file EPUB trên đĩa (đọc qua bytes IPC)
- [ ] Không có panel AI / linked libraries login trong UI

---



## 5. Nợ được chấp nhận (G3) + backlog từ note.txt

Nguồn map: [11_Backlog_tu_note_san_pham.md](./11_Backlog_tu_note_san_pham.md).


| ID          | Nợ                                                       | Trả ở                             |
| ----------- | -------------------------------------------------------- | --------------------------------- |
| —           | ~~Fake body EPUB~~; TOC / Note·Comment·Bookmark list     | **T3.3 đạt** (body); TOC **T3.7** / **G5** |
| —           | Format không EPUB vẫn fake đến G6                        | **G6**                            |
| —           | Progress persist                                         | **G4**                            |
| —           | Highlight / note / comment / bookmark thật               | **G5**                            |
| —           | Reading Settings đầy đủ + persist                        | **G4**                            |
| —           | ~~IPC path allowlist siết~~                              | **T3.4 đạt**                      |
| **NOTE-R4** | ~~**Next trang nhanh** trên EPUB thật~~ — T3.5 (phím + click cạnh); polish page mode còn **G4** | **T3.5** / **G4** |
| **NOTE-R6** | **Search trong sách** (find-in-book; titlebar hiện stub) | Cơ bản **G3/G4**; semantic **G7** |


