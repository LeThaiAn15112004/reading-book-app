# Checklist nghiệm thu theo giai đoạn

Dùng file này để đánh dấu tiến độ. Chỉ sang giai đoạn sau khi mục hiện tại đủ (hoặc ghi rõ nợ được chấp nhận).

---

## G0 — Nền tảng

- [ ] Desktop `npm run dev` chạy ổn
- [ ] SQLite + migration tạo được
- [ ] IPC preload hẹp; renderer không đụng FS trực tiếp
- [ ] `packages/domain` / `shared` skeleton: domain models SDS §3 (gồm Collection) + ports SDS §2.6 (gồm CollectionStore)
- [ ] Feature flag AI / External libraries = off
- [ ] Không UI đăng nhập email/password / OAuth2

## G1 — Splash & Library

- [ ] Splash → Library tự động khi ready
- [ ] Empty state + CTA Add
- [ ] Shelves + SCR-01a Back
- [ ] Collections nav + hub (list tập; stub tạo được chấp nhận ở G1)
- [ ] Không UI bookstore

## G2 — Import

- [ ] Import EPUB từ máy → hiện Library
- [ ] Dedup SHA-256
- [ ] Import URL direct file → sandbox local
- [ ] Overlay đóng + toast; không màn Import riêng
- [ ] Format không hỗ trợ bị từ chối rõ

## G3 — Reader EPUB

- [ ] Mở EPUB đọc được
- [ ] Invisible UI (chrome ẩn mặc định)
- [ ] TOC / điều hướng cơ bản
- [ ] File gốc không bị ghi đè

## G4 — Tiến độ & Reading Settings

- [ ] Resume đúng CFI sau restart
- [ ] Continue Reading đúng sách
- [ ] Theme light/sepia/dark + typography
- [ ] Đổi theme không reload cả document
- [ ] Progress % / thanh mỏng

## G5 — Highlight / Note / Bookmark

- [ ] Highlight ≤ 2 thao tác; persist
- [ ] Note CRUD; không note rỗng
- [ ] Bookmark + jump
- [ ] Sidebar theo `bookId` (không SCR-04 toàn cục)
- [ ] Vẽ lại overlay khi mở sách

## G6 — Đa format + App Settings + polish MVP

- [ ] PDF: mở + resume trang (+ overlay tối thiểu)
- [ ] TXT + Markdown: mở + resume
- [ ] Xóa sách cascade (FR-12)
- [ ] Collections CRUD + gắn/gỡ sách (FR-14) đủ dùng MVP
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
| | | | | |
