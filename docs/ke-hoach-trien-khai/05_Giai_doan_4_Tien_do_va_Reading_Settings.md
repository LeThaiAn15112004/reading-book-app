# Giai đoạn 4 — Tiến độ (last-read) & Reading Settings

**Mục tiêu:** Đóng app / thoát sách vẫn mở lại đúng vị trí; chỉnh typography & layout khi đọc; persist per-book. UI cho biết **đang dừng ở đâu**, không báo "đã đọc bao nhiêu %".

**Mockup:** panel Settings + location scrubber trong `[reading.html](../mockups/reading.html)`; Library last-read trong `[library.html](../mockups/library.html)`  
**SRS:** FR-04, FR-05, FR-10 · **BR-02, BR-05** · **NFR-03**  
**SDS:** SCR-05 (khác SCR-06 App Settings)

**Điều kiện vào:** G3 đọc EPUB được.

---

## 1. Outcome

1. Đọc → đóng app → mở lại → đúng vị trí (CFI).
2. Continue Reading trên Library mở đúng sách + vị trí.
3. Đổi light / sepia / dark (CSS variable `data-theme`, **không** lưu DB) + font / size / weight / line-height / text-align / layout / page-turn mode / lề — persist per-book.
4. Đổi theme **không** reload toàn bộ document (**NFR-03**).
5. Library / Continue Reading hiện **last-read location** (chương/trang); Reader có scrubber nhảy vị trí kèm nhãn — **không** % hoàn thành / thanh fill "tiến độ đọc".



## 2. Việc cần làm


| Task  | Chi tiết                                                                                                                                                                                                                                                                                                                                                                                                          | FR           |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| T4.1  | `LocationCodec` cho EPUB (CFI) — lưu/khôi phục ổn định                                                                                                                                                                                                                                                                                                                                                            | FR-05        |
| T4.2  | Debounce + flush session khi scroll/page, blur, trước khi thoát — **done**: `useReadingSessionAutosave` (750ms / max-wait 5s) + flush blur/hidden/unmount/menubar; Electron `close` handshake `app:requestFlushSession`                                                                                                                                                                                           | FR-05        |
| T4.3  | Bảng / repo session (`last_read_location` + nhãn hiển thị + `last_read_at`; `percent` chỉ optional cho scrubber map) — **done**: `SqliteOverlayStore` + IPC `overlay:get/saveSessionState`; nhãn nhúng JSON cùng CFI; `updated_at` = `last_read_at`; **schema v2 (migration 008)**: bỏ `bg_color/text_color/theme_preset`, thêm `font_weight/text_align/layout_mode/page_turn_mode/margins_enabled/margin_preset` | FR-05, FR-10 |
| T4.4  | Resume khi mở Reader; Continue Reading dùng `last_read` — **done**: load `overlay:getSessionState`, chỉ resume EPUB với CFI hợp lệ và mount sau khi session resolve                                                                                                                                                                                                                                               | FR-08, FR-05 |
| T4.5  | Panel SCR-05: font family, size, weight, line-height, text-align, margins/page mode (theo mockup) — **done**: áp dụng EPUB bằng stylesheet overlay, hydrate/autosave session per-book                                                                                                                                                                                                                             | FR-04        |
| T4.6  | Preference **per-book** (theo SDS) + fallback default app — **done**: merge override sách → default app → hardcoded; partial save không cần CFI và giữ row `Started`                                                                                                                                                                                                                                              | FR-04        |
| T4.7  | CSS variables / overlay theme — không mutate file EPUB                                                                                                                                                                                                                                                                                                                                                            | BR-02        |
| T4.8  | Bảng màu nền ↔ chữ tự động theo `data-theme` preset (**BR-05**) — **done**: preset Night/Sepia/Paper cố định, swatch SCR-05/SCR-06 chung, EPUB hot-swap CSS variables, contrast body text ≥ 4.5:1                                                                                                                                                                                                                 | FR-04        |
| T4.9  | Location scrubber mỏng trong Reader + nhãn vị trí (không phá Invisible UI; không hiện % hoàn thành) — **done**: TOC/spine/cover label, map scrubber pointer + keyboard, jump/resume qua CFI và session map                                                                                                                                                                                                        | FR-10        |
| T4.10 | Last-read location trên card Library / Continue Reading (không % / cover-bar fill) — **done**: formatter dùng chung `Last at · {label}`; Continue Reading, shelf detail và shelf rail dùng nhãn session thật; Library không render `percent` / progress fill                                                                                                                                                      | FR-10        |




## 3. Thứ tự khuyến nghị

1. **T4.1** — `LocationCodec` EPUB (CFI)
2. **T4.3** — Repo / bảng session (`last_read_location`, nhãn, `last_read_at`) + migration 008
3. **T4.2** — Debounce + flush session (scroll/page, blur, thoát) — **done**
4. **T4.4** — Resume Reader + Continue Reading dùng `last_read` — **done**
5. **T4.7** — CSS variables / overlay theme (không mutate EPUB)
6. **T4.5** — Panel SCR-05 (font, size, weight, line-height, text-align, page mode, lề)
7. **T4.8** — Bảng màu nền ↔ chữ tự động (**BR-05**)
8. **T4.6** — Preference per-book + fallback default app
9. **T4.9** — Location scrubber + nhãn vị trí trong Reader
10. **T4.10** — Last-read location trên Library / Continue Reading



## 4. Nghiệm thu

- [x] Hai phiên đọc: vị trí khôi phục đúng (thử giữa chương)
- [x] Preference font/size/weight/line-height/layout/page-turn/lề giữ sau restart
- [x] Đổi theme không flash/reload cả sách
- [x] Continue Reading đúng sách gần nhất + hiện chỗ dừng (không %)
- [x] Jump / đọc nhảy cóc rồi thoát → mở lại đúng vị trí lần cuối (không phụ thuộc đọc tuần tự)



## 5. Nợ được chấp nhận (G4) + backlog từ note.txt

Nguồn map: [11_Backlog_tu_note_san_pham.md](./11_Backlog_tu_note_san_pham.md).


| ID           | Nợ (ý note.txt)                                                                        | Trả ở                                              |
| ------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------- |
| —            | Location PDF (page+rect)                                                               | **G6**                                             |
| —            | App Settings theme shell                                                               | **G6** SCR-06                                      |
| —            | Mark Completed thủ công                                                                | polish / **G6**                                    |
| **NOTE-R1**  | Đổi màu nền đọc — CSS variable `data-theme` (không persist DB); theme lưu localStorage | **G4**                                             |
| **NOTE-R2**  | Màu chữ tương phản — tự động theo preset theme CSS                                     | **G4**                                             |
| **NOTE-R3**  | Xoay / ngang + dual-page — persist `is_landscape` / `layout_mode` per-book (DB v2)     | **G4**                                             |
| **NOTE-R8**  | 1 trang / 2 trang — persist `layout_mode` per-book                                     | **G4**                                             |
| **NOTE-R9**  | Scroll vs lật trang — persist `page_turn_mode` per-book                                | **G4**                                             |
| **NOTE-R10** | Zoom đọc (MVP = font A±)                                                               | **G4**; pinch PDF → **G6**                         |
| **NOTE-R11** | Độ sáng + preset ngoài trời                                                            | Theme ngày/đêm **G4**; brightness/outdoor → **G6** |
| **G1-N3**    | Lưu yêu thích (wire UI)                                                                | **G4**                                             |
| **G1-N1**    | Continue Reading data thật                                                             | **G4**                                             |


