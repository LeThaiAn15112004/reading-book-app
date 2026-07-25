# Checklist nghiệm thu theo giai đoạn

Dùng file này để đánh dấu tiến độ. Chỉ sang giai đoạn sau khi mục hiện tại đủ (hoặc ghi rõ nợ được chấp nhận).

**Cập nhật tiến độ:** 2026-07-25 — G0–G2 đạt outcome chính; schema SDS 1.16 (`is_signed`, `book_signatures`, `comments`); tiếp theo **G3 Reader EPUB**.

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

## G2 — Import

- [x] Import EPUB từ máy → hiện Library
- [x] Dedup SHA-256
- [x] Import URL direct file → sandbox local
- [x] Overlay đóng + toast; không màn Import riêng
- [x] Format không hỗ trợ bị từ chối rõ

## G3 — Reader EPUB

- [x] **T3.0** UI SCR-03 theo mockup + nội dung fake; tap sách nào cũng vào đọc ngay
- [ ] Mở EPUB đọc được (thay fake)
- [ ] Invisible UI (chrome ẩn mặc định)
- [ ] TOC / điều hướng cơ bản
- [ ] File gốc không bị ghi đè

## G4 — Tiến độ & Reading Settings

- [ ] Resume đúng CFI sau restart
- [ ] Continue Reading đúng sách
- [ ] Theme light/sepia/dark + typography
- [ ] Đổi theme không reload cả document
- [ ] Last-read location trên Library + scrubber vị trí trong Reader (không % hoàn thành)

## G5 — Highlight / Note / Bookmark

- [ ] Highlight ≤ 2 thao tác; persist
- [ ] Note CRUD; không note rỗng
- [ ] Bookmark + jump
- [ ] Comment theo trang (`comments` schema đã có — UI/IPC Reader còn lại)
- [ ] Sidebar theo `bookId` (không SCR-04 toàn cục)
- [ ] Vẽ lại overlay khi mở sách

## G6 — Đa format + App Settings + polish MVP

- [ ] PDF: mở + resume trang (+ overlay tối thiểu)
- [ ] TXT + Markdown: mở + resume
- [ ] DOCX + DOC: import + mở + resume (extract/render)
- [ ] Xóa sách cascade (FR-12) — gồm signatures + comments
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

| Ngày | Giai đoạn | Nợ | Ai chấp nhận | Dự kiến trả |
| :--- | :--- | :--- | :--- | :--- |
| 2026-07-22 | G1 / T1.5 | Drag reorder shelf bằng `=` (handle chrome-only) | Phase doc §5 | Cuối G1 hoặc G6 polish |
| 2026-07-25 | G1 / T1.7–T1.9 | Continue Reading / shelf Reading·Completed / Favorites thiếu data thật (`listBooks` chưa trả last-read / status / favorite) | Nghiệm thu G1–G2 | G4 (+ UI star) |
| 2026-07-25 | G1 / T1.9a | Collections hub chỉ session stub — chưa SQLite `collections` | FR-14 stub G1 | G6 |
| 2026-07-25 | G0 / shared | Use cases `packages/shared/services` còn skeleton; import thật đang ở Electron IPC | SDS layered | Khi refactor ImportBookService |
| 2026-07-25 | Schema | `is_signed` / `book_signatures` / `comments` đã migrate + domain; chưa wire import detect chữ ký / UI Comment Reader | SDS 1.15–1.16 | G5 (Comment) · G6 (signature detect) |
| 2026-07-25 | G0 / G6 | Bỏ `app_settings` khỏi SQLite; SCR-06 dùng electron-store (desktop) / MMKV (mobile) — chưa wire store | SDS 1.17 | G6 T6.8 |
