# Giai đoạn 1 — Splash & Library

**Mục tiêu:** Cold start có brand; vào được hub thư viện (kể cả khi chưa có sách).

**Mockup:** `[splash.html](../mockups/splash.html)`, `[library.html](../mockups/library.html)`  
**SRS:** FR-08, FR-14 · **SDS:** SCR-00, SCR-01, SCR-01a · **WF:** WF-01

**Điều kiện vào:** G0 xong (DB + IPC + router).

---

## 1. Outcome

1. Mở app → thấy Splash (Readmate / Reader) → tự vào Library.
2. Thư viện trống → chỉ CTA **Add file** (nút có thể chưa mở import thật — hoặc mở placeholder).
3. Sidebar: Library, Favorites, Completed, To read, Collections, Settings (Settings có thể navigate tới màn trống tạm).



## 2. Việc cần làm


| Task  | Chi tiết                                                                                                                 | FR / SCR |
| ----- | ------------------------------------------------------------------------------------------------------------------------ | -------- |
| T1.1  | SCR-00 Splash: brand, spinner, chuyển khi Main+DB ready                                                                  | SCR-00   |
| T1.2  | Timeout / lỗi init → không kẹt spinner mãi                                                                               | SCR-00   |
| T1.3  | SCR-01 layout: sidebar + top bar search + hint format chips                                                              | FR-08    |
| T1.4  | Empty state: CTA Add file                                                                                                | FR-08    |
| T1.5  | Shelves UI (Reading / Completed / Not started) — data rỗng OK                                                            | FR-08    |
| T1.6  | SCR-01a shelf detail (list dọc) + Back                                                                                   | SCR-01a  |
| T1.7  | Continue Reading block — ẩn khi chưa có `last_read`                                                                      | FR-08    |
| T1.8  | Search UI lọc title/author/filename (local, sau khi có data)                                                             | FR-08    |
| T1.9  | Nav Favorites / Completed / To read — list filter cơ bản                                                                 | SCR-01   |
| T1.9a | Collections hub (SCR-01): list `COLLECTION`, CTA New collection (stub dialog OK), mở tập → list sách (`COLLECTION_BOOK`) | FR-14    |
| T1.10 | Link Settings → SCR-06 stub                                                                                              | SCR-06   |




## 3. Thứ tự khuyến nghị

```text
T1.1 → T1.2 → T1.3 → T1.4
  → T1.5 → T1.7 → T1.6
  → T1.8 → T1.9 → T1.9a → T1.10
```



## 4. Nghiệm thu

- [x] Cold start luôn thấy Splash trước Library
- [x] Ready → Library không cần tap
- [x] Brand đọc rõ; không flash list chưa sẵn sàng dưới Splash
- [x] Empty library: CTA Add rõ ràng
- [x] T1.5 Shelves: Reading → Completed → Not started; header `=` · title · N files · `›`; section trống OK; 0 sách ẩn shelves
- [x] `›` trên shelf mở SCR-01a; Back về Library (T1.6)
- [x] Không có UI bookstore / mua sách



## 5. Nợ kỹ thuật được chấp nhận (G1)

G1 **đạt outcome** (Splash → Library, shelves/empty/search/filters UI). Các mục dưới **không chặn** sang G2/G3; trả đúng giai đoạn ghi.

Nguồn ý sản phẩm: [`docs/note/note.txt`](../note/note.txt) — map đầy đủ tại [11_Backlog_tu_note_san_pham.md](./11_Backlog_tu_note_san_pham.md).

| ID | Nợ (gồm ý từ note.txt) | Hiện trạng (code) | Trả ở |
| :--- | :--- | :--- | :--- |
| **G1-N1** | Continue Reading / last-read thật | UI ẩn khi không có `last_read`; `listBooks` chưa trả session | **G4** |
| **G1-N2** | Shelf Reading / Completed / Not started theo status thật | Đếm/filter DTO stub | **G4** |
| **G1-N3** | **Lưu yêu thích** (note.txt) — star + filter Favorites | Cột `is_favorite` có; chưa IPC/UI toggle | **G4** |
| **G1-N4** | Collections persist | Session stub `useCollections` | **G6** FR-14 |
| **G1-N5** | Drag reorder shelf (`=`) | Chrome-only | **G6** polish |
| **G1-N6** | SCR-06 App Settings | Route stub | **G6** |
| **G1-N7** | Card: **thể loại, dung lượng MB, tổng trang, mô tả ngắn** (note.txt) | Schema: `description`/`page_count` + `genres`/`book_genres`; list + ⋮ Book info **đã có**. Còn: backfill metadata sách cũ; PDF page count thật | **G6** polish (backfill / đa format) |
| **G1-N8** | **UI bìa** + bìa default hiện title khi thiếu cover (note.txt) | EPUB cover khi extract; fallback/UX mỏng | **G6** polish |

**Đã đóng:** ~~Import file/URL~~ → G2; library hooks shared đã có.

**Nguyên tắc:** Không chặn G3 vì card/metadata polish.

