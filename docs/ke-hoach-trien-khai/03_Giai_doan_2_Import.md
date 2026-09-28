# Giai đoạn 2 — Import sách

**Mục tiêu:** Thêm tài liệu vào thư viện local từ máy hoặc URL; đọc offline sau khi import.

**Mockup:** [`import.html`](../mockups/import.html)  
**SRS:** FR-01, FR-13 · **UC-01** · **WF-02** · **BR-01, BR-03**  
**SDS:** UX-IMP (không phải SCR)

**Điều kiện vào:** G1 có Library + CTA Add.

> **Cập nhật kiến trúc (SDS 1.24 / SRS 1.7):** tài liệu này ghi lại kế hoạch G2 ban đầu (import file máy = *copy vào sandbox*). Hiện import file máy **tham chiếu file gốc** (không copy); chỉ **URL / cloud** tải về và lưu bản copy app-owned. Các dòng T2.3, T2.8 và nghiệm thu "File gốc không bị sửa" dưới đây đã được chú thích theo hành vi mới — mô tả đầy đủ: [`docs/implementation_plan/file_centric_import_architecture.md`](../implementation_plan/file_centric_import_architecture.md).

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
| T2.3 | Main: OS file picker + ~~copy vào sandbox~~ → *(từ SDS 1.24)* đăng ký tham chiếu file gốc, không copy | FR-01 |
| T2.4 | Main: download URL (https, timeout, size limit, scheme allowlist) | FR-13 |
| T2.5 | Validate extension: epub / pdf / txt / md / docx / doc — từ chối format khác rõ ràng | FR-01 |
| T2.6 | Metadata tối thiểu (title, author nếu có, format, filename, cover nếu extract được) | FR-01 |
| T2.7 | SHA-256 dedup (**BR-03**) + dialog conflict | FR-01, FR-13 |
| T2.8 | Ghi `books` + `file_path` (file gốc với import máy; path sandbox với URL / cloud); optional `source_url` | FR-13 |
| T2.9 | Adapter EPUB trước (metadata); stub PDF/TXT/MD/DOCX/DOC nếu chưa render | — |
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

- [x] Import EPUB từ máy → card hiện Library
- [x] File gốc không bị sửa (ban đầu: copy sandbox; từ SDS 1.24: không copy, chỉ tham chiếu — app không ghi / di chuyển / xóa file gốc)
- [x] Import trùng → thông báo, không 2 bản ghi
- [x] URL hợp lệ → file nằm sandbox local (đọc nội dung → **G3**); không re-download mỗi lần mở
- [x] URL lỗi / format sai → message rõ; không bản ghi rỗng
- [x] Không có UI bookstore / catalog

## 5. Nợ kỹ thuật được chấp nhận (G2)

G2 **đạt outcome** (import máy + URL — khớp note.txt dòng 1–2). Các mục dưới **không chặn** G3.

Nguồn ý sản phẩm: [`docs/note/note.txt`](../note/note.txt) — map đầy đủ tại [11_Backlog_tu_note_san_pham.md](./11_Backlog_tu_note_san_pham.md).

| ID | Nợ (gồm ý từ note.txt) | Hiện trạng (code) | Trả ở |
| :--- | :--- | :--- | :--- |
| **G2-N1** | Metadata / cover PDF · TXT · MD · DOCX · DOC | Ngoài EPUB = filename fallback | **G6** |
| **G2-N2** | Detect chữ ký số → `is_signed` / `signer_name` / `signature_status` (cột `books`, gộp từ `book_signatures` ở migration `018`) | Schema sẵn; chưa detect lúc import | **G6** |
| **G2-N3** | FTS / `book_chunks` | Bảng có; chưa fill | **G3/G6** |
| **G2-N4** | Gắn Collection lúc import | Không bắt buộc G2 | **G6** |
| **G2-N5** | **Form enrich import:** Title, mô tả ngắn, thể loại, tác giả, **ảnh bìa thủ công**, link file (note.txt) | Chỉ metadata file/filename; chưa form sau pick | **G6** polish |
| **G2-N6** | `library.deleteBook` cascade | IPC stub | **G6** FR-12 |
| **G2-N7** | **Bìa default + title** khi không có cover; UI bìa đẹp hơn (note.txt) | EPUB cover khi có; fallback mỏng | **G6** polish |

**Ngoài phạm vi G2 (ghi rõ theo note.txt):**

| Ý note.txt | Xử lý |
| :--- | :--- |
| Check bản quyền / DRM | **Ngoài sản phẩm** (SDS) |
| AI phân tích thêm field metadata lúc import | **G7** opt-in (**NOTE-AI2**); **không** auto khi import (NFR) |

**Đã đóng:** Import từ máy + URL.
