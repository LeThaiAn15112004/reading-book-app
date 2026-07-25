# Giai đoạn 3 — Reader (EPUB trước)

**Mục tiêu:** Mở sách từ Library vào Reader đúng mockup; đọc được ngay (fake OK trước) → rồi mới gắn EPUB thật + Invisible UI đầy đủ.

**Mockup:** [`reading.html`](../mockups/reading.html)  
**SRS:** FR-02, FR-03 · **UC-02** · **WF-03** · **BR-01, BR-04**  
**SDS:** SCR-03 (§4.6) · SCR-05 panel tạm (hardcode OK)

**Điều kiện vào:** G2 import được ≥ 1 sách. ✅ (G2 đã đạt — 2026-07-25)

**Trạng thái:** **T3.0 đạt** — UI SCR-03 + fake content; tap sách → đọc ngay. Tiếp: T3.1+ EPUB thật.

---

## 1. Outcome

### Milestone A — UI Reader (ưu tiên trước)

1. Tap **bất kỳ sách nào** trên Library / shelf detail → vào SCR-03 **ngay**, không placeholder trống.
2. Layout bám [`reading.html`](../mockups/reading.html): vùng đọc, top/footer chrome, Tools / Settings / More, sidebar (Chapters · Bookmark · Note · Comment).
3. Vùng đọc hiện **nội dung fake** (lorem / mẫu cố định) — title/author lấy từ sách đã chọn nếu có; **không** bắt buộc parse EPUB ở bước này.
4. Back → Library.

### Milestone B — EPUB thật (sau khi A ổn)

5. Nội dung EPUB sandbox hiện thay fake; chrome **ẩn mặc định**; tap giữa → hiện / ẩn.
6. Lật trang hoặc cuộn mượt; không popup giữa phiên.
7. File `.epub` gốc / sandbox **không** bị ghi đè khi đọc.

---

## 2. Việc cần làm

| Task | Chi tiết | FR / SCR |
| :--- | :--- | :--- |
| **T3.0** | **Thiết kế chi tiết màn SCR-03 theo mockup** — port UI từ `reading.html` vào `ReaderScreen` (shell, typography, theme tạm, chrome, sidebar tabs). Nội dung vùng đọc = **fake** (đủ dài để cuộn / lật giả). Wire: tap card sách / Resume → `openReader(bookId)` → màn đọc **ngay lập tức** (mọi format trong list đều vào được; fake không phụ thuộc file) | SCR-03 |
| T3.1 | Spike chọn EPUB engine (epub.js / tương đương trên Chromium) — ghi kết quả vào SDS nếu đổi | — |
| T3.2 | Chốt `ReaderShell` chung: vùng nội dung + chrome ẩn (từ UI T3.0) | FR-02, FR-03 |
| T3.3 | `EpubRenderer` pluggable theo `Book.format` — thay fake khi `format === epub` | FR-02 |
| T3.4 | Mở sách qua IPC: Main trả stream/path allowlist; Renderer không đọc path tùy ý | FR-02 |
| T3.5 | Navigation: next/prev chapter hoặc page; scroll mode cơ bản | FR-03 |
| T3.6 | Tap center toggle Tools / Settings / More (theo mockup) — hoàn thiện hành vi Invisible UI | FR-03 |
| T3.7 | Sidebar TOC (mục lục) từ EPUB (thay TOC fake) | FR-03 |
| T3.8 | Back → Library (giữ scroll Library nếu có) | WF-01 |
| T3.9 | Loading / lỗi mở sách rõ ràng (EPUB hỏng → message; không kẹt trắng) | — |

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

- [ ] Mở EPUB đã import → đọc được nội dung thật (thay fake)
- [ ] Chrome ẩn mặc định; tap giữa bật/tắt
- [ ] Lật / cuộn không giật nặng trên máy dev trung bình
- [ ] Không sửa file EPUB trên đĩa
- [ ] Không có panel AI / linked libraries login trong UI

---

## 5. Nợ được chấp nhận

- Fake body / TOC / Note·Comment·Bookmark list ở T3.0 → thay dần khi T3.3+ / G5
- Format không phải EPUB vẫn mở Reader với fake đến **G6** (renderer thật)
- Progress persist → **G4**
- Highlight / note / comment thật → **G5**
- Reading Settings đầy đủ → **G4** (G3 hardcode theme theo mockup tạm)
- IPC path allowlist có thể stub nhẹ ở T3.0 (chỉ navigate + fake); siết ở T3.4
