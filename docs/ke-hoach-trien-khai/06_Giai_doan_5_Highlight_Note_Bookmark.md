# Giai đoạn 5 — Highlight, Note & Bookmark

**Mục tiêu:** Đánh dấu tri thức trong lúc đọc; xem lại và nhảy về đúng đoạn — **trong Reader theo từng sách**.

**Mockup:** sidebar Note · Comment · Bookmark trong [`reading.html`](../mockups/reading.html)  
**SRS:** FR-06, FR-07, FR-09, FR-11 · **UC-03–06** · **WF-04** · **BR-01, BR-02**  
**SDS:** không còn SCR-04 toàn cục

**Điều kiện vào:** G4 có LocationCodec + persist ổn.

---

## 1. Outcome

1. Bôi chọn text → Highlight trong **≤ 2 thao tác**.
2. Thêm / sửa / xóa note gắn đoạn; note rỗng không tạo mới.
3. Bookmark vị trí để quay lại nhanh.
4. Mở lại sách → highlight vẽ lại đúng chỗ.
5. Sidebar list Note / Comment / Bookmark → Jump đúng location.
6. Từ Library “Notes (n)” → mở Reader + tab Note của sách đó.

## 2. Việc cần làm

| Task | Chi tiết | FR |
| :--- | :--- | :--- |
| T5.1 | Selection → context action Highlight | FR-06 |
| T5.2 | Lưu highlight + location + màu (nếu có) vào SQLite Overlay | FR-06 |
| T5.3 | `DomCssOverlay` vẽ lại khi mở / sau khi thêm | FR-06 |
| T5.4 | Note CRUD gắn selection / location | FR-07 |
| T5.5 | Bookmark add / list / jump / xóa | FR-11 |
| T5.6 | Comment theo trang: IPC + UI drawer/sidebar trên bảng `comments` (`page_number`, `position_data`) — **schema + domain `Comment` đã có** (migration `004`) | SDS SCR-03 |
| T5.7 | Sidebar tabs: Note · Comment · Bookmark — filter theo `bookId` | FR-09 |
| T5.8 | Jump từ list → scroll/navigate đúng CFI | FR-09 |
| T5.9 | Đếm notes trên Continue Reading → mở tab Note | FR-09 |
| T5.10 | Xóa highlight/note đồng bộ overlay + DB | FR-07 |

## 3. Thứ tự khuyến nghị

```text
T5.1 → T5.2 → T5.3
  → T5.4 → T5.10
  → T5.5 → T5.7 → T5.8
  → T5.9 → T5.6
```

## 4. Nghiệm thu

- [ ] ≥ 3 highlight + ≥ 1 note; restart app vẫn còn
- [ ] File EPUB không đổi trên đĩa
- [ ] Highlight từ selection ≤ 2 thao tác chính
- [ ] Jump từ sidebar đúng đoạn
- [ ] Không có màn Notes toàn cục trong nav

## 5. Nợ được chấp nhận (G5) + backlog từ note.txt

Nguồn map: [11_Backlog_tu_note_san_pham.md](./11_Backlog_tu_note_san_pham.md).

| ID | Nợ (ý note.txt) | Trả ở |
| :--- | :--- | :--- |
| — | Overlay Canvas PDF | **G6** |
| — | Export notes / quote cards | **G8+** |
| — | Chuẩn hóa location Comment EPUB | sau G3 nếu cần |
| **NOTE-R5** | **Đánh dấu trang** (bookmark) persist + jump | **G5** |
| **NOTE-R7** | **Note văn bản** persist + sidebar | **G5** |
| — | Highlight màu (SDS; hỗ trợ note/selection) | **G5** |
| — | Comment / đáp án theo đoạn | **G5** |
