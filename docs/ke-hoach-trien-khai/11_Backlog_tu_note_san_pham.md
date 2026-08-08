# Backlog / nợ từ ghi chú sản phẩm (`docs/note/note.txt`)

**Nguồn:** [`docs/note/note.txt`](../note/note.txt)  
**Cập nhật:** 2026-07-27  
**Mục đích:** Map **đầy đủ** từng ý trong note → trạng thái hiện tại + giai đoạn trả (hoặc ngoài phạm vi). Không để sót ý “đã nói nhưng chưa ghi nợ”.

Quy tắc:

- **Đã có trong MVP plan** → gắn G3–G8 / ID nợ G1/G2 hiện có.
- **Muốn có nhưng chưa có task phase** → ghi **NOTE-xx**, gắn giai đoạn đề xuất.
- **Cố ý không làm** → ghi **Ngoài phạm vi** (khớp SDS / BR).

---

## Bảng map đầy đủ

| # | Ý trong `note.txt` | Trạng thái hiện tại | ID nợ / FR | Trả ở |
| ---: | :--- | :--- | :--- | :--- |
| 1 | Import sách từ **file hệ thống** | **Đã làm** G2 (From device) | FR-01 | — (đóng) |
| 2 | Import sách từ **link mạng** | **Đã làm** G2 (From URL) | FR-13 | — (đóng) |
| 3 | Đổi **màu nền** khi đọc (giảm mỏi mắt) | UI Aa theme Night/Sepia/Paper (shell); **chưa persist** per-book | FR-04 · **NOTE-R1** | **G4** |
| 4 | Chỉnh **màu chữ** tương phản với nền | Theme đổi cặp bg/text; chưa custom color tự do | FR-04 · **NOTE-R2** | **G4** (preset đủ); custom hex → polish sau nếu cần |
| 5 | **Xoay màn** / đọc ngang | Desktop xoay cửa sổ OK; `is_landscape` / dual-page khi ngang chưa wire session | **NOTE-R3** | **G4** (layout 1/2 trang + landscape) |
| 6 | **Next trang nhanh** | Fake scroll; chưa paginated/page-turn EPUB thật | FR-02/03 · **NOTE-R4** | **G3** (EPUB nav) + **G4** (page mode) |
| 7 | **Đánh dấu trang** (bookmark) | UI ribbon/sidebar stub in-memory; chưa SQLite | FR-11 · **NOTE-R5** | **G5** |
| 8 | **Lưu yêu thích** | Cột `is_favorite`; chưa toggle UI / filter | FR-08 · **G1-N3** | **G4** |
| 9 | **AI tóm tắt** sách dài | Feature flag off; chưa UI | FR-20+ · **NOTE-AI1** | **G7** (opt-in, không auto import) |
| 10 | **Search trong docs** (find-in-book) | Tools + titlebar stub toast; chưa tìm text | **NOTE-R6** · **TOOL-SEARCH1** | Find cơ bản **G3/G4**; chi tiết [12](./12_Reader_Tools_Search_Speech_Translate_Typewriter.md); semantic **G7** |
| 11 | **Note** văn bản | UI modal/sidebar in-memory; chưa persist | FR-07 · **NOTE-R7** | **G5** |
| 12 | **Đọc audio** (TTS) cho ai lười nhìn | Nút Speech trên Tools (stub); chưa TTS | **NOTE-TTS1** · **TOOL-SPEECH1** | Spike / **sau G7** — [12](./12_Reader_Tools_Search_Speech_Translate_Typewriter.md) |
| 13 | Ít khi 2 trang ngang; **1 trang căn giữa**; khung chia 2 trang | Aa layout UI có; chưa EPUB thật + spine | SDS SCR-05 · **NOTE-R8** | **G4** |
| 14 | **Chọn kiểu đọc** (scroll / lật trang) | Aa page mode UI; chưa renderer | SDS SCR-05 · **NOTE-R9** | **G4** |
| 15 | **Bỏ quản lý user**; chỉ linked libs (GG Books, iCloud…) | Đã chốt BR-08 / không account; connector chưa làm | FR-30 · **NOTE-L1** | **G8** |
| 16 | Đồng bộ → **load list sách** từ lib ngoài + sync trong app | Chưa | FR-30 · **NOTE-L1** | **G8** |
| 17 | Card thiếu **thể loại / MB / tổng trang / mô tả ngắn** | Schema + list UI kéo sớm (`006`/`007`, ShelfDetailItem); sách cũ thiếu page/genre đến khi re-import / backfill | **G1-N7** | **G6** polish (backfill + PDF pages) |
| 18 | **UI bìa** chưa đẹp | Cover EPUB khi có; UX mỏng | **G1-N8** · **G2-N7** | **G6** polish |
| 19 | Import: **add bìa** thủ công; không có → **bìa default + title** | Chưa form chọn bìa; fallback chưa chuẩn | **G2-N5** · **G2-N7** | **G6** |
| 20 | Màn import: Title, mô tả, thể loại, tác giả, ảnh bìa, link file… | Chỉ metadata từ file/filename; chưa form enrich | **G2-N5** | **G6** polish |
| 21 | **AI phân tích** đề xuất thêm field metadata | Chưa; không auto khi import | **NOTE-AI2** | **G7** (opt-in) |
| 22 | **Check bản quyền** / DRM | Cố ý không làm marketplace/DRM | — | **Ngoài phạm vi** (SDS) |
| 23 | **Zoom** in / out | Chưa (font size A± gần tương đương một phần) | **NOTE-R10** | **G4** (font) đủ MVP; pinch/zoom trang PDF → **G6** |
| 24 | **Độ sáng** màn + chế độ ngày / đêm / **ngoài trời** | Theme 3 preset; chưa brightness OS/app; chưa preset “outdoor” | **NOTE-R11** | Theme **G4**; brightness / outdoor → **G6** SCR-06 Appearance |

