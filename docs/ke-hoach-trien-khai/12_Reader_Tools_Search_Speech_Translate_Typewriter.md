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
| ~~Typewriter~~ | ~~Gõ chữ đè lên trang~~ | **Đã bỏ khỏi kế hoạch** (xem §5) — thay bằng style kind `textbox` trong hệ highlight |
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

## 5. Typewriter — ĐÃ BỎ KHỎI KẾ HOẠCH

**ID nợ:** ~~TOOL-TW1~~ — đóng, không phải nợ nữa.

> Toàn bộ mục §5 gốc (bên dưới) mô tả Typewriter như một **ô văn bản tự do kéo-thả** riêng biệt với highlight, kể cả một mục "Hiện có" từng liệt kê `ReaderTypewriterNote`, "Fake canvas + EPUB host overlay", contract `page-rect` (`serializeTypewriterPageRect`)… — **không còn đúng**: toàn bộ thư mục `src/reader/typewriter/` (`TypewriterRichEditor.tsx`, `TypewriterFormatToolbar.tsx`, `typewriterBoxDrag.ts`, `typewriterHitTest.ts`, `typewriterFocusSession.ts`, `typewriterSelection.ts`, `typewriterToolbarPortal.ts`) cùng `typewriter-cfi-anchor.ts` đã bị **xóa khỏi codebase**. Bảng `annotations`/`notes` vẫn giữ giá trị `type` liên quan (`textbox`) nhưng với ngữ nghĩa khác hẳn kế hoạch gốc:
>
> - `textbox` bây giờ là một **`HighlightStyleKind`** — cùng họ với `highlight`/`underline`/`strikethrough` — áp lên một **selection có sẵn** trong text (giống mọi highlight khác), không phải một ô đặt tự do tại toạ độ bất kỳ trên trang.
> - Không kéo-thả vị trí; không rich-text toolbar; không z-index riêng để tránh chặn Select/Highlight — vì nó dùng chung pipeline click/right-click/resize với highlight (`useReaderHighlights.ts`, `HighlightContextMenu.tsx`, `NoteTextboxPopup.tsx`).
> - Không có khái niệm PDF `page-rect` cho textbox — PDF chưa có renderer nên chưa render được bất kỳ loại note nào.
>
> Xem trạng thái cuối tại [06_Giai_doan_5](./06_Giai_doan_5_Highlight_Note_Bookmark.md) §2.3.

---

## 6. Thứ tự khuyến nghị

```text
Search local (S1–S3)     ← giá trị đọc hàng ngày, không cần AI
  → Translate selection (T1–T2) ← cần provider
  → Speech TTS (P1–P3)          ← spike UX + OS API
  → Semantic Search / cloud voice / batch translate ← G7+
```

(Typewriter đã bỏ khỏi thứ tự này — xem §5.)

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
| `textbox` (thay Typewriter) | `useReaderHighlights.ts`, `HighlightContextMenu.tsx`, `NoteTextboxPopup.tsx` dưới `src/screens/Reader/` — xem §5 |
| Titlebar search (stub) | `AppTitlebar` + `readerSearchQuery` |
