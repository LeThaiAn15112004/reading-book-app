# 12 — Reader Tools: Search · Speech · Translate · Typewriter

**Mục tiêu tài liệu:** Ghi nhận các công cụ companion trên thanh Tools của Reader (SCR-03). **UI entry đã có** trên `ToolsStrip`; triển khai chi tiết **làm sau**, theo thứ tự bên dưới.

**Cập nhật:** 2026-08-05  
**Liên quan:** [04 Reader EPUB](./04_Giai_doan_3_Reader_EPUB.md) · [06 Highlight/Note](./06_Giai_doan_5_Highlight_Note_Bookmark.md) · [08 Premium AI](./08_Giai_doan_7_Premium_AI.md) · [11 Backlog note](./11_Backlog_tu_note_san_pham.md)

---

## 1. Trạng thái hiện tại (shell UI)

Thanh Tools Reader dùng layout **icon trên / nhãn dưới** (tiết kiệm chiều ngang):

| Tool | Vai trò | Trạng thái code |
| :--- | :--- | :--- |
| Hand / Select / Highlight | Interaction mode (đã có) | Đủ dùng |
| **Search** | Find-in-book | Nút + toast stub |
| **Speech** | Text-to-speech | Nút + toast stub |
| **Translate** | Dịch đoạn / trang | Nút + toast stub |
| **Typewriter** | Gõ chữ đè lên trang (fake canvas đã có) | Nút kích hoạt tool; persist / EPUB thật → sau |
| Sign | Panel chữ ký | Đã có shell |

**Không** coi các tool companion là DoD của G3–G5 hiện tại — chỉ chừa chỗ UX + kế hoạch.

---

## 2. Search (find-in-book)

**ID nợ:** **NOTE-R6** · **TOOL-SEARCH1**  
**Giai đoạn đề xuất:** cơ bản **G3/G4 polish**; semantic **G7**

### Outcome mong muốn

1. Mở Search từ Tools (hoặc titlebar) → ô nhập query trong sách đang mở.
2. Tìm text thuần (EPUB spine / PDF text layer) → list kết quả + nhảy tới vị trí.
3. Highlight tạm match hiện tại; Prev / Next.
4. Không phụ thuộc AI cho bản cơ bản.

### Việc cần làm (sau)

| Task | Chi tiết |
| :--- | :--- |
| **S1** | Panel / popover Search trong Reader (không phá Invisible UI) |
| **S2** | Extract + index text theo section (EPUB); API `findInBook` |
| **S3** | Jump location (CFI / page) + wrap navigation |
| **S4** | (G7) Semantic search — xem [08](./08_Giai_doan_7_Premium_AI.md) |

### Nghiệm thu (khi làm)

- [ ] Gõ từ có trong sách → ≥ 1 hit, nhảy đúng đoạn
- [ ] Không có mạng vẫn tìm được (search local)
- [ ] Đóng Search không mất vị trí đọc

---

## 3. Speech (Text-to-Speech)

**ID nợ:** **NOTE-TTS1** · **TOOL-SPEECH1**  
**Giai đoạn đề xuất:** spike sau **G7** (chưa cam kết MVP)

### Outcome mong muốn

1. Bắt đầu đọc to từ vị trí hiện tại (hoặc đoạn đang chọn).
2. Play / Pause / Stop; tốc độ đọc; giọng hệ thống (OS TTS trước khi cloud).
3. Tùy chọn highlight theo câu đang đọc (nice-to-have).
4. Không auto-play khi mở sách.

### Việc cần làm (sau)

| Task | Chi tiết |
| :--- | :--- |
| **P1** | Spike: `speechSynthesis` vs engine native (Electron) |
| **P2** | Queue text theo paragraph / CFI range |
| **P3** | Controls trên Tools / mini player không che chữ |
| **P4** | Policy: offline-first; cloud voice = opt-in Premium nếu có |

### Nghiệm thu (khi làm)

- [ ] Play từ vị trí hiện tại nghe được tiếng
- [ ] Pause / Stop ổn; đổi chương không crash
- [ ] Tắt Speech không chặn tương tác Hand / Select

---

## 4. Translate

**ID nợ:** **TOOL-TR1**  
**Giai đoạn đề xuất:** sau MVP; có thể gắn **G7** (provider) hoặc phase riêng

### Outcome mong muốn