---

## Gom theo giai đoạn (để làm việc)

### Đã xong (không còn nợ)

- Import file + URL (`note` dòng 1–2).

### G1 / G2 — Library & Import (đã đạt outcome; còn nợ polish)

Xem [02 §5](./02_Giai_doan_1_Splash_Library.md) · [03 §5](./03_Giai_doan_2_Import.md):

- Yêu thích → **G1-N3**
- Card metadata (thể loại, MB, trang, mô tả) → **G1-N7**
- Bìa đẹp / default + title → **G1-N8**, **G2-N7**
- Form enrich + chọn bìa lúc import → **G2-N5**

### G3 — Reader EPUB

- Next trang / nav nhanh trên EPUB thật → **NOTE-R4**
- Find-in-book cơ bản (không AI) → **NOTE-R6** (một phần)

### G4 — Progress + Reading Settings

- Theme bg/text (ngày/đêm/sepia) persist → **NOTE-R1**, **NOTE-R2**
- Landscape / dual-page / kiểu đọc scroll|paginated → **NOTE-R3**, **NOTE-R8**, **NOTE-R9**
- Favorite UI + Continue Reading data → **G1-N3**, **G1-N1**
- Font / zoom đọc (A±) → **NOTE-R10** (MVP)

### G5 — Overlay

- Bookmark → **NOTE-R5**
- Note → **NOTE-R7**
- Highlight (liên quan note/selection; có trong SDS dù note.txt không nêu riêng màu)

### G6 — Đa format + App Settings + Library polish

- Metadata card + cover UX + import form → **G1-N7/N8**, **G2-N5/N7**
- Brightness / outdoor reading mode → **NOTE-R11**
- Zoom trang PDF → **NOTE-R10** (PDF)
- Signature detect, delete cascade, collections persist → G2/G1 nợ sẵn

### G7 — Premium AI

- Tóm tắt sách dài → **NOTE-AI1**
- AI gợi ý / điền metadata → **NOTE-AI2**
- Semantic search trong sách → phần nâng cao của **NOTE-R6**

### G8 — Linked libraries

- Không account app; GG Books / iCloud Books / Drive → **NOTE-L1**

### Reader companion tools (UI shell 2026-08-05)

Chi tiết task: [12_Reader_Tools_Search_Speech_Translate_Typewriter.md](./12_Reader_Tools_Search_Speech_Translate_Typewriter.md)

| ID | Ý | Trạng thái | Trả ở |
| :--- | :--- | :--- | :--- |
| **TOOL-SEARCH1** | Search in-book | Nút Tools + toast | G3/G4 polish → G7 semantic |
| **TOOL-SPEECH1** | Speech / TTS | Nút Tools + toast | Sau G7 (spike) |
| **TOOL-TR1** | Translate đoạn/trang | Nút Tools + toast | Sau MVP / G7 provider |
| **TOOL-TW1** | Typewriter overlay persist | Tool kích hoạt được trên fake; chưa SQLite/EPUB neo | Sau G5/G6 |

### Ngoài phạm vi / chưa cam kết MVP

| ID | Ý | Lý do |
| :--- | :--- | :--- |
| — | Check bản quyền / DRM marketplace | SDS: ngoài sản phẩm |
| **NOTE-TTS1** | Đọc audio (TTS) | Chưa có trong SRS/SDS MVP — chỉ backlog; quyết định sau G7 |

---

## Liên kết

- Checklist tổng: [10_Checklist_nghiem_thu.md](./10_Checklist_nghiem_thu.md)
- Companion tools: [12_Reader_Tools_Search_Speech_Translate_Typewriter.md](./12_Reader_Tools_Search_Speech_Translate_Typewriter.md)
- Note gốc: [`docs/note/note.txt`](../note/note.txt)
