# Checklist nghiệm thu theo giai đoạn

Dùng file này để đánh dấu tiến độ. Chỉ sang giai đoạn sau khi mục hiện tại đủ (hoặc ghi rõ nợ được chấp nhận).

**Cập nhật tiến độ:** 2026-08-04 — G0–G2 đạt outcome; **G3: T3.0–T3.9 đạt**; **G4: T4.1–T4.10 đạt**; **schema migration 008** (reading session v2) + **009** (highlights v2, bỏ `notes`, thêm `tags`). **G5: T5.0 schema/domain + T5.2 persist highlight + T5.3 DomCssOverlay (EPUB repaint)**. Nợ G1/G2 + [11_Backlog](./11_Backlog_tu_note_san_pham.md) giữ nguyên.

---

## G0 — Nền tảng

- [x] Desktop `npm run dev` chạy ổn
- [x] SQLite + migration tạo được (`001`…`005_drop_app_settings`; không bảng `app_settings`)
- [x] IPC preload hẹp; renderer không đụng FS trực tiếp
- [x] `packages/domain` / `shared` skeleton: domain models SDS §3 (gồm Collection, BookSignature, Comment) + ports SDS §2.6 (gồm CollectionStore)
- [x] Feature flag AI / External libraries = off
- [x] Không UI đăng nhập email/password / OAuth2

## G1 — Splash & Library

- [x] Splash → Library tự động khi ready
- [x] Empty state + CTA Add
- [x] T1.5 Shelves UI: Reading → Completed → Not started (header `=` · title · N files · `›`; empty section OK; 0 sách → ẩn shelves)
- [x] SCR-01a shelf detail + Back (T1.6)
- [x] Collections nav + hub (list tập; stub tạo được chấp nhận ở G1)
- [x] Không UI bookstore
- [x] Nợ G1 ghi rõ → xem §5 [`02_Giai_doan_1_Splash_Library.md`](./02_Giai_doan_1_Splash_Library.md) + bảng dưới

## G2 — Import

- [x] Import EPUB từ máy → hiện Library
- [x] Dedup SHA-256
- [x] Import URL direct file → sandbox local
- [x] Overlay đóng + toast; không màn Import riêng
- [x] Format không hỗ trợ bị từ chối rõ
- [x] Nợ G2 ghi rõ → xem §5 [`03_Giai_doan_2_Import.md`](./03_Giai_doan_2_Import.md) + bảng dưới

## G3 — Reader EPUB

- [x] **T3.0** UI SCR-03 theo mockup + nội dung fake; tap sách nào cũng vào đọc ngay
- [x] **T3.1** Spike chọn EPUB engine — chốt `epubjs` ^0.3.93 (SDS §2.10.1; harness `#/spike/epub`)
- [x] **T3.4** Mở sách qua IPC: `library:openBookContent` → bytes + sandbox allowlist (không path FS cho Renderer)
- [x] **T3.3** `EpubRenderer` — mở EPUB thật thay fake khi `format === epub`
- [x] **T3.2** `ReaderShell` chung: vùng nội dung + chrome ẩn mặc định (reveal chevron)
- [x] Invisible UI (chrome ẩn mặc định) — **T3.6** tap center toggle Tools / Settings / More
- [x] **T3.6** Tap giữa (fake + EPUB center zone) bật/tắt top+footer; đóng panel phụ theo mockup; Escape dismiss
- [x] **T3.5** Nav EPUB: page (Arrow + click cạnh), section (Ctrl/Cmd+Arrow / `[` `]`), scroll mode
- [x] **T3.5** Footer scrub theo spine index (EPUB); fake chapter keys khi non-EPUB
- [x] **T3.7** Mở EPUB: TOC đầy đủ từ `nav.toc` (sidebar Contents)
- [x] **T3.8** Menubar **Library** từ Reader → SCR-01; giữ scroll hub khi quay lại
- [x] **T3.9** Loading / lỗi mở sách (IPC + EPUB) — không kẹt màn trắng
- [x] Điều hướng cơ bản (page / section / scrub) — T3.5
- [x] File gốc không bị ghi đè

## G4 — Tiến độ & Reading Settings