1. Dịch **đoạn đang chọn** (ưu tiên) hoặc trang / chương (opt-in).
2. Hiển thị bản dịch cạnh / overlay nhẹ — không thay file gốc (BR-01).
3. Chọn ngôn ngữ đích; nhớ preference app.
4. Offline / lỗi API: fail mềm, vẫn đọc được bản gốc.

### Việc cần làm (sau)

| Task | Chi tiết |
| :--- | :--- |
| **T1** | UX: chọn đoạn → Translate; panel kết quả đóng dễ |
| **T2** | Port `TranslationProvider` (NoOp → cloud / on-device) |
| **T3** | Cache dịch theo hash đoạn + bookId (tuỳ chọn) |
| **T4** | Gate Premium nếu dùng API trả phí |

### Nghiệm thu (khi làm)

- [ ] Bôi đoạn → thấy bản dịch; file EPUB/PDF gốc không đổi
- [ ] Không mạng → thông báo rõ, Reader vẫn dùng được
- [ ] Không auto-dịch cả sách khi import

---

## 5. Typewriter

**ID nợ:** **TOOL-TW1**  
**Giai đoạn đề xuất:** polish sau **G5** (overlay) / **G6** (đa format)

### Outcome mong muốn

1. Tool Typewriter trên thanh Tools → click trang → nhập text đè lên bề mặt đọc.
2. Lưu overlay SQLite (không ghi file gốc) — cùng tinh thần highlight/note.
3. Sửa / xóa / kéo vị trí (desktop).
4. EPUB thật: neo theo location ổn định (không chỉ % fake canvas).

### Việc cần làm (sau)

| Task | Chi tiết |
| :--- | :--- |
| **W1** | Model + migration overlay `annotations` (đã có migration 011) |
| **W2** | Persist IPC; repaint khi đổi trang / resume |
| **W3** | EPUB: toạ độ / CFI neo; PDF: page + point |
| **W4** | UX edit inline; z-index không chặn Select/Highlight |

### Hiện có

- `ReaderTypewriterNote` + persist `annotations` `type=textbox` (T5.6a–d)
- Fake canvas + EPUB host overlay: đặt / sửa / xóa / kéo vị trí; click textbox cũ → edit
- EPUB: `location_data` v2 `cfi-offset` (CFI + pixel offset); sidebar jump qua CFI
- PDF: contract `page-rect` (`serializeTypewriterPageRect`); chặn đặt mới đến G6 T6.2
- Nút Tools kích hoạt tool (toggle về Hand)

### Nghiệm thu (khi làm)

- [ ] Đặt typewriter → đóng sách → mở lại còn đúng chỗ (EPUB: CFI+offset; fake: `%`)
- [ ] Tool Typewriter → click textbox cũ → edit (không tạo mới); kéo vị trí persist + nâng cấp legacy `%` → CFI; xóa + undo
- [ ] EPUB: đổi font/margin → textbox vẫn neo đúng; sidebar jump qua CFI
- [ ] File gốc không bị sửa
- [ ] Hand / Select / Highlight vẫn dùng được khi không ở mode Typewriter

---

## 6. Thứ tự khuyến nghị

```text
Search local (S1–S3)     ← giá trị đọc hàng ngày, không cần AI
  → Typewriter persist (W1–W3)  ← cùng lớp overlay G5/G6
  → Translate selection (T1–T2) ← cần provider
  → Speech TTS (P1–P3)          ← spike UX + OS API
  → Semantic Search / cloud voice / batch translate ← G7+
```

---

## 7. Phạm vi cố ý không làm sớm

| Không làm sớm | Lý do |
| :--- | :--- |
| Auto-TTS khi mở sách | Phá flow đọc (NFR-02) |
| Dịch cả sách lúc import | Chi phí + privacy; trái nguyên tắc opt-in |
| Thay nội dung file bằng bản dịch | Vi phạm BR-01 Read-Only |
| Cloud TTS / translate bắt buộc online | Reader phải đọc được offline |

---

## 8. Liên kết code (điểm vào)

| Thành phần | Path |
| :--- | :--- |
| Tools strip UI | `source/apps/reading-book-desktop/src/screens/Reader/components/chrome/ToolsMenu.tsx` |
| Topbar | `.../chrome/ReaderTopbar.tsx` |
| Stub companion | `ReaderScreen` → `onCompanionTool` (toast) |
| Typewriter state | `reader-session.ts` · `ReadingCanvas` |
| Titlebar search (stub) | `AppTitlebar` + `readerSearchQuery` |
