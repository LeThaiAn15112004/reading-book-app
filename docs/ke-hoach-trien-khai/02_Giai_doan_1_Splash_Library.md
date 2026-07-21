# Giai đoạn 1 — Splash & Library

**Mục tiêu:** Cold start có brand; vào được hub thư viện (kể cả khi chưa có sách).

**Mockup:** [`splash.html`](../mockups/splash.html), [`library.html`](../mockups/library.html)  
**SRS:** FR-08, FR-14 · **SDS:** SCR-00, SCR-01, SCR-01a · **WF:** WF-01

**Điều kiện vào:** G0 xong (DB + IPC + router).

---

## 1. Outcome

1. Mở app → thấy Splash (Readmate / Reader) → tự vào Library.
2. Thư viện trống → chỉ CTA **Add file** (nút có thể chưa mở import thật — hoặc mở placeholder).
3. Sidebar: Library, Favorites, Completed, To read, Collections, Settings (Settings có thể navigate tới màn trống tạm).

## 2. Việc cần làm

| Task | Chi tiết | FR / SCR |
| :--- | :--- | :--- |
| T1.1 | SCR-00 Splash: brand, spinner, chuyển khi Main+DB ready | SCR-00 |
| T1.2 | Timeout / lỗi init → không kẹt spinner mãi | SCR-00 |
| T1.3 | SCR-01 layout: sidebar + top bar search + hint format chips | FR-08 |
| T1.4 | Empty state: CTA Add file | FR-08 |
| T1.5 | Shelves UI (Reading / Completed / Not started) — data rỗng OK | FR-08 |
| T1.6 | SCR-01a shelf detail (list dọc) + Back | SCR-01a |
| T1.7 | Continue Reading block — ẩn khi chưa có `last_read` | FR-08 |
| T1.8 | Search UI lọc title/author/filename (local, sau khi có data) | FR-08 |
| T1.9 | Nav Favorites / Completed / To read — list filter cơ bản | SCR-01 |
| T1.9a | Collections hub (SCR-01): list `COLLECTION`, CTA New collection (stub dialog OK), mở tập → list sách (`COLLECTION_BOOK`) | FR-14 |
| T1.10 | Link Settings → SCR-06 stub | SCR-06 |

## 3. Thứ tự khuyến nghị

```text
T1.1 → T1.2 → T1.3 → T1.4
  → T1.5 → T1.7 → T1.6
  → T1.8 → T1.9 → T1.9a → T1.10
```

## 4. Nghiệm thu

- [ ] Cold start luôn thấy Splash trước Library
- [ ] Ready → Library không cần tap
- [ ] Brand đọc rõ; không flash list chưa sẵn sàng dưới Splash
- [ ] Empty library: CTA Add rõ ràng
- [ ] `›` trên shelf mở SCR-01a; Back về Library
- [ ] Không có UI bookstore / mua sách

## 5. Nợ được chấp nhận

- Add file chưa import thật → làm ở **G2**
- Card sách / progress thật → sau G2–G4
- Drag reorder shelf (`=`) có thể làm cuối G1 hoặc G6 polish