- [ ] Resume đúng CFI sau restart
- [ ] Continue Reading đúng sách
- [x] Theme light/sepia/dark + typography
- [x] Đổi theme không reload cả document
- [x] Scrubber vị trí trong Reader (nhãn TOC/spine/cover, jump + CFI resume, không % hoàn thành)
- [x] Last-read location trên Library / Continue Reading (T4.10)

## G5 — Highlight / Note / Bookmark

- [x] Migration `009` + domain `Highlight` / `Tag` (bỏ bảng `notes`; **không** `app_settings`)
- [ ] Highlight ≤ 2 thao tác; persist SQLite
- [x] Ghi chú inline trên highlight (`highlights.note`); không note rỗng
- [x] Xóa highlight đồng bộ overlay + DB (T5.10)
- [x] Bookmark + jump
- [ ] Typewriter Note theo trang (`annotations` schema đã có)
- [x] Sidebar theo `bookId` (không SCR-04 toàn cục)
- [x] Vẽ lại overlay khi mở sách (`DomCssOverlay` / T5.3 — EPUB)

## G6 — Đa format + App Settings + polish MVP

- [ ] PDF: mở + resume trang (+ overlay tối thiểu)
- [ ] TXT + Markdown: mở + resume
- [ ] DOCX + DOC: import + mở + resume (extract/render)
- [ ] Xóa sách cascade (FR-12) — gồm signatures + annotations
- [ ] Collections CRUD + gắn/gỡ sách (FR-14) đủ dùng MVP (hiện stub in-memory)
- [ ] Digital signature: điền `is_signed` / `book_signatures` khi detect (schema sẵn)
- [ ] SCR-06 App Settings dùng được phần cốt lõi
- [ ] Manual test FR-01…14 P0
- [ ] Không AI / linked libraries thật trong build
- [ ] Không Sign in / Log out identity trên SCR-06

### Cổng MVP Desktop

- [ ] Tất cả G0–G6 ở trên đạt (trừ nợ đã ghi)
- [ ] North star: mở app → đọc lại &lt; ~3s (local)
- [ ] Không popup giữa phiên đọc

---

## G7 — Premium AI

- [ ] Explain/Summarize theo selection
- [ ] Chat một sách + citation
- [ ] Semantic search
- [ ] Flashcards + spaced repetition
- [ ] Không auto-AI khi import
- [ ] Ads/upsell ngoài vùng đọc

## G8 — Linked libraries & Mobile

- [ ] Không tài khoản app (email/password / OAuth2)
- [ ] Link ≥ 1 nguồn (Drive / Google Books / Apple Books) → pull list → import local
- [ ] Unlink không xóa data đã import
- [ ] Mobile: import → đọc → highlight → resume (tối thiểu 1 format)
- [ ] Auto-tag chỉ khi opt-in
- [ ] Special: không ads mọi màn

---

## Ghi chú nợ kỹ thuật

**Map đầy đủ từ [`docs/note/note.txt`](../note/note.txt):** [11_Backlog_tu_note_san_pham.md](./11_Backlog_tu_note_san_pham.md)

Chi tiết theo giai đoạn: [G1 §5](./02_Giai_doan_1_Splash_Library.md) · [G2 §5](./03_Giai_doan_2_Import.md) · [G3 §5](./04_Giai_doan_3_Reader_EPUB.md) · [G4 §5](./05_Giai_doan_4_Tien_do_va_Reading_Settings.md) · [G5 §5](./06_Giai_doan_5_Highlight_Note_Bookmark.md) · [G6 §6](./07_Giai_doan_6_PDF_TXT_MD_va_App_Settings.md) · [G7 §7](./08_Giai_doan_7_Premium_AI.md) · [G8 §5](./09_Giai_doan_8_Special_Sync_Mobile.md).

