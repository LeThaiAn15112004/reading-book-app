# Giai đoạn 2 — Import sách

**Mục tiêu:** Thêm tài liệu vào thư viện local từ máy hoặc URL; đọc offline sau khi import.

**Mockup:** [`import.html`](../mockups/import.html)  
**SRS:** FR-01, FR-13 · **UC-01** · **WF-02** · **BR-01, BR-03**  
**SDS:** UX-IMP (không phải SCR)

**Điều kiện vào:** G1 có Library + CTA Add.

---

## 1. Outcome

1. Từ Library → **Add file** → chọn EPUB (và các format đã bật) → sách hiện trong list.
2. **Import from URL** → dán link direct file → tải về sandbox → hiện Library.
3. File trùng SHA-256 → báo conflict, không nhân đôi.
4. Sau import: đóng overlay, toast, refresh tại chỗ — **không** đổi route sang màn Import.

## 2. Việc cần làm

| Task | Chi tiết | FR |
| :--- | :--- | :--- |
| T2.1 | UI: split button Add + menu “From device” / “From URL” | FR-01, FR-13 |
| T2.2 | Modal (desktop) / bottom sheet (mobile sau): nhập URL | FR-13 |
| T2.3 | Main: OS file picker + copy vào sandbox | FR-01 |
| T2.4 | Main: download URL (https, timeout, size limit, scheme allowlist) | FR-13 |
| T2.5 | Validate extension: epub / pdf / txt / md — từ chối format khác rõ ràng | FR-01 |
| T2.6 | Metadata tối thiểu (title, author nếu có, format, filename, cover nếu extract được) | FR-01 |
| T2.7 | SHA-256 dedup (**BR-03**) + dialog conflict | FR-01, FR-13 |
| T2.8 | Ghi `books` + path sandbox; optional `source_url` | FR-13 |
| T2.9 | Adapter EPUB trước (metadata); stub PDF/TXT/MD nếu chưa render | — |
| T2.10 | Progress UI khi copy/download; dọn temp khi lỗi | FR-13 |
| T2.11 | Library refresh + toast thành công | FR-08 |

## 3. Thứ tự khuyến nghị

```text
T2.3 → T2.5 → T2.6 → T2.7 → T2.8
  → T2.1 → T2.11
  → T2.4 → T2.2 → T2.10
  → T2.9
```

Ưu tiên **From device + EPUB** chạy end-to-end trước URL.

## 4. Nghiệm thu

- [ ] Import EPUB từ máy → card hiện Library
- [ ] File gốc không bị sửa (copy sandbox)
- [ ] Import trùng → thông báo, không 2 bản ghi
- [ ] URL hợp lệ → offline đọc được (sau G3); không re-download mỗi lần mở
- [ ] URL lỗi / format sai → message rõ; không bản ghi rỗng
- [ ] Không có UI bookstore / catalog

## 5. Nợ được chấp nhận

- Cover đẹp / extract đầy đủ cho PDF có thể làm G6
- FTS5 index đầy đủ text có thể làm sau khi có extract (G3/G6)
- Gắn sách vào Collection ngay lúc import — không bắt buộc G2 (làm từ Library / Collections hub theo FR-14)
