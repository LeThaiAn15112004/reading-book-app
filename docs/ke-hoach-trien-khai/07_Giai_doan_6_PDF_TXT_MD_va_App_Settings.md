# Giai đoạn 6 — PDF / TXT / MD / DOCX / DOC, App Settings & hoàn thiện MVP

**Mục tiêu:** Đủ 6 định dạng MVP; có App Settings; polish + xóa sách — **chốt Desktop Free Core**.

**Mockup:** [`setting.html`](../mockups/setting.html) + cập nhật library/reading  
**SRS:** FR-02 (rộng), FR-12, NFR liên quan · **SDS:** SCR-06, adapters đa format

**Điều kiện vào:** G5 annotation EPUB ổn.

---

## 1. Outcome

1. Import & đọc được **PDF, TXT, Markdown, DOCX, DOC** ngoài EPUB.
2. Progress / highlight hoạt động theo location từng họ (page+rect / text offset / block range).
3. SCR-06: Linked libraries (stub), Appearance, Language, Fullscreen, File scan (có thể stub một phần), Multi-document flag…
4. Xóa sách → cascade progress, highlight, note, **comment**, **book_signatures**, file sandbox (**FR-12** / BR-06).
5. (Tuỳ chọn / polish) Detect PDF chữ ký số → cập nhật `books.is_signed` + `book_signatures` (schema sẵn từ SDS 1.15).
6. Checklist MVP desktop ở [10_Checklist…](./10_Checklist_nghiem_thu.md) đạt.

## 2. Việc cần làm

### 2.1. Đa định dạng

| Task | Chi tiết | FR |
| :--- | :--- | :--- |
| T6.1 | `PdfRenderer` + navigation trang + zoom/pan cơ bản | FR-02 |
| T6.2 | `PdfCanvasOverlay` cho highlight/note (không chèn CSS vào PDF) | FR-06 |
| T6.3 | `PageRectCodec` persist progress PDF | FR-05 |
| T6.4 | TXT renderer (reflow) + `TextOffsetCodec` | FR-02, FR-05 |
| T6.5 | Markdown → HTML render + location block/range | FR-02 |
| T6.5a | DOCX extract/render HTML + location block/range | FR-02 |
| T6.5b | DOC legacy extract (via `DocumentNormalizer` / `normalized_path`) + render | FR-02 |
| T6.6 | Registry format → renderer / overlay / codec | SDS §2.6 |
| T6.7 | Import metadata đủ 6 format; reject format ngoài whitelist | FR-01 |

### 2.2. App Settings & thư viện

| Task | Chi tiết | SCR / FR |
| :--- | :--- | :--- |
| T6.8 | SCR-06 full-page theo mockup (**Linked libraries** stub — không Account/Sign-in); persist prefs bằng **electron-store** (không SQLite `app_settings`) | SCR-06 |
| T6.9 | Phân biệt rõ SCR-05 (per-book đọc, SQLite `reading_session_states`) vs SCR-06 (app-level, platform store) | SDS |
| T6.10 | Xóa sách + cascade (**FR-12**, BR-06) — gồm `annotations`, `book_signatures` | FR-12 |
| T6.10a | Detect chữ ký số (PDF) → `is_signed` + rows `book_signatures` | SDS §3 |
| T6.11 | Favorites / Completed / To read đủ dùng MVP | SCR-01 |
| T6.11a | Collections CRUD + gắn/gỡ sách đủ dùng MVP (FR-14) — thay session stub | SCR-01, FR-14 |
| T6.12 | Drag reorder shelf nếu chưa làm ở G1 | SCR-01 |
| T6.13 | File scan / watch folder: thiết kế sẵn UI; implement tối thiểu hoặc stub có ghi chú | SCR-06 |

### 2.3. Polish MVP

| Task | Chi tiết |
| :--- | :--- |
| T6.14 | Empty / error states toàn app |
| T6.15 | Perf: mở sách local nhanh (mục tiêu north star &lt; 3s nếu thư viện local) |
| T6.16 | Manual test toàn FR-01…13 P0 |
| T6.17 | Feature flag chỗ ads Free (stub, không hiện ad trong reader) |

## 3. Thứ tự khuyến nghị

```text
T6.6 → T6.4 → T6.5 → T6.5a → T6.5b   # text / Word formats
  → T6.1 → T6.3 → T6.2                # PDF khó hơn
  → T6.7 → T6.10
  → T6.8 → T6.9 → T6.11 → T6.12 → T6.13
  → T6.14 → T6.15 → T6.16 → T6.17
```

## 4. Nghiệm thu (cổng ra MVP)

- [ ] 6 format: import + mở + resume được
- [ ] EPUB: highlight/note/jump như G5
- [ ] PDF: ít nhất highlight hoặc bookmark + resume trang
- [ ] DOCX / DOC: mở được nội dung (extract/render); file gốc không đổi
- [ ] Xóa sách không để orphan DB/file
- [ ] SCR-06 mở từ Library Settings; Back về Library
- [ ] Không AI / connector thư viện ngoài thật trong build MVP
- [ ] Không UI Sign in email/password hay OAuth2 identity
- [ ] Pass checklist mục “MVP Desktop” trong file 10

## 5. Sau giai đoạn này

MVP Free Core **desktop** coi là xong → mới mở **G7 Premium AI**.

## 6. Nợ / polish bắt buộc gom từ note.txt (trả trong G6 nếu chưa xong sớm hơn)

Nguồn map: [11_Backlog_tu_note_san_pham.md](./11_Backlog_tu_note_san_pham.md).

| ID | Ý note.txt | Việc G6 |
| :--- | :--- | :--- |
| **G1-N7** | Thể loại, MB, tổng trang, mô tả ngắn trên card | Schema n–n genres + list UI đã kéo sớm; G6: backfill sách cũ, PDF page count, enrich form (**G2-N5**) |
| **G1-N8** / **G2-N7** | UI bìa đẹp; bìa default + title | Cover UX |
| **G2-N5** | Form import: title, mô tả, thể loại, tác giả, ảnh bìa, link | Enrich overlay sau pick file/URL |
| **NOTE-R11** | Độ sáng màn; chế độ **ngoài trời** | SCR-06 Appearance |
| **NOTE-R10** | Zoom trang (PDF) | PDF renderer |
| **G2-N1/N2/N6** | Adapter đa format, signature detect, delete cascade | Task G6 sẵn có |
