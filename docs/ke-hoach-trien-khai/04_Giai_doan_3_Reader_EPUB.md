# Giai đoạn 3 — Reader (EPUB trước)

**Mục tiêu:** Mở sách EPUB từ Library, đọc nội dung với Invisible UI.

**Mockup:** [`reading.html`](../mockups/reading.html)  
**SRS:** FR-02, FR-03 · **UC-02** · **WF-03** · **BR-01, BR-04**  
**SDS:** SCR-03

**Điều kiện vào:** G2 import được ≥ 1 EPUB thật.

---

## 1. Outcome

1. Tap sách / Resume → vào Reader, nội dung EPUB hiện.
2. Chrome (toolbar) **ẩn mặc định**; tap giữa → hiện / ẩn.
3. Lật trang hoặc cuộn mượt; không popup giữa phiên.
4. File `.epub` gốc / sandbox **không** bị ghi đè khi đọc.

## 2. Việc cần làm

| Task | Chi tiết | FR |
| :--- | :--- | :--- |
| T3.1 | Spike chọn EPUB engine (epub.js / tương đương trên Chromium) — ghi kết quả vào SDS nếu đổi | — |
| T3.2 | `ReaderShell` chung: vùng nội dung + chrome ẩn | FR-02, FR-03 |
| T3.3 | `EpubRenderer` pluggable theo `Book.format` | FR-02 |
| T3.4 | Mở sách qua IPC: Main trả stream/path allowlist; Renderer không đọc path tùy ý | FR-02 |
| T3.5 | Navigation: next/prev chapter hoặc page; scroll mode cơ bản | FR-03 |
| T3.6 | Tap center toggle Tools / Settings / More (theo mockup) | FR-03 |
| T3.7 | Sidebar TOC (mục lục) từ EPUB | FR-03 |
| T3.8 | Back → Library (giữ scroll Library nếu có) | WF-01 |
| T3.9 | Loading / lỗi mở sách rõ ràng | — |

## 3. Thứ tự khuyến nghị

```text
T3.1 → T3.4 → T3.3 → T3.2
  → T3.5 → T3.6 → T3.7 → T3.8 → T3.9
```

## 4. Nghiệm thu

- [ ] Mở EPUB đã import → đọc được nội dung thật
- [ ] Chrome ẩn mặc định; tap giữa bật/tắt
- [ ] Lật / cuộn không giật nặng trên máy dev trung bình
- [ ] Không sửa file EPUB trên đĩa
- [ ] Không có panel AI / linked libraries login trong UI

## 5. Nợ được chấp nhận

- Progress persist → **G4**
- Highlight → **G5**
- PDF / TXT / MD renderer → **G6**
- Reading Settings đầy đủ → **G4** (G3 có thể hardcode theme tạm)
