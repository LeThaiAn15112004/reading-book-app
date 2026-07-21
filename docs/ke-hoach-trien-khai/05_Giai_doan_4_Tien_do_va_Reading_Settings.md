# Giai đoạn 4 — Tiến độ & Reading Settings

**Mục tiêu:** Đóng app / thoát sách vẫn mở lại đúng vị trí; chỉnh theme & typography khi đọc.

**Mockup:** panel Settings trong [`reading.html`](../mockups/reading.html)  
**SRS:** FR-04, FR-05, FR-10 · **BR-02, BR-05** · **NFR-03**  
**SDS:** SCR-05 (khác SCR-06 App Settings)

**Điều kiện vào:** G3 đọc EPUB được.

---

## 1. Outcome

1. Đọc → đóng app → mở lại → đúng vị trí (CFI).
2. Continue Reading trên Library mở đúng sách + vị trí.
3. Đổi light / sepia / dark + font / size / line-height; chữ tự khớp contrast (**BR-05**).
4. Đổi theme **không** reload toàn bộ document (**NFR-03**).
5. Progress % / thanh mỏng hiện ở Reader và trên card Library.

## 2. Việc cần làm

| Task | Chi tiết | FR |
| :--- | :--- | :--- |
| T4.1 | `LocationCodec` cho EPUB (CFI) — lưu/khôi phục ổn định | FR-05 |
| T4.2 | Debounce + flush progress khi scroll/page, blur, trước khi thoát | FR-05 |
| T4.3 | Bảng / repo `progress` (location + % + last_read_at) | FR-05, FR-10 |
| T4.4 | Resume khi mở Reader; Continue Reading dùng `last_read` | FR-08, FR-05 |
| T4.5 | Panel SCR-05: theme, font family, size, line-height, margins/page mode (theo mockup) | FR-04 |
| T4.6 | Preference **per-book** (theo SDS) + fallback default app | FR-04 |
| T4.7 | CSS variables / overlay theme — không mutate file EPUB | BR-02 |
| T4.8 | Bảng màu nền ↔ chữ tự động (**BR-05**) | FR-04 |
| T4.9 | Progress bar mỏng trong Reader (không phá Invisible UI) | FR-10 |
| T4.10 | % trên card Library / Continue Reading | FR-10 |

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
- [ ] Continue Reading đúng sách gần nhất
- [ ] % tiến độ phản ánh gần đúng vị trí hiện tại

## 5. Nợ được chấp nhận

- Location cho PDF (page+rect) → G6
- App Settings (theme shell toàn app) → G6 / SCR-06
