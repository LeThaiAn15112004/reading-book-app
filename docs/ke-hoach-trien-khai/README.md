# Kế hoạch triển khai — Làm app từng phần

Bộ tài liệu này hướng dẫn **làm code theo thứ tự**, từng giai đoạn một, dựa trên SRS / SDS / mockup đã có.

Khác với [`docs/plan/`](../plan/) (tầm nhìn sản phẩm, map research → yêu cầu), thư mục này trả lời câu hỏi:

> Hôm nay / tuần này nên code cái gì trước, cái gì sau, và khi nào coi là xong?

---

## Giả định đã chốt (không đổi khi làm)

| Quyết định | Giá trị |
| :--- | :--- |
| Nền tảng trước | **Desktop Electron** (`source/apps/reading-book-desktop`) |
| Mobile | Sau khi MVP desktop ổn |
| Định dạng MVP | **EPUB → PDF → TXT → Markdown → DOCX → DOC** (làm lần lượt) |
| Import | Overlay (modal / sheet), **không** màn hình riêng |
| Highlight / Note | Trong **Reader theo từng sách** — không màn Notes toàn cục |
| AI / Linked libraries | Sau MVP — **không** tài khoản app / OAuth2 đăng nhập |

---

## Tài liệu nguồn

| Nguồn | Dùng để |
| :--- | :--- |
| [SRS.md](../software/SRS.md) | FR, UC, WF, acceptance |
| [SDS.md](../software/SDS.md) | Kiến trúc, ERD, màn hình, folder `source/` |
| [docs/mockups/](../mockups/) | UI tham chiếu từng màn |
| [docs/diagram/](../diagram/) | Use case, workflow, kiến trúc |
| [docs/plan/](../plan/) | Roadmap Free / Premium / Special |

---

## Thứ tự đọc & làm

| # | File | Việc chính |
| ---: | :--- | :--- |
| 0 | [00_Tong_quan_va_thu_tu.md](./00_Tong_quan_va_thu_tu.md) | Bản đồ giai đoạn, phụ thuộc, nguyên tắc |
| 1 | [01_Giai_doan_0_Nen_tang.md](./01_Giai_doan_0_Nen_tang.md) | Types, SQLite, IPC, skeleton UI |
| 2 | [02_Giai_doan_1_Splash_Library.md](./02_Giai_doan_1_Splash_Library.md) | SCR-00, SCR-01, SCR-01a |
| 3 | [03_Giai_doan_2_Import.md](./03_Giai_doan_2_Import.md) | UX-IMP: file máy + URL |
| 4 | [04_Giai_doan_3_Reader_EPUB.md](./04_Giai_doan_3_Reader_EPUB.md) | SCR-03 UI mockup + fake → renderer EPUB |
| 5 | [05_Giai_doan_4_Tien_do_va_Reading_Settings.md](./05_Giai_doan_4_Tien_do_va_Reading_Settings.md) | Last-read location, SCR-05, resume |
| 6 | [06_Giai_doan_5_Highlight_Note_Bookmark.md](./06_Giai_doan_5_Highlight_Note_Bookmark.md) | Overlay tri thức trong Reader |
| 7 | [07_Giai_doan_6_PDF_TXT_MD_va_App_Settings.md](./07_Giai_doan_6_PDF_TXT_MD_va_App_Settings.md) | Đa định dạng (PDF/TXT/MD/DOCX/DOC) + SCR-06 + polish MVP |
| 8 | [08_Giai_doan_7_Premium_AI.md](./08_Giai_doan_7_Premium_AI.md) | Phase 2 — AI không xâm lấn |
| 9 | [09_Giai_doan_8_Special_Sync_Mobile.md](./09_Giai_doan_8_Special_Sync_Mobile.md) | Phase 3 — linked libraries + mobile |
| — | [10_Checklist_nghiem_thu.md](./10_Checklist_nghiem_thu.md) | Checklist DoD từng giai đoạn |

**Quy tắc:** Chỉ sang giai đoạn tiếp theo khi checklist của giai đoạn hiện tại đã tick đủ (hoặc ghi rõ nợ kỹ thuật được chấp nhận).

---

## Tiến độ hiện tại (2026-07-25)

| Giai đoạn | Trạng thái | Ghi chú ngắn |
| :--- | :--- | :--- |
| **G0** Nền tảng | **Xong** | Electron, SQLite migrations `001`–`004`, IPC, domain/ports, feature flags off |
| **G1** Splash + Library | **Xong** (nợ data) | UI hub/shelves/filters/collections stub; Continue Reading / status shelf chờ G4 |
| **G2** Import | **Xong** | File + URL, sandbox, SHA-256 dedup, toast overlay; EPUB metadata thật, format khác stub |
| **G3** Reader EPUB | **T3.0 xong** | UI theo `reading.html` + fake; tap sách → đọc ngay. Tiếp: EPUB thật (T3.1+) |
| G4…G8 | Chưa | Theo thứ tự checklist |

**Schema gần đây (SDS 1.15–1.17):** `books.is_signed`, `book_signatures`, `comments`; **đã bỏ `app_settings`** — app prefs theo platform (`electron-store` / MMKV). UI Comment / signature detect còn ở G5/G6.

**Chi tiết tick:** [10_Checklist_nghiem_thu.md](./10_Checklist_nghiem_thu.md)

---

## Luồng màn hình MVP (nhắc nhanh)

```text
SCR-00 Splash
    → SCR-01 Library
         ├─ Add → UX-IMP (modal, không đổi route)
         ├─ Resume / tap sách → SCR-03 Reader
         │       ├─ SCR-05 Reading Settings (panel)
         │       └─ Sidebar Note · Comment · Bookmark
         ├─ › shelf → SCR-01a → SCR-03
         └─ Settings → SCR-06 App Settings
```