| Ngày | ID / Giai đoạn | Nợ | Dự kiến trả |
| :--- | :--- | :--- | :--- |
| 2026-07-27 | **G1-N1** | Continue Reading / last-read chưa từ `reading_session_states` (`listBooks`) | G4 |
| 2026-07-27 | **G1-N2** | Shelf Reading / Completed / Not started thiếu status thật | G4 |
| 2026-07-27 | **G1-N3** | Favorites (note.txt): có cột DB, chưa IPC/UI toggle + filter | G4 |
| 2026-07-27 | **G1-N4** | Collections hub session stub — chưa SQLite | G6 FR-14 |
| 2026-07-27 | **G1-N5** | Drag reorder shelf (`=`) chrome-only | G6 polish |
| 2026-07-27 | **G1-N6** | SCR-06 stub (chưa electron-store) | G6 |
| 2026-07-27 | **G1-N7** | Card: thể loại / MB / trang / mô tả ngắn (note.txt) | Schema+UI list kéo sớm; backfill EPUB khi boot; còn PDF pages → G6 |
| 2026-07-27 | **G1-N8** | UI bìa + bìa default + title (note.txt) | G6 polish |
| 2026-07-27 | **G2-N1** | Adapter metadata/cover ngoài EPUB = stub | G6 |
| 2026-07-27 | **G2-N2** | Detect chữ ký → `is_signed` / `book_signatures` | G6 |
| 2026-07-27 | **G2-N3** | FTS / `book_chunks` chưa fill khi import | G3/G6 |
| 2026-07-27 | **G2-N4** | Gắn collection lúc import | G6 |
| 2026-07-27 | **G2-N5** | Form enrich import (title/mô tả/thể loại/bìa tay) — note.txt | G6 polish |
| 2026-07-27 | **G2-N6** | `deleteBook` cascade stub | G6 FR-12 |
| 2026-07-27 | **G2-N7** | Cover UX đa format / fallback default+title — note.txt | G6 polish |
| 2026-07-27 | **NOTE-R1** | Đổi màu nền đọc (giảm mỏi mắt) — persist | G4 |
| 2026-07-27 | **NOTE-R2** | Màu chữ tương phản theme | G4 |
| 2026-07-27 | **NOTE-R3** | Xoay / landscape + dual-page | G4 |
| 2026-07-27 | **NOTE-R4** | Next trang nhanh (EPUB thật) | G3 / G4 |
| 2026-07-27 | **NOTE-R5** | Đánh dấu trang (bookmark) persist | G5 |
| 2026-07-27 | **NOTE-R6** | Search trong sách (find-in-book; Tools + titlebar stub) | G3/G4 · [12](./12_Reader_Tools_Search_Speech_Translate_Typewriter.md) · semantic G7 |
| 2026-08-05 | **TOOL-TR1** / **TOOL-TW1** | Translate + Typewriter (Tools UI shell; chi tiết sau) | [12](./12_Reader_Tools_Search_Speech_Translate_Typewriter.md) |
| 2026-07-27 | **NOTE-R7** | Note văn bản persist | G5 |
| 2026-07-27 | **NOTE-R8** | 1 trang căn giữa / 2 trang + khung | G4 |
| 2026-07-27 | **NOTE-R9** | Chọn kiểu đọc scroll vs lật trang | G4 |
| 2026-07-27 | **NOTE-R10** | Zoom (MVP font A±; PDF pinch) | G4 · G6 |
| 2026-07-27 | **NOTE-R11** | Độ sáng + chế độ ngoài trời | G4 theme · G6 brightness |
| 2026-07-27 | **NOTE-AI1** | AI tóm tắt sách dài | G7 opt-in |
| 2026-07-27 | **NOTE-AI2** | AI gợi ý metadata (không auto import) | G7 opt-in |
| 2026-07-27 | **NOTE-TTS1** | Đọc audio (TTS) — Tools Speech stub; chưa cam kết MVP | Sau G7 · [12](./12_Reader_Tools_Search_Speech_Translate_Typewriter.md) |
| 2026-07-27 | **NOTE-L1** | Linked libs only, không account user | G8 |
| 2026-07-27 | — | Check bản quyền / DRM (note.txt) | **Ngoài phạm vi** |
| 2026-07-22 | G1 / T1.5 | (cũ) Drag reorder — gộp **G1-N5** | G6 |
| 2026-07-25 | G0 / shared | Use cases `packages/shared/services` skeleton; import ở Electron IPC | Refactor sau |
| 2026-07-25 | Schema | `annotations` / signatures migrate; UI Reader + detect lúc import còn lại | G5 · G6 |
| 2026-07-25 | G0 / G6 | Bỏ `app_settings`; prefs platform store chưa wire | G6 T6.8 |
