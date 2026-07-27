# Giai đoạn 4 — Tiến độ (last-read) & Reading Settings

**Mục tiêu:** Đóng app / thoát sách vẫn mở lại đúng vị trí; chỉnh theme & typography khi đọc. UI cho biết **đang dừng ở đâu**, không báo “đã đọc bao nhiêu %”.

**Mockup:** panel Settings + location scrubber trong [`reading.html`](../mockups/reading.html); Library last-read trong [`library.html`](../mockups/library.html)  
**SRS:** FR-04, FR-05, FR-10 · **BR-02, BR-05** · **NFR-03**  
**SDS:** SCR-05 (khác SCR-06 App Settings)

**Điều kiện vào:** G3 đọc EPUB được.

---

## 1. Outcome

1. Đọc → đóng app → mở lại → đúng vị trí (CFI).
2. Continue Reading trên Library mở đúng sách + vị trí.
3. Đổi light / sepia / dark + font / size / line-height; chữ tự khớp contrast (**BR-05**).
4. Đổi theme **không** reload toàn bộ document (**NFR-03**).
5. Library / Continue Reading hiện **last-read location** (chương/trang); Reader có scrubber nhảy vị trí kèm nhãn — **không** % hoàn thành / thanh fill “tiến độ đọc”.

## 2. Việc cần làm

| Task | Chi tiết | FR |
| :--- | :--- | :--- |
| T4.1 | `LocationCodec` cho EPUB (CFI) — lưu/khôi phục ổn định | FR-05 |
| T4.2 | Debounce + flush session khi scroll/page, blur, trước khi thoát | FR-05 |
| T4.3 | Bảng / repo session (`last_read_location` + nhãn hiển thị + `last_read_at`; `percent` chỉ optional cho scrubber map) | FR-05, FR-10 |
| T4.4 | Resume khi mở Reader; Continue Reading dùng `last_read` | FR-08, FR-05 |
| T4.5 | Panel SCR-05: theme, font family, size, line-height, margins/page mode (theo mockup) | FR-04 |
| T4.6 | Preference **per-book** (theo SDS) + fallback default app | FR-04 |
| T4.7 | CSS variables / overlay theme — không mutate file EPUB | BR-02 |
| T4.8 | Bảng màu nền ↔ chữ tự động (**BR-05**) | FR-04 |
| T4.9 | Location scrubber mỏng trong Reader + nhãn vị trí (không phá Invisible UI; không hiện % hoàn thành) | FR-10 |
| T4.10 | Last-read location trên card Library / Continue Reading (không % / cover-bar fill) | FR-10 |

## 3. Thứ tự khuyến nghị

```text
T4.1 → T4.3 → T4.2 → T4.4
  → T4.7 → T4.5 → T4.8 → T4.6
  → T4.9 → T4.10
```

## 4. Nghiệm thu

- [ ] Hai phiên đọc: vị trí khôi phục đúng (thử giữa chương)
- [ ] Preference theme/font giữ sau restart
- [ ] Đổi theme không flash/reload cả sách
- [ ] Continue Reading đúng sách gần nhất + hiện chỗ dừng (không %)
- [ ] Jump / đọc nhảy cóc rồi thoát → mở lại đúng vị trí lần cuối (không phụ thuộc đọc tuần tự)

## 5. Nợ được chấp nhận (G4) + backlog từ note.txt

Nguồn map: [11_Backlog_tu_note_san_pham.md](./11_Backlog_tu_note_san_pham.md).

| ID | Nợ (ý note.txt) | Trả ở |
| :--- | :--- | :--- |
| — | Location PDF (page+rect) | **G6** |
| — | App Settings theme shell | **G6** SCR-06 |
| — | Mark Completed thủ công | polish / **G6** |
| **NOTE-R1** | Đổi **màu nền** đọc (giảm mỏi mắt) — persist per-book | **G4** |
| **NOTE-R2** | **Màu chữ** tương phản theme | **G4** (preset); custom hex sau nếu cần |
| **NOTE-R3** | **Xoay / ngang** + dual-page | **G4** |
| **NOTE-R8** | 1 trang căn giữa / 2 trang + khung sống sách | **G4** |
| **NOTE-R9** | **Chọn kiểu đọc** scroll vs lật trang | **G4** |
| **NOTE-R10** | Zoom đọc (MVP = font A±) | **G4**; pinch PDF → **G6** |
| **NOTE-R11** | Độ sáng + preset **ngoài trời** | Theme ngày/đêm **G4**; brightness/outdoor → **G6** |
| **G1-N3** | Lưu yêu thích (wire UI) | **G4** |
| **G1-N1** | Continue Reading data thật | **G4** |
