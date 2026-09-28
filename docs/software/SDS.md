# Software Design Specification (SDS)

**Sản phẩm:** Reading Book App — Trình đọc sách / tài liệu thông minh (Trợ lý tri thức cá nhân)  
**Phiên bản tài liệu:** 1.24  
**Ngày:** 2026-09-29  
**Trạng thái:** Draft — căn cứ SRS + Design Plan (MVP Free Core) + mockups  
**Tài liệu liên quan:** [SRS.md](./SRS.md), [docs/mockups/](../mockups/)  
**Changelog 1.2:** Import từ URL (direct file → sandbox) đưa vào MVP — SDS §1.2, §2.6–2.8, §3.5–3.7; SRS FR-13 / UC-01 / WF-02.  
**Changelog 1.3:** Import **không** còn là màn hình riêng (SCR) — chỉ modal dialog (desktop) / bottom sheet (mobile); hành động bổ trợ trên Library.  
**Changelog 1.4:** Thu hẹp định dạng hỗ trợ MVP còn **4**: EPUB, PDF, TXT, Markdown — bỏ MOBI/AZW3/DOCX khỏi phạm vi tạm thời.  
**Changelog 1.5:** Bổ sung mockup **SCR-03 Reader** (`reading.html`) + chốt IA chrome (Tools / Settings / More, sidebar TOC, Comment theo đoạn); **SCR-05** gắn panel Settings trong Reader.  
**Changelog 1.6:** Bổ sung mockup **SCR-06 App Settings** (`setting.html`) — Account, Appearance, File scan, Multi-document, Language, Fullscreen; phân biệt rõ với **SCR-05** Reading Settings.  
**Changelog 1.7:** **Gỡ SCR-04** Highlights & Notes (màn toàn cục) — highlight / note / comment thuộc **từng document**, ôn lại trong **SCR-03** sidebar (tab Note · Comment · Bookmark).  
**Changelog 1.8:** Đổi entity `READING_PROGRESS` / `ReadingProgress` → **`READING_SESSION_STATE` / `ReadingSessionState`** (resume vị trí + setting per-book; không hàm ý đọc hết / đọc tuần tự).  
**Changelog 1.9:** Đổi package `packages/types` → **`packages/domain`** (`@reading-book/domain`) — khớp lớp Domain (models + ports), không còn tên “types” gây hiểu nhầm.  
**Changelog 1.10:** Thêm **`COLLECTION` / `COLLECTION_BOOK`** (bộ sưu tập user-curated, quan hệ n–n với `BOOK`) — khớp sidebar Collections (mockup Library) + SRS FR-14.  
**Changelog 1.11:** **Bỏ tài khoản app** (email/password, OAuth2). SCR-06 nhóm **Linked libraries** thay Account; Phase 3 = `ExternalLibraryConnector` (Google Drive / Google Books / Apple Books) kéo danh mục tài liệu — SRS FR-30, NFR-11, BR-08.  
**Changelog 1.12:** FR-10 — **bỏ UI % hoàn thành / thanh fill tiến độ đọc**; Library & Continue Reading hiện **last-read location**; Reader scrubber = bản đồ vị trí (nhãn chương/trang), không frame “% đọc xong”. Completed = user-marked, không suy từ %.  
**Changelog 1.13:** Phạm vi định dạng MVP = **6 format**: EPUB, PDF, TXT, Markdown, **DOCX**, **DOC** — cập nhật enum `file_format`, adapter, mockup chips; ngoài MVP: MOBI/AZW3/PPTX.  
**Changelog 1.14:** Thêm **§3.10 Catalog bảng & thuộc tính** (SQLite vật lý: từng cột / kiểu / ràng buộc) — khớp migration `001_initial.sql`; desktop & mobile dùng cùng schema logic.  
**Changelog 1.15:** Thêm **`BOOK.is_signed`** + bảng **`BOOK_SIGNATURE` / `book_signatures`** (chi tiết chữ ký số; cascade khi xóa sách) — migration `003_book_signatures.sql`.  
**Changelog 1.21:** Gộp `highlights`, `notes`, `typewriter_notes` thành bảng duy nhất **`annotations`** (chứa type: highlight, typewriter, shape) — migration `011_annotations.sql`. Đổi `highlight_tags` thành `annotation_tags`.  
**Changelog 1.17:** **Bỏ bảng `app_settings`** khỏi SQLite overlay — app preferences theo platform (desktop: `electron-store`; mobile: MMKV / AsyncStorage); model `AppPreferences` vẫn dùng chung; migration `005_drop_app_settings.sql`.  
**Changelog 1.18:** Library metadata — `books.description`, `books.page_count` (006); thể loại **n–n** qua **`GENRE` / `BOOK_GENRE`** (`genres`, `book_genres`) thay cột `books.genre` (007). **Không** khôi phục `app_settings`.
**Changelog 1.19:** **`highlights` v2** (009) — gộp ghi chú vào highlight (`note`, `status`, `is_checked`, `updated_at`); một cột `location` (pack `start|end`); **bỏ bảng `notes`**; thêm **`tags`** + **`highlight_tags`** (N–N). **`reading_session_states` v2** (008). **Không** khôi phục `app_settings`.
**Changelog 1.22:** Kiến trúc render/annotate EPUB đổi hẳn (migration `010`→`019`, dọn dẹp `docs/note/` cũ):
- Bỏ layer overlay vẽ riêng (`DomCssOverlay`, `InkIframeLayer`, `TypewriterIframeLayer`) và port `OverlayPainter` — EPUB tự vẽ mark highlight/underline/strikethrough/textbox qua API annotation **có sẵn của epub.js** (`rendition.annotations`, xem `EpubjsHandle.applyHighlight/removeHighlight` trong `openEpubjs.ts`), tự tái gắn mark mỗi khi section re-render; không còn port riêng cho việc "vẽ lại overlay".
- Bỏ hẳn tính năng **Typewriter** (rich-text box kéo-thả tự do) và **Freehand/Shape** (vẽ tay) khỏi UI đang dùng — cả hai chỉ còn là **giá trị enum lịch sử** trong `note_json.type` (`freehand`, `stamp`) chờ một PDF renderer (chưa tồn tại) triển khai lại theo hướng khác; xem `pdfAnnotationTools.ts`. `textbox` (sticky-note 📝, không tô màu) là type còn sống, thay thế phần "ghi chú rời" mà Typewriter từng đảm nhiệm.
- Bảng `annotations` (011→012→016→017) rồi bị **gộp vào `notes`** (018, theo mô hình Readium/Thorium Reader): một cột JSON `note_json` duy nhất (`type`, `locatorExtended` hoặc `pdfAnnotation`, `style`, `textualValue`, `note`, `tags`, `status`, `isChecked`…) thay cho nhiều cột SQL cứng; `annotation_tags` → `note_tags`.
- Bảng `bookmarks` (đứng riêng từ đầu) cũng bị **gộp vào `notes`** (019): `note_json.group` (`'annotation'` | `'bookmark'`) phân biệt 2 loại thay vì 2 bảng.
- `book_signatures` (1 chữ ký/sách) gộp thẳng vào `books.signer_name` / `signature_status` / `signed_at` (018) — bảng con bị xóa.
- `COMMENT`/`comments` (004) đã bị xóa từ trước đó (migration `010`, thay bằng `typewriter_notes`) và **không tồn tại** trong schema hiện tại — SDS bản cũ vẫn nhắc tới `COMMENT` do sót cập nhật; đã gỡ khỏi §3.
- Xem chi tiết bảng vật lý cập nhật: `docs/software/schema.dbml`.

**Changelog 1.23:** Gộp dữ liệu 1-1 / n-n của `books` vào **chính bảng `books`** dưới dạng 3 cột JSON (migration `020_optimized_books_schema.sql`):
- `reading_session_states` (1-1) → `books.reading_state_json` (vị trí đọc + setting đọc per-book + `updatedAt`).
- `genres` + `book_genres` (n-n) → `books.genres_json` (mảng tên thể loại, sắp A→Z, không trùng không phân biệt hoa/thường). Không còn thực thể `GENRE` / `BOOK_GENRE` ở tầng lưu trữ.
- Các cột lẻ `file_size_bytes`, `page_count`, `description`, `is_signed`, `signer_name`, `signature_status`, `signed_at` → `books.metadata_json`.
- Giữ nguyên là cột riêng: `normalized_path`, `file_path`, `cover_path`, `is_favorite`, `reading_status`, `source_*`, `external_id`. Index đổi tên: `idx_books_favorite`, `idx_books_reading_status`, `idx_books_source`; bỏ `idx_books_is_signed`.
- Domain không đổi (`ReadingSessionState`, `Book.isSigned`…) — chỉ tầng Persistence map sang/từ JSON. Cập nhật một phần từng key bằng `json_patch` (RFC 7396).

**Changelog 1.24:** **Import theo file (file-centric) — thư viện tham chiếu.** Không đổi schema (`books.file_path` vẫn `TEXT NOT NULL`); đổi **ngữ nghĩa sở hữu** của `file_path`:
- **Local** (file trên máy) → **không còn copy vào sandbox**: `file_path` = path tuyệt đối file gốc của user (*referenced*, user sở hữu; app không ghi / di chuyển / xóa file và thư mục cha).
- **URL / Cloud** → tải về temp → SHA-256 → chặn trùng → lưu bản copy app-owned `{userData}/books/{uuid}/…` (*managed*) → metadata → SQLite; `source_url` / `source_provider` / `external_id` giữ nguyên.
- Loại sở hữu **suy ra từ path** (`bookFileStorage()` trong `electron/files/sandbox.ts`), không thêm cột. Sách import trước 1.24 (đã có bản copy trong sandbox) tiếp tục là *managed*, không migration phá hủy.
- Cover luôn do app sở hữu, ghi vào `{userData}/covers/` (không bao giờ ghi cạnh file sách của user). Chunk / FTS / annotation / reading state vẫn khóa theo `books.id`.
- File tham chiếu bị di chuyển / xóa → sách **không bị xóa**; Reader báo `missing_file` và đề nghị **Locate file** (`library:relinkBook`): Main mở dialog, chỉ cập nhật `file_path` khi SHA-256 khớp `books.sha256` (giữ nguyên `books.id`).
- Xóa sách: "Remove from library" không bao giờ xóa file sách; "Delete file" chỉ khả dụng cho sách *managed* (`removeManagedBookDir` từ chối mọi thứ không đúng dạng `{sandbox}/{uuid}/file`).
- Chi tiết triển khai: `docs/implementation_plan/file_centric_import_architecture.md`.

---


## Mục lục

- [1. Giới thiệu chung (Introduction)](#1-giới-thiệu-chung-introduction)
  - [1.1. Mục đích tài liệu](#11-mục-đích-tài-liệu)
  - [1.2. Phạm vi (Scope)](#12-phạm-vi-scope)
  - [1.3. Thuật ngữ & Viết tắt](#13-thuật-ngữ--viết-tắt)
- [2. Software Architecture](#2-software-architecture)
  - [2.1. Kết luận kiểu kiến trúc](#21-kết-luận-kiểu-kiến-trúc)
  - [2.2. Mục tiêu & ràng buộc kiến trúc](#22-mục-tiêu--ràng-buộc-kiến-trúc)
  - [2.3. Các lớp logic (Layered)](#23-các-lớp-logic-layered)
  - [2.4. Sơ đồ kiến trúc tổng quan (MVP Desktop)](#24-sơ-đồ-kiến-trúc-tổng-quan-mvp-desktop)
  - [2.5. Kiến trúc process Electron (bổ sung layered)](#25-kiến-trúc-process-electron-bổ-sung-layered)
  - [2.6. Ports & Adapters (biên đa định dạng)](#26-ports--adapters-biên-đa-định-dạng)
  - [2.7. Ánh xạ sang monorepo](#27-ánh-xạ-sang-monorepo)
  - [2.8. Luồng tiêu biểu (minh họa layered)](#28-luồng-tiêu-biểu-minh-họa-layered)
  - [2.9. Điểm mở rộng phase sau (không phá layered)](#29-điểm-mở-rộng-phase-sau-không-phá-layered)
  - [2.10. Quyết định đã chốt (architecture)](#210-quyết-định-đã-chốt-architecture)
  - [2.10.1. EPUB engine (T3.1 spike)](#2101-epub-engine-t31-spike)
  - [2.11. Cấu trúc folder dự án (source/)](#211-cấu-trúc-folder-dự-án-source)
- [3. Data Model & ERD](#3-data-model--erd)
  - [3.1. Nguyên tắc mô hình dữ liệu](#31-nguyên-tắc-mô-hình-dữ-liệu)
  - [3.2. ERD](#32-erd)
  - [3.3. Giải thích vai trò các thực thể](#33-giải-thích-vai-trò-các-thực-thể)
  - [3.4. Quan hệ & cardinality](#34-quan-hệ--cardinality)
  - [3.5. Ghi chú field quan trọng](#35-ghi-chú-field-quan-trọng)
  - [3.6. Thực thể không nằm trên ERD (nhưng liên quan)](#36-thực-thể-không-nằm-trên-erd-nhưng-liên-quan)
  - [3.7. Quyết định đã chốt (data)](#37-quyết-định-đã-chốt-data)
  - [3.8. Class Diagram](#38-class-diagram)
  - [3.9. Database Diagram](#39-database-diagram)
  - [3.10. Catalog bảng & thuộc tính (SQLite)](#310-catalog-bảng--thuộc-tính-sqlite)
- [4. Screen Design](#4-screen-design)
  - [4.1. Bản đồ màn hình (MVP)](#41-bản-đồ-màn-hình-mvp)
  - [4.2. SCR-00 — Splash](#42-scr-00--splash)
  - [4.3. SCR-01 — Library](#43-scr-01--library)
  - [4.4. SCR-01a — Shelf detail (vertical list)](#44-scr-01a--shelf-detail-vertical-list)
  - [4.5. UX-IMP — Import (modal / bottom sheet)](#45-ux-imp--import-modal--bottom-sheet)
  - [4.6. SCR-03 — Reader](#46-scr-03--reader)
  - [4.7. SCR-05 — Reading Settings](#47-scr-05--reading-settings)
  - [4.8. SCR-06 — App Settings](#48-scr-06--app-settings)
  - [4.9. Quyết định đã chốt (Screen / IA)](#49-quyết-định-đã-chốt-screen--ia)

---

## 1. Giới thiệu chung (Introduction)

### 1.1. Mục đích tài liệu

Tài liệu SDS này mô tả **kiến trúc và thiết kế chi tiết** cho dự án **reading-book-app**, nhằm:

- Chuyển các yêu cầu trong [SRS](./SRS.md) thành quyết định kỹ thuật cụ thể (component, data model, persistence, IPC, reader engine).
- Thống nhất cách triển khai giữa `source/apps/reading-book-desktop`, `source/apps/reading-book-mobile` và các package dùng chung (`domain`, `shared`, `config`).
- Làm cơ sở cho backlog Phase 1, review thiết kế, và nghiệm thu kiến trúc trước khi mở rộng AI / Linked libraries.

Đối tượng đọc: architect, developer, tech lead, tester (phần liên quan contract & boundary).

### 1.2. Phạm vi (Scope)

SDS phiên bản này thiết kế chi tiết cho **MVP (Phase 1 — Free Core)** trên desktop, với kiến trúc **đa định dạng sách / tài liệu**. Các phase AI / Linked libraries chỉ được mô tả ở mức **điểm mở rộng (extension points)**, chưa thiết kế triển khai đầy đủ.

#### Định dạng tài liệu trong phạm vi thiết kế

MVP **chấp nhận 6 định dạng**:


| Định dạng      | Phần mở rộng | Kiểu hiển thị       | Location                      | Overlay & ghi chú thiết kế                                                                                                                          |
| -------------- | ------------ | ------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EPUB**       | `.epub`      | Reflowable          | **CFI**                       | Chuẩn sách điện tử; gói HTML/CSS/ảnh. Tùy chỉnh phông / cỡ chữ / màu nền tốt nhất. Overlay: chèn CSS/JS runtime, không sửa file gốc.               |
| **PDF**        | `.pdf`       | Fixed-layout        | Trang + rect / offset         | Định dạng phổ biến nhất (học thuật, in ấn, tài liệu công việc). Overlay: annotation trên **lớp Canvas trong suốt**, không chèn CSS vào nội dung PDF. |
| **Plain Text** | `.txt`       | Reflowable          | Offset ký tự / dòng           | Nhẹ nhất, không style/ảnh. Dễ extract cho FTS5 và AI (Phase 2). Overlay highlight theo range văn bản.                                               |
| **Markdown**   | `.md`        | Reflowable (render) | Offset / block + range        | Văn bản markup đơn giản; ghi chú & tài liệu kỹ thuật. Render → HTML; Overlay trên DOM đã render.                                                    |
| **DOCX**       | `.docx`      | Reflowable (render) | Offset / block + range        | Word Open XML. Import theo tham chiếu (không copy); đọc qua extract/render HTML (không mutate file gốc). Overlay DOM như Markdown.                                  |
| **DOC**        | `.doc`       | Reflowable (render) | Offset / block + range        | Word binary legacy. Import chấp nhận; normalize/extract sang dạng đọc được (có thể qua `normalized_path`); Overlay DOM.                             |


**Không đưa vào phạm vi MVP:** MOBI / AZW3, PPTX, và các định dạng ít phổ biến khác. Nếu User chọn file ngoài 6 định dạng trên → từ chối với thông báo rõ (format không được hỗ trợ).

**Nguyên tắc đa định dạng**

- Thư viện, progress, highlight/note/bookmark dùng **domain model chung**; mỗi format gắn `format` + **Document Adapter** (import, metadata, mở nội dung, map location ↔ UI).
- Reader là **shell chung** (Invisible UI, theme); phần render là **pluggable renderer** theo format (reflow HTML vs fixed PDF).
- Hai họ Overlay:
  - **DOM/CSS Overlay** — EPUB, TXT, Markdown, DOCX, DOC.
  - **Canvas Overlay** — PDF (lớp trong suốt theo trang).
- File sách mọi định dạng **không bao giờ bị sửa** (file gốc của user không bị ghi; bản copy app-owned để Read-Only); annotation chỉ nằm ở Overlay (SQLite).
- Thứ tự ưu tiên triển khai: **EPUB → PDF → TXT → Markdown → DOCX → DOC**. Contract cần đủ cho **sáu** format trên.



#### Trong / ngoài phạm vi


| Trong phạm vi thiết kế (MVP)                                                             | Ngoài phạm vi thiết kế chi tiết (MVP)                        |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Import **EPUB, PDF, TXT, Markdown, DOCX, DOC** từ **file hệ thống** (tham chiếu file gốc, không copy) hoặc **URL / cloud** (download → bản copy app-owned) | Marketplace / DRM store / Kindle store                     |
| Document Adapter + pluggable renderer (6 format)                                         | MOBI/AZW3, PPTX; convert pipeline nặng ngoài Word           |
| Reader shell chung: Invisible UI, theme / typography (theo khả năng từng họ hiển thị)    | AI Chat, RAG, tóm tắt, semantic search (Phase 2)             |
| Highlight, Note, Bookmark (Overlay SQLite); location theo format                         | Flashcards + spaced repetition (Phase 2)                     |
| Lưu / khôi phục vị trí đọc (CFI / page+rect / text offset / block range)                 | Đồng bộ account đa thiết bị / login app (không thuộc sản phẩm) |
| Màn Library, Reader, Reading Settings (**SCR-05**), App Settings (**SCR-06**); highlight/note **trong Reader theo document**; **Import = overlay** | Auto-tag, thống kê thói quen, knowledge links (Phase 3); **Linked libraries** đầy đủ (FR-30); màn Highlights & Notes toàn cục |
| Electron main / preload / renderer; IPC hẹp; path sandbox + download URL qua Main        | Social / quote cards / chia sẻ cộng đồng                     |
| Domain model & persistence local-first; FTS5 cho metadata / annotation / text extract    | Crawl / scrape trang HTML phức tạp (chỉ direct file URL)     |
|                                                                                          | OCR hàng loạt PDF scan chất lượng thấp (spike riêng nếu cần) |


**Nền tảng MVP:** `source/apps/reading-book-desktop` (Electron + Vite + React + TypeScript).  
**Mobile (Expo):** cùng domain model đa định dạng; adapter storage / UI map theo IA — triển khai sau khi desktop MVP ổn.

Nguyên tắc bất biến xuyên suốt thiết kế (theo SRS BR-01, BR-02):

1. File tài liệu gốc **Read-Only** — không ghi đè `.epub` / `.pdf` / `.txt` / `.md` / `.docx` / `.doc` trên đĩa.
2. Theme, highlight, note, bookmark là **Overlay** — lưu riêng và áp dụng lúc runtime (DOM/CSS hoặc Canvas tùy format).
3. **Local-first** — không phụ thuộc cloud hay API trả phí trong MVP.



### 1.3. Thuật ngữ & Viết tắt


| Thuật ngữ            | Định nghĩa                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **SDS**              | Software Design Specification — tài liệu kiến trúc và thiết kế chi tiết phần mềm.                                                                                                          |
| **SRS**              | Software Requirements Specification — tài liệu yêu cầu; đầu vào chính của SDS.                                                                                                             |
| **MVP**              | Minimum Viable Product — phiên bản đầu: đọc sạch + thư viện + highlight/note + tiến độ local.                                                                                              |
| **EPUB**             | Electronic Publication (`.epub`) — sách điện tử HTML/CSS/ảnh đóng gói; **Reflowable**; Overlay qua CSS/JS runtime.                                                                         |
| **PDF**              | Portable Document Format (`.pdf`) — **Fixed-layout**; Overlay annotation qua **Canvas trong suốt** theo trang.                                                                             |
| **Plain Text**       | Văn bản thuần (`.txt`) — không style/ảnh; nhẹ, dễ extract cho search/AI.                                                                                                                   |
| **Markdown**         | Văn bản markup nhẹ (`.md`); render sang HTML để đọc; phổ biến cho ghi chú & tài liệu kỹ thuật.                                                                                             |
| **Document Adapter** | Module theo format: import metadata, mở nội dung, map location ↔ vị trí UI / annotation.                                                                                                   |
| **CFI**              | Canonical Fragment Identifier — định vị vị trí / vùng văn bản trong **EPUB**. Format khác dùng location tương đương (page/rect, text offset, block range).                                 |
| **Overlay**          | Lớp phủ dữ liệu phụ (theme, highlight, note, bookmark…) lưu trong SQLite; **DOM/CSS** hoặc **Canvas** tùy format; không sửa file gốc.                                                      |
| **FTS5**             | Full-Text Search phiên bản 5 của SQLite — chỉ mục tìm kiếm toàn văn local (metadata, annotation, text extract).                                                                            |
| **Chunking**         | (Phase 2 — AI) Chia nội dung đã extract thành các đoạn (chunk) để embedding và RAG — TXT/Markdown dễ nhất; EPUB/PDF sau khi extract text.                                                  |
| **RAG**              | Retrieval-Augmented Generation — AI trả lời dựa trên chunk truy xuất từ tài liệu (Phase 2).                                                                                                |
| **IPC**              | Inter-Process Communication — kênh giao tiếp hẹp giữa Electron main và renderer qua preload bridge.                                                                                        |
| **Local-first**      | Dữ liệu ưu tiên lưu trên thiết bị; cloud chỉ là lớp bổ sung ở phase sau. Import từ URL / cloud **tải về bản copy app-owned** rồi đọc offline; import file trên máy chỉ **tham chiếu** file gốc (không nhân đôi dữ liệu của user).             |
| **Invisible UI**     | Chrome (toolbar, menu) ẩn mặc định; chỉ hiện khi người dùng chủ động gọi.                                                                                                                  |
| **Reflowable**       | Nội dung chảy lại theo font, size, cửa sổ (EPUB, TXT, Markdown).                                                                                                                           |
| **Fixed-layout**     | Bố cục trang cố định (PDF); zoom/pan thay vì reflow chữ.                                                                                                                                   |
| **URL Import**       | User dán / mở link trực tiếp tới file (vd. `https://…/book.epub`); Main tải file về temp rồi lưu bản copy app-owned — **không** phải bookstore hay scrape trang web tùy ý.                                         |
| **Referenced / Managed** | **Referenced** = sách import từ file trên máy: `books.file_path` là path gốc của user (user sở hữu; app không ghi / di chuyển / xóa). **Managed** = bản copy app-owned trong `{userData}/books/{uuid}/` (URL / cloud, và sách import trước 1.24); app chỉ xóa khi user chọn "Delete file". Suy ra từ path, không có cột riêng. |


---

## 2. Software Architecture



### 2.1. Kết luận kiểu kiến trúc

**Hệ thống dùng kiến trúc phân lớp (Layered Architecture) ở mức logic**, kết hợp:


| Khía cạnh                         | Kiểu                                                                       | Lý do                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Logic trong app**               | **Layered** (Presentation → Application → Domain → Infrastructure)         | Luồng rõ: UI không đụng DB/FS trực tiếp; domain dùng chung desktop/mobile; dễ test và mở phase. |
| **Biên đa định dạng / AI / Sync** | **Ports & Adapters** (hexagonal nhẹ) trên lớp Infrastructure / Application | EPUB/PDF/TXT/MD/DOCX/DOC và AI provider thay thế được mà không phá domain. |
| **Desktop runtime**               | **Multi-process (Electron)** — Main / Preload / Renderer                   | Bảo mật path sandbox, tách quyền hệ thống khỏi UI.                                              |


**Không chọn:** microservices (quá nặng cho local-first MVP), pure MVC một khối trong renderer (khó chia sẻ với mobile và khó cắm thêm format/AI).

Tóm lại: **Layered là xương sống**; adapter/plugin là khớp nối ở biên; Electron process là bố cục triển khai desktop.

### 2.2. Mục tiêu & ràng buộc kiến trúc


| Mục tiêu                     | Cách đạt                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| Local-first, offline MVP     | Persistence + file nằm Infrastructure; không phụ thuộc mạng                               |
| File gốc Read-Only + Overlay | Domain/Application sở hữu annotation; Infrastructure chỉ đọc file gốc, ghi SQLite overlay |
| Đa định dạng                 | Port `DocumentAdapter` / `DocumentRenderer`; từng format một adapter                      |
| Desktop trước, mobile sau    | Domain + Application (use cases) trong `packages/`; app chỉ Presentation + platform glue  |
| Mở AI / Linked libraries sau | Port `AiProvider`, `ExternalLibraryConnector` — stub/no-op ở MVP                          |
| An toàn                      | Renderer không gọi FS tùy ý; mọi path qua Main + allowlist                                |



| Ràng buộc                    | Hệ quả                                                                      |
| ---------------------------- | --------------------------------------------------------------------------- |
| Electron sandbox             | Repository FS/SQLite chạy Main (hoặc worker Main); Renderer gọi qua IPC hẹp |
| Invisible UI / content-first | Presentation mỏng; không nhét business vào component Reader                 |
| Monorepo `source/`           | `apps/*` phụ thuộc `packages/*`; không ngược lại                            |




### 2.3. Các lớp logic (Layered)

Layered Architecture — Reading Book App

> Nguồn PlantUML: `[docs/diagram/sds-layered/sds-layered.puml](../diagram/sds-layered/sds-layered.puml)`



#### Quy tắc phụ thuộc

- Chỉ phụ thuộc **xuống dưới** (Presentation → Application → Domain; Infrastructure triển khai interface mà Application/Domain khai báo).
- **Domain không import** React, Electron, SQLite, epub.js, pdf.js.
- **Presentation không** mở file, không SQL, không biết chi tiết CFI vs page-rect — chỉ gọi use case / facade.
- **Application** điều phối; không chứa SQL thô hay DOM reader.



#### Trách nhiệm từng lớp


| Lớp                | Trách nhiệm                          | Ví dụ                                                                          |
| ------------------ | ------------------------------------ | ------------------------------------------------------------------------------ |
| **Presentation**   | Hiển thị, tương tác, state UI cục bộ | Library, Reader shell (+ Note/Comment sidebar scoped sách), Reading Settings, App Settings |
| **Application**    | Use case, transaction nghiệp vụ ngắn | Import (tham chiếu file gốc; URL/cloud copy sandbox) → metadata → index FTS; Save overlay highlight           |
| **Domain**         | Entity, value object, invariant      | `Book.format`, `Location` đa hình, BR-01/BR-02 (read-only + overlay)           |
| **Infrastructure** | I/O, engine, IPC                     | `SqliteOverlayStore`, `EpubAdapter`, `PdfCanvasOverlay`, `ElectronFileSandbox` |




### 2.4. Sơ đồ kiến trúc tổng quan (MVP Desktop)

Architecture Overview — MVP Desktop

> Nguồn PlantUML: `[docs/diagram/sds-architecture-overview/sds-architecture-overview.puml](../diagram/sds-architecture-overview/sds-architecture-overview.puml)`



### 2.5. Kiến trúc process Electron (bổ sung layered)

Layered mô tả **logic**; trên desktop còn tách **process**:


| Process      | Thuộc lớp chính                               | Được làm                                                                    | Không được làm                                  |
| ------------ | --------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------- |
| **Renderer** | Presentation (+ gọi Application qua API sạch) | UI, render document, thu gesture                                            | Đọc path tùy ý, ghi đè file sách, SQL trực tiếp |
| **Preload**  | Infrastructure boundary                       | Expose API hẹp (`window.api.`*) đã contextBridge                            | Logic nghiệp vụ, mở rộng API tùy tiện           |
| **Main**     | Infrastructure                                | Dialog import; đăng ký file gốc (local) / copy vào app data (URL, cloud); SQLite; kiểm tra path sách theo `bookId`                    | Render UI React                                 |


Electron Process Architecture — Desktop MVP

> Nguồn PlantUML: `[docs/diagram/sds-electron-process/sds-electron-process.puml](../diagram/sds-electron-process/sds-electron-process.puml)`

Mobile sau MVP: không có Main/Preload; cùng Application/Domain; Infrastructure đổi sang Expo FileSystem / SQLite tương đương — **layered giữ nguyên**.

### 2.6. Ports & Adapters (biên đa định dạng)

Trong lớp Infrastructure (và interface phía Application), mỗi định dạng là một adapter.

Ports & Adapters — Document / Overlay / Extensibility

> Nguồn PlantUML: `[docs/diagram/sds-ports-adapters/sds-ports-adapters.puml](../diagram/sds-ports-adapters/sds-ports-adapters.puml)`


| Port (interface)                | Adapter MVP / gần MVP                        | Ghi chú                                                |
| ------------------------------- | -------------------------------------------- | ------------------------------------------------------ |
| `DocumentImporter`              | Epub / Pdf / Txt / Md / Docx / Doc Importers | Validate extension (6 format), metadata đọc tại chỗ (cover ghi vào `{userData}/covers/`)  |
| `UrlDocumentFetcher`            | `HttpUrlFetcher` (Main)                      | Download direct file URL → temp → cùng pipeline import |
| `DocumentNormalizer`            | Doc/Docx extract (optional); pass-through khác | DOC/DOCX có thể ghi `normalized_path`; format khác thường null |
| `DocumentRenderer`              | ReflowHtmlRenderer (epub.js), PdfPageRenderer (chưa có) | Reader shell chọn theo `Book.format`         |
| `LocationCodec`                 | CfiCodec, PageRectCodec, TextOffsetCodec…    | Resume location / highlight / jump             |
| `LibraryStore` / `CollectionStore` / `OverlayStore` | SqliteStore (+ FTS5)              | Persistence (books + collections + overlays)           |
| `AiProvider`                    | `NoOpAiProvider` (MVP)                       | Phase 2 thay Remote/Local                              |
| `ExternalLibraryConnector`      | `NoOpExternalLibraryConnector` (MVP)         | Phase 3 — Google Drive / Books / Apple Books   |


Domain chỉ nói: “mở sách”, “lưu highlight tại `Location`” — không biết PDF canvas hay EPUB CFI.

> **Không còn port `OverlayPainter` riêng** (đã có ở các bản SDS trước `1.22`). Việc "vẽ lại" một highlight/underline/strikethrough/textbox khi trang re-render nằm **bên trong** `DocumentRenderer` của từng format — với EPUB là API annotation có sẵn của epub.js (`rendition.annotations`, xem `EpubjsHandle.applyHighlight/removeHighlight/flashHighlight` trong `apps/reading-book-desktop/src/reader/renderers/epub/openEpubjs.ts`), không phải một lớp DOM/Canvas overlay tách biệt do app tự vẽ. PDF chưa có `DocumentRenderer` (chỉ có adapter import metadata) nên chưa có cơ chế vẽ overlay tương ứng.

### 2.7. Ánh xạ sang monorepo


| Thành phần repo                             | Lớp kiến trúc                                              |
| ------------------------------------------- | ---------------------------------------------------------- |
| `source/apps/reading-book-desktop/src`      | Presentation (Renderer)                                    |
| `source/apps/reading-book-desktop/electron` | Infrastructure (Main + Preload)                            |
| `source/apps/reading-book-mobile/src`       | Presentation (sau MVP)                                     |
| `source/packages/domain`                    | Domain models + port contracts                             |
| `source/packages/shared`                    | Domain helpers + Application use cases (platform-agnostic) |
| `source/packages/config`                    | Config dùng chung                                          |


Monorepo Package Map — `source/`

> Nguồn PlantUML: `[docs/diagram/sds-monorepo/sds-monorepo.puml](../diagram/sds-monorepo/sds-monorepo.puml)`

Chi tiết cây thư mục mục tiêu: xem §2.11.

### 2.8. Luồng tiêu biểu (minh họa layered)

**Import sách**

1. Presentation: user mở **UX-IMP** trên Library (Add menu) → file picker hoặc URL sheet → gọi `ImportBook` / `ImportBookFromUrl`.
2. Application: validate format thuộc **EPUB | PDF | TXT | MD** (và URL scheme nếu từ mạng) → đăng ký tham chiếu file gốc (local) **hoặc** download qua Main rồi lưu bản copy app-owned (URL / cloud) → tạo `Book` + metadata; chunk / FTS được tạo nền khi mở sách.
3. Domain: invariant file sách bất biến (**BR-01**); `format` hợp lệ; SHA-256 dedup (**BR-03**) — so sánh theo nội dung, không theo path.
4. Infrastructure: Main hash + đọc metadata file gốc tại chỗ (local, **không copy**) **hoặc** fetch URL vào temp (timeout, size limit, allowlist scheme) rồi copy vào app data (dọn temp; dọn bản copy nếu ghi DB lỗi) → ghi SQLite.
5. Presentation: đóng overlay → toast → refresh Library (không navigate sang màn Import).

**Highlight khi đọc**

1. Presentation: selection → “Highlight”.
2. Application: lấy `Location` từ `LocationCodec` của format đang mở → tạo `Highlight` → lưu overlay.
3. Domain: highlight thuộc `bookId`, không mutate file gốc.
4. Infrastructure: ghi SQLite (bảng `notes`, xem §3); renderer định dạng tự vẽ lại mark (EPUB: epub.js `rendition.annotations`, tự tái gắn mỗi lần section re-render) — không qua port `OverlayPainter` riêng (bỏ từ 1.22).



### 2.9. Điểm mở rộng phase sau (không phá layered)


| Phase              | Thêm gì                                            | Đặt ở đâu                                                                   |
| ------------------ | -------------------------------------------------- | --------------------------------------------------------------------------- |
| **Phase 2 — AI**   | Chunking, embedding index, `AiProvider`, panel Ask | Application use cases mới; Infrastructure adapters; Presentation panel mỏng |
| **Phase 3 — Linked libraries** | `ExternalLibraryConnector` (Google Drive / Google Books / Apple Books), pull catalog → Library local | Infrastructure + Application; Domain thêm `ExternalLibraryLink` nếu cần |


MVP giữ port trống (`NoOp*`) để UI/feature flag không phải đập lại kiến trúc.

### 2.10. Quyết định đã chốt (architecture)


| Chủ đề                 | Quyết định                                             |
| ---------------------- | ------------------------------------------------------ |
| Kiểu kiến trúc logic   | **Layered** + Ports & Adapters ở biên                  |
| Desktop process        | Electron Main / Preload / Renderer                     |
| Chia sẻ desktop–mobile | Domain + Application trong `packages/`                 |
| Đa định dạng           | Pluggable Document Adapter / Renderer (renderer tự vẽ overlay mark qua API riêng của engine, không có port `OverlayPainter` tách biệt) |
| **EPUB engine (desktop)** | **`epubjs` (epub.js) ^0.3.93** — spike T3.1 xác nhận 2026-07-27 (xem §2.10.1) |
| Persistence MVP        | SQLite (+ FTS5) overlay sách phía Main; **app prefs** = electron-store (desktop) / MMKV (mobile) |
| AI / Sync MVP          | Interface + NoOp; chưa implement                       |
| Identity               | **Không** tài khoản app (SRS NFR-11 / BR-08)           |
| Phase 3 catalog sync   | Folder / library path connectors — không OAuth2 login app |


### 2.10.1. EPUB engine (T3.1 spike)

**Đã chốt (2026-07-27):** npm package **`epubjs`** (upstream [epub.js](https://github.com/futurepress/epub.js)) **^0.3.93**, license BSD-2-Clause.

| | |
| :--- | :--- |
| **Lý do** | Mở EPUB từ `ArrayBuffer` / binary; TOC + spine; CFI (`cfiBase` / `currentLocation` / `EpubCFI`); `rendition.themes` inject CSS runtime (không ghi đè file); selection API; Vite/Electron ổn; khớp mặc định design (`docs/plan/02_Design.md`). |
| **Loại — foliate-js** | Đủ năng lực (kể cả `search.js`) nhưng README cảnh báo API chưa ổn định / không semver — rủi ro MVP cao hơn. |
| **Loại — baseline JSZip+iframe** | Không có CFI → chặn T4.1 resume và G5 highlight. |
| **Biên tích hợp** | Chỉ Infrastructure UI: `apps/reading-book-desktop/src/reader/renderers/epub/` (theo §2.11). Domain chỉ thấy `DocumentRenderer` + `Location` CFI — **không** import `epubjs`. |
| **Electron** | Renderer nhận bytes/Blob qua Main IPC allowlist — kênh **`library:openBookContent`** (T3.4); không đọc path tùy ý. Spike harness: `#/spike/epub` + `spikes/epub-engine/MATRIX.md` (không gắn Library → Reader). |

Chi tiết ma trận Pass/Fail: [`source/apps/reading-book-desktop/spikes/epub-engine/MATRIX.md`](../../source/apps/reading-book-desktop/spikes/epub-engine/MATRIX.md).


### 2.11. Cấu trúc folder dự án (`source/`)

Monorepo hiện có skeleton (`apps/*`, `packages/{domain,shared,config}`). Dưới đây là **cấu trúc mục tiêu** bám layered architecture (§2.3–2.7). Folder đánh dấu `(MVP)` ưu tiên Phase 1; `(P2)` / `(P3)` chỉ cần port/stub.

```text
source/
├── package.json                          # workspace root
├── apps/
│   ├── reading-book-desktop/             # MVP primary
│   │   ├── electron/                     # Infrastructure — Main + Preload
│   │   │   ├── main.ts
│   │   │   ├── preload.ts
│   │   │   ├── ipc/                      # (MVP) channel handlers hẹp
│   │   │   │   ├── library.ipc.ts
│   │   │   │   ├── import.ipc.ts
│   │   │   │   └── overlay.ipc.ts
│   │   │   ├── persistence/              # (MVP) SQLite + FTS5 phía Main
│   │   │   │   ├── db.ts
│   │   │   │   ├── migrations/
│   │   │   │   └── repositories/
│   │   │   ├── files/                    # (MVP) kiểm tra path sách (app-owned / tham chiếu), copy URL·cloud, relink
│   │   │   │   └── sandbox.ts
│   │   │   └── adapters/                 # (MVP) document importers theo format
│   │   │       ├── epub.adapter.ts
│   │   │       ├── pdf.adapter.ts
│   │   │       ├── txt.adapter.ts
│   │   │       └── md.adapter.ts
│   │   ├── src/                          # Presentation — Renderer (React)
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── screens/                  # (MVP) map IA — chỉ màn hình “ở lâu”
│   │   │   │   ├── Library/
│   │   │   │   ├── Reader/                   # gồm panel Note / Comment / Bookmark scoped bookId
│   │   │   │   └── Settings/                 # SCR-06 App Settings
│   │   │   ├── components/               # UI thuần (chrome, progress, menus)
│   │   │   │   └── import/               # (MVP) ImportDialog / ImportSheet — không phải screen
│   │   │   │       ├── ImportMenu.tsx      # split button / Add menu
│   │   │   │       ├── UrlImportDialog.tsx # modal (desktop) / bottom sheet (mobile)
│   │   │   │       ├── ImportProgress.tsx
│   │   │   │       └── ImportConflictDialog.tsx
│   │   │   ├── features/                 # glue UI ↔ use cases (hooks mỏng)
│   │   │   ├── reader/                   # Reader shell + chọn renderer
│   │   │   │   ├── ReaderShell.tsx
│   │   │   │   └── renderers/            # epub (MVP) | pdf | txt | md | docx | doc — mỗi renderer tự vẽ
│   │   │   │       │                     #   overlay mark qua API riêng (không có `overlays/` port tách biệt)
│   │   │   │       └── epub/             # openEpubjs.ts, cfi/, previews/, progress/, store/
│   │   │   ├── bridge/                   # typed wrappers gọi window.api (IPC)
│   │   │   ├── stores/                   # UI state (Zustand…) — không chứa SQL
│   │   │   ├── styles/                   # theme tokens CSS variables
│   │   │   └── assets/
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── electron-builder.json5
│   │   └── package.json
│   │
│   └── reading-book-mobile/              # sau desktop ổn — cùng domain
│       ├── src/
│       │   ├── app/                      # Expo Router screens
│       │   ├── components/
│       │   ├── features/                 # gọi shared use cases
│       │   ├── constants/
│       │   └── hooks/
│       ├── assets/
│       └── package.json
│
└── packages/
    ├── domain/                           # Domain models + ports (không I/O)
    │   ├── book.ts
    │   ├── author.ts                     # Author + BookAuthor
    │   ├── collection.ts                 # Collection + CollectionBook
    │   ├── location.ts                   # CFI | page-rect | text-offset | …
    │   ├── reading-session-state.ts
    │   ├── annotation/                   # highlight.ts, bookmark.ts, note.ts (INoteState) — xem §3
    │   ├── book-chunk.ts
    │   ├── preferences.ts
    │   ├── document-format.ts            # epub | pdf | txt | md | docx | doc
    │   ├── ports/                        # interface Ports (§2.6)
    │   │   ├── document-importer.ts
    │   │   ├── document-renderer.ts
    │   │   ├── overlay-store.ts          # bookmarks/highlights CRUD — vẽ lại thuộc DocumentRenderer, không phải port riêng
    │   │   ├── location-codec.ts
    │   │   ├── library-store.ts
    │   │   ├── collection-store.ts
    │   │   ├── ai-provider.ts            # (P2) NoOp ở MVP
    │   │   └── external-library-connector.ts  # (P3) NoOp ở MVP; thay SyncService account-based
    │   └── index.ts
    │
    ├── shared/                           # Domain helpers + Application (platform-agnostic)
    │   ├── models/                       # entity helpers, invariants BR-01/BR-02
    │   ├── services/                     # Application use cases
    │   │   ├── import-book.ts
    │   │   ├── open-reader.ts
    │   │   ├── save-reading-session-state.ts
    │   │   ├── create-collection.ts
    │   │   └── manage-collection-books.ts
    │   │   # Highlight/note/bookmark CRUD KHÔNG đi qua use case riêng ở đây — logic sống trong
    │   │   # apps/reading-book-desktop/src/screens/Reader/logic/hooks/{useReaderHighlights,useReaderBookmarks}.ts,
    │   │   # gọi thẳng `overlayApi` (bridge IPC) → `OverlayStore` (§2.6). `add-highlight.ts` /
    │   │   # `add-note.ts` / `list-annotations.ts` từng có ở đây đã bị xóa cùng đợt refactor 1.22.
    │   ├── repositories/                 # interface-facing helpers (không SQLite cụ thể)
    │   ├── readers/                      # registry format → codec / normalized kind
    │   ├── storage/                      # abstractions path/key (inject từ app)
    │   ├── constants/
    │   ├── utils/
    │   ├── hooks/                        # hooks thuần logic (không Electron API)
    │   └── index.ts
    │
    └── config/                           # theme tokens, feature flags, supported formats
        ├── theme.ts
        ├── formats.ts
        ├── features.ts                   # aiEnabled, externalLibrariesEnabled stubs
        └── index.ts
```



#### Ánh xạ folder → lớp


| Folder                                           | Lớp                                                        |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `apps/*/src/screens`, `components`, `reader`     | Presentation                                               |
| `apps/reading-book-desktop/src/bridge`, `stores` | Presentation boundary                                      |
| `packages/shared/services`                       | Application                                                |
| `packages/domain`                                | Domain models                                              |
| `packages/domain/ports`                          | Ports (contracts)                                          |
| `packages/shared/models`                         | Domain helpers / invariants (nếu cần)                      |
| `apps/reading-book-desktop/electron/**`          | Infrastructure (desktop)                                   |
| `apps/*/src/reader/renderers`                    | Infrastructure phía UI (engine + overlay mark của engine đó, không có port `overlays` tách biệt) |




#### Quy tắc đặt code

1. **Không** import `electron` / `better-sqlite3` từ `packages/shared` hoặc `packages/domain`.
2. **Không** viết SQL / `fs` trong `apps/*/src/screens`.
3. Format mới = thêm file dưới `electron/adapters` (nếu cần native) + `src/reader/renderers/<fmt>` (renderer tự lo overlay mark của mình) + đăng ký trong `shared/readers` + `config/formats`.
4. Mobile chỉ thay Infrastructure (Expo FS/SQLite); **không copy** use cases — dùng `packages/shared`.



#### Hiện trạng vs mục tiêu


| Đã có trên đĩa                                                                    | Còn cần tạo khi implement MVP                    |
| --------------------------------------------------------------------------------- | ------------------------------------------------ |
| `apps/reading-book-desktop` (scaffold Electron+Vite)                              | `src/screens`, `reader`, `bridge`, `electron/ipc |
| `apps/reading-book-mobile` (Expo scaffold)                                        | map screens theo IA khi tới phase mobile         |
| `packages/domain` (models OOP)                                                    | ports thật (`ports/`)                            |
| `packages/shared/{models,services,repositories,readers,storage,…}`                | use cases thật                                   |
| `packages/config`                                                                 | theme / formats / feature flags                  |


---

## 3. Data Model & ERD



### 3.1. Nguyên tắc mô hình dữ liệu

- File sách/tài liệu gốc **không** nằm trong DB — chỉ lưu `file_path` (và optional `normalized_path` nếu đã convert). Nội dung gốc Read-Only trên đĩa.
- Highlight / Note / Bookmark / ReadingSessionState / Preferences-theo-sách là **Overlay** trong SQLite. Highlight, underline, strikethrough, textbox (sticky-note) và bookmark **dùng chung một bảng vật lý `notes`** — mỗi loại là một dòng JSON (`note_json`), phân biệt bằng `type` + `group` (`'annotation'` | `'bookmark'`), không phải 3-4 bảng SQL riêng (migration `018`/`019`; xem §3.10). `COMMENT` (đáp án/chú thích theo trang) đã bị loại khỏi schema từ trước (migration `010`) và **không tồn tại**.
- `BOOK_CHUNK` phục vụ tìm kiếm nhanh + RAG (Phase 2); MVP có thể tạo chunk text cho FTS5, embedding để sau.
- Xóa `BOOK` → **cascade** xóa `BOOK_AUTHOR`, `COLLECTION_BOOK` (membership), `notes` (annotation + bookmark) cùng `note_tags`, ReadingSessionState, Chunk (SRS BR-06). Chữ ký số (`signer_name`/`signature_status`/`signed_at`) là cột trên chính `BOOK` nên không cần cascade riêng. `AUTHOR` / `COLLECTION` / `TAG` giữ lại nếu còn liên kết khác.



### 3.2. ERD

ERD — Reading Book App (Overlay + Chunk)

> Nguồn PlantUML: `[docs/diagram/sds-erd/sds-erd.puml](../diagram/sds-erd/sds-erd.puml)`



### 3.3. Giải thích vai trò các thực thể

Bảng đối chiếu khi implement: mỗi entity dùng để làm gì, gắn với hành vi / nỗi đau nào của người đọc.


| Thực thể           | Tác dụng thực tế trong ứng dụng                                                                                                                                                                                          | Giải quyết nỗi đau / hành vi nào?                                                                                                 | Ví dụ thực tế (User Story)                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BOOK`             | Lưu metadata cuốn sách/tài liệu; quản lý đường dẫn tới file sách (file gốc của user với import local, hoặc bản copy app-owned với URL / cloud); định danh bằng SHA-256 để tránh import trùng; gắn `file_format` và (nếu có) `normalized_path`; cờ `is_signed` khi có chữ ký số; `description` / `page_count` cho Library card. Tác giả qua quan hệ **n - n** với `AUTHOR`; thể loại lưu dạng mảng tên trong `genres_json` (không còn bảng riêng, 1.23). | Tránh thất lạc và trùng lặp sách — thư viện ngăn nắp, biết chính xác file nằm đâu để mở đọc; biết tài liệu đã ký hay chưa; xem nhanh mô tả / dung lượng / số trang / thể loại trên list. | Bạn import `De-men-phieu-luu-ky.epub`. Hệ thống tính SHA-256, lưu `file_path`, liên kết tác giả + thể loại (có thể nhiều), hiện title + author + genre lên Library. |
| `AUTHOR`           | Lưu hồ sơ tác giả dùng chung (`name`, `sort_name`). Một tác giả gắn được nhiều sách.                                                                                                                                     | Tìm / lọc theo tác giả; không nhân đôi chuỗi author trên từng sách; hỗ trợ sách nhiều đồng tác giả.                               | Import sách có 2 đồng tác giả → tạo/reuse 2 `AUTHOR`, gắn qua `BOOK_AUTHOR`. Sách khác cùng 1 tác giả tái sử dụng bản ghi author đó.                             |
| `BOOK_AUTHOR`      | Bảng liên kết **n - n** giữa `BOOK` và `AUTHOR`; có `sort_order` để hiển thị thứ tự tên trên bìa/Library.                                                                                                                | Cho phép 1 sách nhiều tác giả và 1 tác giả nhiều sách.                                                                            | Sách A: author X (order 0), Y (order 1). Sách B cũng gắn author X.                                                                                               |
| `READING_SESSION_STATE` | Lưu vị trí đọc cuối (`last_read_location`); lưu cấu hình đọc per-book (màu nền, màu chữ, font, landscape…). Lưu **nhúng** trong `books.reading_state_json` (1.23; trước đó là bảng 1 - 1 `reading_session_states`). Không hàm ý đã đọc hết hay đọc tuần tự. | “Mở xong đóng, mở lại đúng chỗ” — không mất đoạn đang đọc; không phải chỉnh lại theme chống mỏi mắt mỗi lần mở. | Bạn đọc tới Chương 3 (hoặc nhảy cóc sang đoạn khác), bật Sepia rồi tắt app. Hôm sau mở lại: nền Sepia + nhảy đúng vị trí lần trước. |
| `NOTE`             | Bảng **chung** cho mọi markup gắn vào nội dung sách: `highlight` / `underline` / `strikethrough` / `textbox` (sticky-note, không tô màu) và cả **`bookmark`** — một cột JSON `note_json` (kiểu `INoteState`, xem `packages/domain/models/annotation/note.ts`) gói `type`, vị trí nhảy (`locatorExtended.locator` cho EPUB/TXT/MD/DOCX hoặc `pdfAnnotation` cho PDF), payload vẽ lại (`locatorExtended.raw`), `textualValue`/`note`, `style` (màu, font…), `status`, `isChecked`, và `group` (`'annotation'` so với `'bookmark'`) để phân biệt 2 vai trò mà không cần 2 bảng. Optional gắn **`TAG`** qua `note_tags`. Freehand (vẽ tay) và stamp (icon) vẫn là giá trị `type` hợp lệ trong schema nhưng **chưa có UI tạo mới** — chờ một PDF renderer (chưa tồn tại) để anchor theo `pdfAnnotation`. | Ghi nhớ thông tin cốt lõi (highlight/note) và đánh dấu vị trí quay lại (bookmark) — xem lại nhanh và jump đúng chỗ, không sửa file gốc. | Bôi câu *“Đi một ngày đàng, học một sàng khôn”*, chọn màu Vàng, ghi *“Cần tra thêm”* → một dòng `notes` với `type: 'highlight'`, `group: 'annotation'`, hiện trong sidebar Note. Đang giữa chương, chọn Bookmark → một dòng `notes` khác với `type: 'bookmark'`, `group: 'bookmark'`. |
| `TAG`              | Thẻ user-defined (`name`, optional `color_hex`) gắn note (annotation) qua N–N.                                                                                                                                           | Phân loại / lọc highlight theo chủ đề (Phase 3 auto-tag opt-in).                                                                  | Gắn tag `#marketing` cho highlight về chiến lược nội dung.                                                                                                      |
| `BOOK_CHUNK`       | Chia nội dung extract thành đoạn (vd. ~1000–2000 từ) theo `chunk_index`; đầu vào FTS5, AI tóm tắt / RAG, và (khi cần) prefetch text theo đoạn.                                                                           | Hiệu năng & tìm trong sách — không phụ thuộc nạp cả file lớn một lần cho search/AI; lật/đọc mượt hơn khi kết hợp cache theo đoạn. | Sách dài: index chunk 0..n. User search hoặc AI chỉ lấy các chunk liên quan; khi đọc, có thể prefetch chunk kế tiếp thay vì load toàn bộ 1000 trang vào RAM.     |
| `COLLECTION`       | Bộ sưu tập do user tự tạo (`name`, optional `description`) — nhóm sách theo chủ đề / mục đích riêng, **không** phải shelf trạng thái (Reading / Completed). Quan hệ **n - n** với `BOOK` qua `COLLECTION_BOOK`.           | Người sưu tầm muốn gom sách thành tập riêng (vd. “Work reading”, “Weekend fiction”) thay vì chỉ lọc theo tiến độ / favorite.      | Tạo collection “Architecture deep dive”, thêm 5 sách → mở từ nav Collections → list sách trong tập.                                                             |
| `COLLECTION_BOOK`  | Bảng liên kết **n - n** giữa `COLLECTION` và `BOOK`; `sort_order` thứ tự trong tập; `added_at` khi gắn.                                                                                                                  | 1 sách thuộc nhiều collection; 1 collection nhiều sách; xóa sách chỉ gỡ membership, không xóa collection.                         | Sách A nằm trong “Work reading” và “Architecture deep dive” đồng thời.                                                                                          |




### 3.4. Quan hệ & cardinality


| Quan hệ                     | Cardinality | Ghi chú                                                                                     |
| --------------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| `BOOK` ↔ `AUTHOR`           | **n - n**   | Qua bảng liên kết `BOOK_AUTHOR` (`sort_order`). 1 sách nhiều tác giả; 1 tác giả nhiều sách. |
| `BOOK` → `BOOK_AUTHOR`      | **1 - n**   | Cascade khi xóa sách.                                                                       |
| `AUTHOR` → `BOOK_AUTHOR`    | **1 - n**   | Xóa author: RESTRICT nếu còn sách gắn (hoặc cascade unlink tùy policy).                     |
| `BOOK` → `READING_SESSION_STATE` | **1 - 1**   | Nhúng trong `books.reading_state_json`: mỗi sách một trạng thái resume + setting đọc gần nhất. Mặc định `{}` khi import; ghi khi mở / autosave. |
| `BOOK` → `NOTE`             | **1 - n**   | Overlay chung cho highlight/underline/strikethrough/textbox **và** bookmark (`note_json.group` phân biệt); cascade khi xóa sách. |
| `BOOK` → `BOOK_CHUNK`       | **1 - n**   | Chunk text cho FTS / AI; rebuild khi re-index.                                              |
| `NOTE` ↔ `TAG`              | **n - n**   | Qua `note_tags`; cascade khi xóa note hoặc tag; chỉ áp dụng cho `group = 'annotation'` trong thực tế UI hiện tại. |
| `BOOK` ↔ `COLLECTION`       | **n - n**   | Qua `COLLECTION_BOOK` (`sort_order`, `added_at`). User-curated; khác shelf trạng thái.      |
| `COLLECTION` → `COLLECTION_BOOK` | **1 - n** | Cascade khi xóa collection (không xóa sách).                                           |
| `BOOK` → `COLLECTION_BOOK`  | **1 - n**   | Cascade khi xóa sách (chỉ gỡ membership).                                                   |




### 3.5. Ghi chú field quan trọng

`file_format` — enum: `epub` | `pdf` | `txt` | `md` | `docx` | `doc`.

`last_read_location` **/** `location_`* — chuỗi ổn định theo format (không lưu tọa độ pixel tạm):


| Format         | Ví dụ location                                               |
| -------------- | ------------------------------------------------------------ |
| EPUB           | CFI                                                          |
| PDF            | JSON `{ "page": 12, "rect": [...] }` hoặc offset trong trang |
| TXT / Markdown | `{ "offset": 1200 }` hoặc `{ "blockId", "offset" }`          |


`sha256` — tính trên file gốc (local) hoặc file tạm vừa tải (URL / cloud) **trước khi** lưu bất cứ thứ gì: nếu hash đã tồn tại → báo trùng / mở sách cũ (không nhân bản vô ích), bất kể path. Cũng là chứng cứ nhận diện khi **Locate file**: file mới chỉ được gắn lại khi SHA-256 khớp. (SHA-256 nhận diện / xác minh nội dung; **không** phải bản sao lưu.)

`file_path` — path tuyệt đối của file mà Reader mở. **Quyền sở hữu phụ thuộc nguồn import:** local → file gốc của user (*referenced*); URL / cloud → bản copy trong `{userData}/books/{uuid}/` (*managed*). Không được giả định `file_path` luôn nằm trong sandbox; `bookFileStorage(file_path)` phân loại. Đổi `file_path` (Locate file) **không** đổi `books.id`.

`percent` (trên `READING_SESSION_STATE`, optional) — ước lượng vị trí trên **bản đồ tài liệu** để đặt scrubber (0–100 map position). **Không** hiển thị như “% đã đọc / hoàn thành”; UI Library dùng nhãn `last_read_location` (chương/trang), Completed là trạng thái user đánh dấu.

`source_url` — optional `TEXT` trên `books`: URL gốc nếu import từ mạng; null nếu từ file máy. Chỉ tham chiếu; không bắt buộc re-fetch khi mở Reader.

`normalized_path` — dùng khi DOC/DOCX (hoặc format khác) cần extract/convert nhẹ để đọc; format đọc trực tiếp thường null.

`isSigned` — cờ boolean trong `books.metadata_json`: “có chữ ký số”. Chi tiết chữ ký (`signerName`, `signatureStatus`, `signedAt`) nằm **trong cùng `metadata_json`** — một sách chỉ giữ 1 chữ ký gần nhất (bảng con `book_signatures` gộp vào `books` từ migration `018`, rồi vào JSON từ `020`; không hỗ trợ nhiều signer/sách).

`signature_status` — trên `books`: `valid` \| `invalid` \| `expired` \| `unknown`.

`note_json` (trên `notes`) — JSON `INoteState`: `type`, `group` (`'annotation'` | `'bookmark'`), `locatorExtended.locator` (vị trí nhảy tới — EPUB/TXT/MD/DOCX) hoặc `pdfAnnotation` (PDF: `pageIndex` + `rects`), `locatorExtended.raw` (payload vẽ lại chính xác — thay cho `location_data` cột rời của các bản schema `011`–`017`), `style`, `textualValue`, `note`, `status`, `isChecked`. Không còn cột `page_number` riêng — trang chỉ còn ý nghĩa hiển thị, suy ra từ `chapterIndex` trong locator khi cần.

`BOOK_CHUNK.embedding` — Phase 2; MVP có thể chỉ lưu `content` + FTS5 virtual table trên `content` / `selected_text` / `notes.note_json`.

### 3.6. Thực thể không nằm trên ERD (nhưng liên quan)


| Thành phần                         | Lý do                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| File `.epub` / `.pdf` / … trên đĩa | Binary ngoài DB; DB chỉ trỏ path                                                  |
| FTS5 virtual tables                | Chỉ mục SQLite (vd. `books_fts`, `notes_fts`) — không phải entity nghiệp vụ |
| App preferences (key-value)        | Theme app, language, fullscreen, multi-doc, watch-folder flags — model `AppPreferences` (`preferences.ts`); **không** lưu trong SQLite overlay. Desktop: `electron-store` (JSON); Mobile: MMKV hoặc AsyncStorage. SCR-06 UI gọi adapter từng platform. |
| Watched folders                    | Danh sách path thư mục theo dõi (File scan — SCR-06); lưu local; Main process watch FS |
| `AiProvider` / linked libraries    | Phase 2–3; bổ sung bảng `AI_SESSION`, `EXTERNAL_LIBRARY_LINK` khi tới phase           |




### 3.7. Quyết định đã chốt (data)


| Chủ đề           | Quyết định                                                         |
| ---------------- | ------------------------------------------------------------------ |
| PK sách          | UUID (string)                                                      |
| Book ↔ Author    | **n - n** qua `BOOK_AUTHOR` / `book_authors` (+ `sort_order`)      |
| Book ↔ Genre     | Mảng tên trong `books.genres_json` (migration `020`; trước đó n - n qua `book_genres`, `007`) |
| Resume / session | Nhúng trong `books.reading_state_json` (`READING_SESSION_STATE`, migration `020`); gộp cả setting đọc per-book (font, layout, landscape) |
| Favorite         | Cột `BOOK.is_favorite`                                             |
| Library blurb    | `description` + `pageCount` + `fileSizeBytes` trong `books.metadata_json` (card G1-N7) |
| App preferences  | **Không** SQLite `app_settings` — platform store (1.17)            |
| Digital signature | `isSigned` / `signerName` / `signatureStatus` / `signedAt` trong `books.metadata_json` (từ `book_signatures` → cột `books` ở `018` → JSON ở `020`) |
| Bookmark         | Không còn bảng riêng — 1 dòng `NOTE` / `notes` với `note_json.group = 'bookmark'` (migration `019`) |
| Annotations      | Bảng chung `NOTE` / `notes` cho highlight, underline, strikethrough, textbox (kèm tags qua `note_tags`); `annotations` (011–017) và `bookmarks` (đứng riêng) đều đã bị gộp vào `notes` (018–019). Typewriter/shape (freehand) không còn tạo mới qua UI. |
| Chunk            | Có trong schema sớm; embedding nullable đến Phase 2                |
| Cascade xóa sách | book_authors + collection_books + notes (annotation + bookmark) + note_tags + Chunk (genres và reading state nằm trong chính dòng `books` nên đi theo) |
| Collections      | `COLLECTION` + `COLLECTION_BOOK` (n–n); xóa collection cascade membership, **không** xóa sách |
| Nguồn import     | File máy **và** URL direct file; optional cột `books.source_url`   |




### 3.8. Class Diagram

Class Diagram — Domain + Application (MVP)

> Nguồn PlantUML: `[docs/diagram/sds-class/sds-class.puml](../diagram/sds-class/sds-class.puml)`

**Ghi chú đọc diagram**

- Domain entities map với ERD; `Location` là value object đa hình theo format (CFI / page-rect / text-offset).
- `Book` ↔ `Author` là **n - n** (association class `BookAuthor` kèm `sortOrder`).
- `Book` ↔ `Collection` là **n - n** (association class `CollectionBook` kèm `sortOrder` / `addedAt`).
- Application services điều phối use case; chỉ phụ thuộc **Ports** (`LibraryStore`, `CollectionStore`, `OverlayStore`, …), không phụ thuộc SQLite/Electron.
- Cardinality khác: `Book` **1 - 1** `ReadingSessionState`; **1 - n** `Note` (bao gồm cả annotation lẫn bookmark) / `BookChunk`; `Note` **n - n** `Tag` (optional qua `note_tags`). Không còn `Comment` hay `BookSignature` như entity riêng — chữ ký số là cột trên `Book`.



### 3.9. Database Diagram

Database Diagram — SQLite Overlay Schema (MVP)

> Nguồn PlantUML: `[docs/diagram/sds-database/sds-database.puml](../diagram/sds-database/sds-database.puml)`

**Ghi chú schema vật lý**

- Tên bảng snake_case (`books`, `authors`, `book_authors`, …); datetime lưu `TEXT` ISO-8601; boolean lưu `INTEGER` 0/1.
- **Author không nằm trên** `books` — quan hệ **n - n** qua `book_authors` (PK `book_id` + `author_id`, `sort_order`).
- File sách **không** trong DB — chỉ `file_path` / `normalized_path`.
- Xóa `books` → **CASCADE** `book_authors`, `collection_books`, `notes`, `book_chunks`; xóa `notes` row → cascade `note_tags`. Genres, phiên đọc và chữ ký số là cột JSON trên `books` nên không có bảng con để cascade riêng.
- Xóa `collections` → **CASCADE** `collection_books` (sách vẫn còn trong Library).
- `sha256` **UNIQUE**; `book_chunks` **UNIQUE(book_id, chunk_index)**; FTS5 là virtual table riêng (không vẽ như entity nghiệp vụ).

### 3.10. Catalog bảng & thuộc tính (SQLite)

Catalog vật lý khớp migration desktop [`001_initial.sql`](../../source/apps/reading-book-desktop/electron/persistence/migrations/001_initial.sql) qua [`019_bookmarks_notes_merge.sql`](../../source/apps/reading-book-desktop/electron/persistence/migrations/019_bookmarks_notes_merge.sql) (mới nhất). **Mobile dùng cùng schema overlay** (adapter Expo SQLite riêng; không dùng `better-sqlite3`). **App settings không nằm trong catalog này** — xem §3.6.

**Quy ước chung**

| Quy ước | Giá trị |
| :--- | :--- |
| Tên bảng / cột | `snake_case` |
| PK sách / author / overlay | `TEXT` UUID |
| Datetime | `TEXT` ISO-8601 |
| Boolean | `INTEGER` `0` / `1` |
| Nội dung file sách | **Không** trong DB — chỉ `file_path` (file gốc của user, hoặc bản sandbox với URL/cloud) |

#### `books` — metadata tài liệu trong thư viện

| Cột | Kiểu | Ràng buộc | Mô tả |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PK, NOT NULL | UUID sách |
| `title` | TEXT | NOT NULL | Tiêu đề hiển thị |
| `file_path` | TEXT | NOT NULL | Path tuyệt đối file sách. **Tham chiếu:** file gốc của user (app không ghi/di chuyển/xoá, kể cả thư mục cha). **Managed:** bản copy `{userData}/books/{uuid}/` (URL/cloud, và sách import trước v1.24). Loại được suy ra từ path, không có cột riêng |
| `normalized_path` | TEXT | NULL | Path bản extract/convert (DOC/DOCX…); thường null với EPUB/PDF |
| `file_format` | TEXT | NOT NULL, CHECK | `epub` \| `pdf` \| `txt` \| `md` \| `docx` \| `doc` |
| `cover_path` | TEXT | NULL | Path cover đã extract (nếu có) — `{userData}/covers/` (sách cũ: cạnh file trong sandbox) |
| `sha256` | TEXT | NOT NULL, **UNIQUE** | Hash nội dung — dedup import (**BR-03**) |
| `is_favorite` | INTEGER | NOT NULL, DEFAULT `0` | Favorite (0/1) |
| `reading_status` | TEXT | NOT NULL, DEFAULT `'not-started'`, CHECK | `reading` \| `completed` \| `not-started` (user-marked, không suy từ %) |
| `source_provider` / `external_id` | TEXT | NULL | Cloud provenance (Google Drive / Dropbox / OneDrive) khi sách đến từ liên kết cloud (migration `014`) |
| `source_url` | TEXT | NULL | URL gốc nếu import từ mạng; null nếu từ máy |
| `metadata_json` | TEXT | NOT NULL, DEFAULT `'{}'`, CHECK `json_valid` | `{ fileSizeBytes, pageCount, description, isSigned, signerName, signatureStatus, signedAt }` — `description`: mô tả ngắn / OPF (Library card · G1-N7); `pageCount`: số trang (PDF) hoặc số spine/section (EPUB); `signatureStatus` ∈ `valid` \| `invalid` \| `expired` \| `unknown`. Key `null` ≡ vắng |
| `genres_json` | TEXT | NOT NULL, DEFAULT `'[]'`, CHECK `json_valid` | Mảng tên thể loại / subject (vd. `["Adventure","Fiction"]`), sắp A→Z, không trùng (không phân biệt hoa/thường) |
| `reading_state_json` | TEXT | NOT NULL, DEFAULT `'{}'`, CHECK `json_valid` | Resume + setting đọc per-book — xem bên dưới |
| `added_at` | TEXT | NOT NULL | Thời điểm import |
| `updated_at` | TEXT | NOT NULL | Lần cập nhật metadata gần nhất |

**Index:** `UNIQUE(sha256)` (`idx_books_sha256`); `INDEX(is_favorite)` (`idx_books_favorite`); `INDEX(reading_status)` (`idx_books_reading_status`); `INDEX(source_provider, external_id)` (`idx_books_source`); `INDEX(updated_at)` (`idx_books_updated_at`).

> Một sách chỉ giữ **1** chữ ký (gần nhất) — khác bản SDS trước `1.22`, vốn cho phép nhiều dòng `book_signatures` per sách qua bảng con riêng.

> **Quy ước JSON (migration `020`):** key camelCase; `null` ≡ vắng. Ghi từng phần bằng `json_patch(cột, patch)` (RFC 7396: key có trong patch ghi đè, `null` xóa key, key vắng giữ nguyên) nên cập nhật một key không làm mất key khác (vd. `signerName` khi sửa `description`). Thể loại **không** còn bảng `genres` / `book_genres`; đổi tên thể loại là sửa mảng của từng sách.

#### `authors` — hồ sơ tác giả dùng chung

| Cột | Kiểu | Ràng buộc | Mô tả |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PK, NOT NULL | UUID author |
| `name` | TEXT | NOT NULL | Tên hiển thị |
| `sort_name` | TEXT | NULL | Tên để sắp xếp (tùy chọn) |
| `created_at` | TEXT | NOT NULL | Thời điểm tạo hồ sơ |

#### `book_authors` — liên kết n–n sách ↔ tác giả

| Cột | Kiểu | Ràng buộc | Mô tả |
| :--- | :--- | :--- | :--- |
| `book_id` | TEXT | PK, FK → `books.id` **ON DELETE CASCADE** | Sách |
| `author_id` | TEXT | PK, FK → `authors.id` **ON DELETE RESTRICT** | Tác giả |
| `sort_order` | INTEGER | NOT NULL, DEFAULT `0` | Thứ tự tên trên bìa / Library (thấp trước) |

**Index:** `INDEX(author_id)`. PK composite `(book_id, author_id)`.

#### `collections` — bộ sưu tập user-curated (FR-14)

| Cột | Kiểu | Ràng buộc | Mô tả |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PK, NOT NULL | UUID collection |
| `name` | TEXT | NOT NULL | Tên tập (MVP cho phép trùng tên) |
| `description` | TEXT | NULL | Mô tả tùy chọn |
| `created_at` | TEXT | NOT NULL | Thời điểm tạo |
| `updated_at` | TEXT | NOT NULL | Lần đổi gần nhất |

**Index:** `INDEX(updated_at)`.

#### `collection_books` — liên kết n–n collection ↔ sách

| Cột | Kiểu | Ràng buộc | Mô tả |
| :--- | :--- | :--- | :--- |
| `collection_id` | TEXT | PK, FK → `collections.id` **ON DELETE CASCADE** | Tập |
| `book_id` | TEXT | PK, FK → `books.id` **ON DELETE CASCADE** | Sách (xóa sách chỉ gỡ membership) |
| `sort_order` | INTEGER | NOT NULL, DEFAULT `0` | Thứ tự trong tập |
| `added_at` | TEXT | NOT NULL | Khi gắn sách vào tập |

**Index:** `INDEX(book_id)`. PK composite `(collection_id, book_id)`.

#### `books.reading_state_json` — resume + setting đọc per-book

Trước migration `020` là bảng 1–1 `reading_session_states`; nay là cột JSON của `books` (mặc định `{}` = chưa đọc / chưa có setting riêng).

| Key | Kiểu | Mô tả |
| :--- | :--- | :--- |
| `lastReadLocation` | string | Vị trí ổn định theo format (CFI / page-rect / offset), đóng gói kèm label hiển thị; hoặc placeholder legacy `Started` |
| `percent` | number | Map vị trí scrubber (0–100); **không** dùng làm “% đã đọc xong” trên UI (FR-10) |
| `fontFamily` / `fontSize` / `fontWeight` / `lineHeight` / `textAlign` | string \| number | Typography per-book |
| `layoutMode` | string | Bố cục single / dual |
| `pageTurnMode` | string | Scroll / paginated |
| `marginsEnabled` / `marginPreset` | boolean / string | Bật lề; hẹp / vừa / rộng |
| `isLandscape` | boolean | Landscape |
| `updatedAt` | string (ISO-8601) | Lần autosave gần nhất — đồng thời là mốc **chống ghi cũ đè mới** (`books.updated_at` không dùng được vì sửa metadata cũng làm nó tăng) |

Theme Night / Sepia / Paper là preference toàn app ở localStorage và áp dụng bằng CSS preset; không lưu `bg_color`, `text_color` hoặc `theme_preset` ở đây.

#### `notes` — bảng chung cho highlight / underline / strikethrough / textbox **và** bookmark

Thay cho `highlights` (009) → `annotations` (011–017) → tách riêng `bookmarks`: từ migration `018` (gộp `annotations`) và `019` (gộp thêm `bookmarks`), **mọi markup và bookmark của một sách là 1 dòng trong `notes`**, theo model Readium/Thorium Reader — payload linh hoạt nằm trong một cột JSON thay vì một cột SQL cứng cho từng thuộc tính.

| Cột | Kiểu | Ràng buộc | Mô tả |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PK, NOT NULL | UUID note/bookmark |
| `book_id` | TEXT | NOT NULL, FK → `books.id` **ON DELETE CASCADE** | Sách sở hữu |
| `note_json` | TEXT | NOT NULL, DEFAULT `'{}'`, CHECK `json_valid` | Payload `INoteState` — xem cấu trúc bên dưới |
| `created_at` | TEXT | NOT NULL | Thời điểm tạo |
| `updated_at` | TEXT | NOT NULL | Lần sửa gần nhất |

**Index:** `INDEX(book_id)`; `INDEX(updated_at)`; expression index trên `json_extract(note_json, '$.group')` (lọc annotation/bookmark không full-scan).

**Cấu trúc `note_json` (`INoteState`, `packages/domain/models/annotation/note.ts`):**

| Field | Mô tả |
| :--- | :--- |
| `type` | `highlight` \| `underline` \| `strikethrough` \| `textbox` \| `bookmark` (còn `freehand` \| `stamp` là giá trị lịch sử, chưa có UI tạo mới) |
| `group` | `'annotation'` (markup) hoặc `'bookmark'`; thiếu field này (dòng cũ trước `019`) → coi là `'annotation'` |
| `locatorExtended.locator` | Vị trí **nhảy tới** (JSON `Location` + `chapterIndex`) — dùng cho EPUB/TXT/MD/DOCX; tương đương `location_ref` cột rời ở schema `017` |
| `locatorExtended.raw` | Payload **vẽ lại chính xác** markup (packed CFI `start\|end`, hoặc JSON hình học) — tương đương `location_data` cột rời cũ; không dùng để jump |
| `pdfAnnotation` | `{ pageIndex, rects[], contents? }` — anchor riêng cho PDF, thay `locatorExtended` khi sách là PDF (PDF renderer/annotation UI chưa triển khai) |
| `textualValue` | Text hiển thị (đoạn được highlight, hoặc excerpt tại vị trí bookmark) |
| `note` | Ghi chú tự do người dùng gõ thêm (khác `style.note` nếu có) |
| `style` | `colorHex`, `fontFamily`, `fontSize`, `strokeWidth`, `opacity`… — mở, tùy `type` |
| `label` | Chỉ dùng khi `group = 'bookmark'` — tên hiển thị do người dùng đặt |
| `status` / `isChecked` | `None` \| `Review` \| `Done`; cờ hoàn thành nhanh — chỉ có ý nghĩa với `group = 'annotation'` |
| `tags` | Danh sách tag (song song với bảng `note_tags` bên dưới) |

#### `tags` — thẻ gắn note (optional, G5+)

| Cột | Kiểu | Ràng buộc | Mô tả |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PK, NOT NULL | UUID tag |
| `name` | TEXT | NOT NULL, UNIQUE | Tên thẻ (vd. `#marketing`) |
| `color_hex` | TEXT | NULL | Màu hiển thị UI |

#### `note_tags` — N–N note ↔ tag

| Cột | Kiểu | Ràng buộc | Mô tả |
| :--- | :--- | :--- | :--- |
| `note_id` | TEXT | NOT NULL, FK → `notes.id` **ON DELETE CASCADE** | Note (thực tế chỉ dùng cho `group = 'annotation'`) |
| `tag_id` | TEXT | NOT NULL, FK → `tags.id` **ON DELETE CASCADE** | Tag |

**Index:** PK composite `(note_id, tag_id)`.

> **Đã loại bỏ khỏi schema hiện tại:** `highlights` / `highlight_tags` (thay bằng `notes`/`note_tags`), `bookmarks` đứng riêng, `annotations`/`annotation_tags`, `book_signatures` (gộp vào `books`, sau đó vào `books.metadata_json`), `reading_session_states` / `genres` / `book_genres` (gộp vào `books.reading_state_json` / `genres_json`, migration `020`), và `comments` (bị xóa từ migration `010`, thay bằng `typewriter_notes` rồi cũng bị gộp/xóa — tính năng Comment không còn tồn tại trong app).

#### `book_chunks` — đoạn text extract (FTS / Phase 2 AI)

| Cột | Kiểu | Ràng buộc | Mô tả |
| :--- | :--- | :--- | :--- |
| `id` | TEXT | PK, NOT NULL | UUID chunk |
| `book_id` | TEXT | NOT NULL, FK → `books.id` **ON DELETE CASCADE** | Sách nguồn |
| `chunk_index` | INTEGER | NOT NULL | Thứ tự chunk trong sách |
| `content` | TEXT | NOT NULL | Text extract của đoạn |
| `location_start` | TEXT | NULL | Vị trí đầu đoạn (nếu map được) |
| `location_end` | TEXT | NULL | Vị trí cuối đoạn |
| `embedding` | BLOB | NULL | Vector embedding — Phase 2; MVP để null |
| `created_at` | TEXT | NOT NULL | Thời điểm index |

**Index:** `UNIQUE(book_id, chunk_index)`.

> **Không có `app_settings` trong SQLite.** Cấu hình app (SCR-06) lưu theo platform — desktop `electron-store`, mobile MMKV/AsyncStorage — để tránh nhân đôi store và lệch API giữa Electron / Expo.

---

## 4. Screen Design

Phần này mô tả thiết kế màn hình (IA + mockup) cho desktop MVP. Mockup HTML nằm trong `[docs/mockups/](../mockups/)`. Nguyên tắc UI bám [Reading App Design System](../reading-habbit/Reading_App_Design_System.md): content-first, Invisible UI, visual comfort — **trừ** màn Splash (branding / boot, chưa vào nội dung đọc).

**Ngôn ngữ UI sản phẩm:** English (copy trên mockup và màn hình production dùng tiếng Anh). Tài liệu SDS vẫn mô tả bằng tiếng Việt.

### 4.1. Bản đồ màn hình (MVP)

Chỉ liệt kê **màn hình** (destination user “ở lại”). Hành động ngắn (Import) là **overlay** — xem §4.5.


| ID         | Màn hình           | Mục đích duy nhất                                      | Mockup                                      | SRS / WF        |
| ---------- | ------------------ | ------------------------------------------------------ | ------------------------------------------- | --------------- |
| **SCR-00** | Splash             | Brand + chờ khởi tạo app                               | `[splash.html](../mockups/splash.html)`     | —               |
| **SCR-01** | Library            | Duyệt file đã import / tiếp tục đọc / mở Add           | `[library.html](../mockups/library.html)`   | FR-08, WF-01    |
| **SCR-01a**| Shelf detail       | List dọc một nhóm (Reading / Completed / Not started)  | Cùng `library.html` (view thứ hai)          | FR-08           |
| **SCR-03** | Reader             | Đọc + highlight / note / bookmark (Invisible UI); ôn dấu ấn **theo document** | `[reading.html](../mockups/reading.html)` | FR-02–07, FR-09, FR-11, WF-03, WF-04 |
| **SCR-05** | Reading Settings   | Theme, typography, page mode, margins (panel từ Reader)| Cùng `reading.html` (Settings panel)        | FR-04           |
| **SCR-06** | App Settings       | Cài đặt toàn app: linked libraries, theme app, file scan, multi-doc, language, fullscreen | `[setting.html](../mockups/setting.html)` | NFR-06, NFR-11, FR-04 (app default); FR-30 stub |

> **Không có SCR-04:** Highlights & Notes không phải màn toàn cục. Annotation/bookmark gắn `bookId` — xem / jump trong **SCR-03** sidebar (Note · Bookmark). Không còn tab **Comment** (tính năng đã bị loại khỏi schema từ migration `010`).


#### Overlay / transient UI (không phải màn hình)


| ID          | UI                    | Pattern                                              | Mockup                                    | SRS / WF           |
| ----------- | --------------------- | ---------------------------------------------------- | ----------------------------------------- | ------------------ |
| **UX-IMP**  | Import                | Desktop: **modal dialog** · Mobile: **bottom sheet** | `[import.html](../mockups/import.html)`   | FR-01, FR-13, WF-02 |


**Vì sao Import không phải screen:** đây chỉ là hành động bổ trợ (thêm file vào library) — tương tác ngắn, không cần route/history riêng, không phải nơi user “làm việc lâu”. Sau xong → đóng overlay, ở lại Library.

Luồng mặc định khi mở app:

```text
SCR-00 Splash  →  (ready)  →  SCR-01 Library
                                 ├─ Continue Reading / tap book → SCR-03 Reader
                                 ├─ › on shelf                 → SCR-01a → SCR-03
                                 ├─ Add (device | URL)         → UX-IMP overlay (trên Library)
                                 │                                 └─ success → đóng overlay + toast + refresh Library
                                 ├─ Favorites (nav)            → Starred books list
                                 ├─ Completed (nav)            → status = completed (user-marked)
                                 ├─ To read (nav)              → status = not-started (chưa từng mở / chưa có last_read)
                                 ├─ Collections (nav)          → Collections hub
                                 └─ Settings (nav)             → SCR-06 App Settings
                                                                      └─ Back to library → SCR-01
```

**Ghi chú IA**

- Không có **bookstore / DRM catalog** — Library chỉ chứa file user đã đưa vào (từ máy hoặc URL tải về local).
- **Import (UX-IMP)** = split button / menu trên Library → OS file picker **hoặc** modal/sheet nhập URL. Không navigate sang màn Import riêng. Không wizard dài. Không store.
- **Không có màn Highlights & Notes toàn cục (SCR-04 đã gỡ):** highlight / note / comment / bookmark thuộc **từng document** — ôn lại & jump trong **SCR-03** (sidebar Note · Comment · Bookmark). FR-09 / WF-04 thực hiện tại đây.
- **Reading Settings (SCR-05)** mở từ Reader chrome — panel trong `reading.html`, lưu **per-book** trong `READING_SESSION_STATE` (§3). Chỉ chỉnh trải nghiệm đọc (font, size, margins…).
- **App Settings (SCR-06)** mở từ Library sidebar **Settings** — màn full-page `setting.html`, lưu **app-level** (theme shell, language, file scan, multi-doc, fullscreen, linked libraries stub). Không thay SCR-05. **Không** có Sign in / Log out identity.
- **Reader mockup:** `[reading.html](../mockups/reading.html)` — Tools / Settings / More, sidebar TOC (Chapters · Bookmark · Note · Comment), Invisible UI.
- Mobile: cùng IA; Library dùng bottom nav thay sidebar; Import dùng **bottom sheet**; Reader Settings dùng **bottom sheet**; App Settings có thể full-page hoặc nested list trong More.



### 4.2. SCR-00 — Splash

**Mockup:** `[docs/mockups/splash.html](../mockups/splash.html)`

#### Mục đích

Màn **Splash** là màn hình khởi động ngắn khi mở app (Electron window). Nó **không** phải màn đọc và **không** chứa nội dung sách. Vai trò:

1. **Nhận diện thương hiệu** — hiện tên sản phẩm **Readmate** và định vị **Reader** ngay frame đầu.
2. **Che latency boot** — trong lúc Main/Renderer khởi tạo (mở SQLite, migrate schema, kiểm tra sandbox file, hydrate library tối thiểu), user thấy trạng thái “đang tải” thay vì cửa sổ trống hoặc nháy UI.
3. **Chuyển mượt sang Library** — khi app ready, đóng/ẩn Splash và hiện **SCR-01 Library** (Continue Reading nếu có).

Splash **không** dùng để: onboarding dài, quảng cáo, xin đánh giá, chọn persona, hay gọi AI.

#### Khi nào hiện / ẩn


| Sự kiện                              | Hành vi                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| User mở app / cold start             | Hiện Splash ngay (có thể là BrowserWindow riêng hoặc overlay full-bleed trên cửa sổ chính).              |
| Init xong (DB + IPC bridge sẵn sàng) | Ẩn Splash → điều hướng **SCR-01 Library**.                                                               |
| Init lỗi nghiêm trọng                | Vẫn thoát Splash; hiện trạng thái lỗi tối giản trên Library / dialog — **không** kẹt vô hạn trên Splash. |
| Hot reload / mở lại khi app đã chạy  | Không bắt buộc hiện lại Splash (tùy platform); ưu tiên vào thẳng Library.                                |


**Thời gian:** đủ dài để thấy brand (~0.8–1.5s animation), nhưng **không cố ý kéo** quá thời gian boot thật. Nếu boot nhanh hơn animation tối thiểu, vẫn chờ hết fade-in nhẹ rồi mới chuyển — tránh “nháy”. Nếu boot chậm, spinner tiếp tục cho đến khi ready (có thể thêm timeout + thông báo lỗi).

#### Cấu trúc giao diện (theo mockup)


| Vùng     | Nội dung                                      | Ghi chú thiết kế                                                                                            |
| -------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Nền      | Radial gradient tối (`#1e293b` → `#0f172a`)   | Full viewport; tập trung mắt vào giữa; khác theme đọc cream/sepia (Splash = brand shell, chưa phải reader). |
| Icon     | SVG sách mở, stroke amber `#f59e0b`           | Animation “vẽ” path + pulse glow nhẹ; không neon chói, không popup.                                         |
| Title    | **READMATE** (letter-spacing rộng, uppercase) | Brand hero-level — tín hiệu nhận diện chính của viewport.                                                   |
| Subtitle | **READER**                                    | Một dòng hỗ trợ định vị sản phẩm; không thêm tagline dài / stats.                                           |
| Spinner  | Vòng mỏng đáy màn, accent amber               | Báo “đang tải”; không text “Loading…” ồn ào (title cửa sổ có thể là `Loading...`).                          |


Desktop: vùng Splash cho phép **drag cửa sổ** (`-webkit-app-region: drag`) vì đây là cửa sổ không chrome / chrome tối giản lúc boot.

#### Nguyên tắc UX

- **Một việc:** chỉ brand + chờ sẵn sàng — không nút, không form, không menu.
- **Motion có chủ đích:** draw icon → fade title → fade subtitle → spinner; tối đa 2–3 chuyển động, chậm vừa phải (không flash).
- **Không chặn user vô ích:** không bắt tap để “bỏ qua” trừ khi sau này có debug; production tự chuyển khi ready.
- **Đồng bộ Design System don'ts:** không popup giữa splash; không animation gây xao nhãng; không card/stat strip.



#### Acceptance (Splash)


| #   | Tiêu chí                                                                            |
| --- | ----------------------------------------------------------------------------------- |
| 1   | Cold start luôn thấy Splash trước Library.                                          |
| 2   | Sau khi Main + DB ready, chuyển Library không cần thao tác user.                    |
| 3   | Brand “Readmate” + “Reader” đọc rõ trên nền tối.                                    |
| 4   | Không hiện nội dung sách / list library dưới Splash (tránh flash of unfinished UI). |
| 5   | Lỗi init không để spinner quay mãi không thông báo.                                 |




### 4.3. SCR-01 — Library

**Mockup:** `[docs/mockups/library.html](../mockups/library.html)`  
**SRS:** FR-08, FR-10, FR-12 · **WF:** WF-01 · **UC:** UC-01 (entry), UC-02 (mở sách)

#### Mục đích

Hub sau Splash: **duyệt file đã import** (từ máy hoặc URL đã tải về local), tiếp tục đọc, mở Reader, hoặc thêm file. Không phải cửa hàng / catalog bản quyền.

#### Khi nào hiện


| Sự kiện                         | Hành vi                                      |
| ------------------------------- | -------------------------------------------- |
| Splash ready                    | Vào Library (view chính).                    |
| Quay từ Reader / App Settings / đóng Import overlay | Trở lại Library (giữ scroll / shelf order nếu có). |
| Thư viện trống                  | Ẩn Continue Reading + shelves; CTA **Add file**. |


#### Cấu trúc giao diện (theo mockup)


| Vùng              | Nội dung                                                                 | Ghi chú thiết kế                                                                 |
| ----------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Sidebar (desktop) | **Library**, **Favorites**, **Completed**, **To read**, **Collections**, **Settings** | Completed = done; To read = not started. **Không** nav Notes toàn cục — note theo sách trong Reader. Mobile: More sheet. |
| Top bar           | Search (“Search imported files…”) + **Add file**                         | Search lọc title / author / filename / format.                                   |
| Hint              | “Your library on this device” + format chips (EPUB, PDF, TXT, MD, DOCX, DOC) | Nhấn mạnh local-import; 6 định dạng MVP; không gợi bookstore.              |
| Continue reading  | Cover + title + author + format + filename + **last-read location** + Resume / Notes (n) | Chỉ hiện nếu có `last_read` gần nhất. Hiện chỗ dừng (chương/trang) — **không** % / thanh fill. **Notes (n)** → SCR-03 tab Note. |
| Shelves (dọc)     | **Reading** → **Completed** → **Not started**                            | Mỗi shelf = rail sách **scroll ngang**; không dùng tab mini filter.              |
| Shelf header      | `=` (drag reorder) · title · `N files` · `›` (mở SCR-01a)                | `=` ≠ menu; `›` tap target lớn, căn hàng với title.                              |


#### Tương tác chính


| Hành động                         | Kết quả                                              |
| --------------------------------- | ---------------------------------------------------- |
| Resume / tap book card            | → **SCR-03** Reader tại `last_read_location`         |
| Add (device / URL)            | Mở **UX-IMP** trên Library (không đổi route)     |
| Kéo `=` trên shelf                | Đổi thứ tự shelf (desktop + mobile, Pointer Events)  |
| Tap `›`                           | → **SCR-01a** list dọc của shelf đó                  |
| Search                            | Ẩn shelf không còn card khớp; empty state nếu 0 kết quả |
| Favorites (nav)                   | List sách is_favorite — quay lại nhanh sách đã gắn sao |
| Completed (nav)                   | List sách user đánh dấu completed (không suy ra từ %) |
| To read (nav)                     | List sách chưa bắt đầu (chưa có `last_read`) |
| Collections (nav)                 | Hub `COLLECTION` do user tạo (FR-14); tạo / đổi tên / xóa tập; mở collection → list sách (`COLLECTION_BOOK`); gắn / gỡ sách khỏi tập |
| Notes (n) trên Continue Reading   | → **SCR-03** Reader của sách đó, mở sidebar tab **Note** |
| Settings (nav)                    | → **SCR-06** App Settings (`setting.html`)           |


#### Empty / edge


| Trường hợp        | UI                                              |
| ----------------- | ----------------------------------------------- |
| 0 sách            | Chỉ hint + CTA Add file lớn                     |
| Search không khớp | “No matching imported files found.”             |
| File trùng SHA    | Dialog conflict (trong UX-IMP); Library không nhân đôi card |


#### Acceptance (Library)


| #   | Tiêu chí                                                                 |
| --- | ------------------------------------------------------------------------ |
| 1   | Chỉ hiện file đã import local — không có UI mua / browse store.          |
| 2   | Có ≥ 1 sách gần đây → Continue Reading mở đúng sách + vị trí.            |
| 3   | Shelves phân loại theo trạng thái đọc; mỗi rail cuộn ngang độc lập.      |
| 4   | Kéo `=` sắp xếp lại shelf trên desktop và touch.                         |
| 5   | `›` mở list dọc (SCR-01a); Back quay Library.                            |
| 6   | Thư viện trống → CTA Add; Add mở UX-IMP (không navigate màn Import). |
| 7   | Import thành công → đóng overlay, toast, list Library cập nhật tại chỗ. |
| 8   | Nav Collections → hub tập user-curated; tạo tập / gắn sách / mở list trong tập (FR-14). |




### 4.4. SCR-01a — Shelf detail (vertical list)

**Mockup:** view thứ hai trong `[library.html](../mockups/library.html)` (`#shelfDetailView`)

#### Mục đích

Xem **toàn bộ file trong một nhóm** dạng list dọc (dễ scan trên mobile / khi shelf dài), rồi mở Reader.

#### Cấu trúc


| Vùng    | Nội dung                                                         |
| ------- | ---------------------------------------------------------------- |
| Top bar | `‹` Back · shelf title · `N files`                               |
| Body    | List dọc: cover nhỏ + title + author + filename + format + chip tiến độ + `›` |


#### Acceptance


| #   | Tiêu chí                                                          |
| --- | ----------------------------------------------------------------- |
| 1   | Nội dung list khớp đúng shelf nguồn (kể cả sau khi search lọc).  |
| 2   | Tap item → SCR-03; Back / Esc → SCR-01.                           |




### 4.5. UX-IMP — Import (modal / bottom sheet)

**Không phải màn hình (SCR).** Overlay gắn Library — hành động bổ trợ, tương tác ngắn.  
**Mockup:** `[docs/mockups/import.html](../mockups/import.html)`  
**SRS:** FR-01, FR-13 · **WF:** WF-02 · **UC:** UC-01 · **BR:** BR-01, BR-03  
**Code:** `components/import/*` — **không** đặt dưới `screens/Import`.

#### Mục đích & nguyên tắc IA

Thêm tài liệu vào thư viện local bằng:

1. **From device** — OS file picker (native; có thể không cần UI app ngoài menu Add).
2. **From URL** — dán link trực tiếp tới file; download về sandbox rồi cùng pipeline metadata / normalize / FTS.

**Quyết định UI**

| Nền tảng | Pattern | Lý do |
| -------- | ------- | ----- |
| Desktop  | **Modal dialog** (+ menu split-button Add) | Che nhẹ Library phía dưới; hủy = đóng; không chiếm history/stack. |
| Mobile   | **Bottom sheet** | Ngón cái dễ tới; không full-screen “màn Import”. |

Không dùng: route `/import`, wizard nhiều bước, form metadata bắt buộc, hay màn hình đứng riêng trong nav.

Sau khi xong: **đóng overlay** → user vẫn ở **SCR-01 Library** (toast + refresh list). Không “quay về” từ màn khác vì chưa rời Library.

#### Entry UI (trên Library)


| Control | Hành vi |
| ------- | ------- |
| **Add file** (primary) | Mở OS file picker (hoặc menu rồi chọn device). |
| **Import from URL** (menu phụ / mũi tên split button) | Mở modal (desktop) hoặc bottom sheet (mobile) nhập URL. |


#### Flow A — From device


| Bước | Hành vi                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------ |
| 1    | User chọn **From this device**.                                                                  |
| 2    | Main mở native file picker; filter: `.epub`, `.pdf`, `.txt`, `.md`, `.docx`, `.doc`. |
| 3a   | User hủy → đóng; Library không đổi DB.                                                           |
| 3b   | File hợp lệ → hash + chặn trùng → metadata → lưu bản ghi với `file_path` = path gốc (**không copy**) → toast + refresh; chunk / FTS tạo nền khi mở sách. |
| 3c   | Extension / file hỏng → dialog lỗi ngắn (vẫn overlay), không tạo bản ghi rỗng.                   |
| 3d   | SHA-256 trùng (**BR-03**), kể cả file ở path khác → dialog conflict; đề xuất mở sách cũ; không nhân bản. |
| 3e   | Sau này file gốc bị User di chuyển / xóa → sách **vẫn ở Library** (không mất note / highlight / vị trí đọc); mở Reader báo không tìm thấy file + **Locate file…** (chỉ nhận file có SHA-256 khớp). |


#### Flow B — From URL


| Bước | Hành vi                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------ |
| 1    | User chọn **From link** → modal/sheet nhập URL.                                                        |
| 2    | Validate: scheme `https` (MVP bắt buộc; `http` chỉ khi xác nhận hoặc config dev).                      |
| 3    | Main `UrlDocumentFetcher` download (timeout, max size, redirect có giới hạn); hiện progress trên overlay. |
| 4    | Suy ra format từ `Content-Disposition` / `Content-Type` / path extension.                              |
| 5a   | Format không hỗ trợ / không phải file tài liệu → lỗi rõ; xóa temp.                                     |
| 5b   | Download lỗi (404, mạng, SSL, quá dung lượng) → lỗi rõ; không bản ghi rỗng.                            |
| 5c   | File OK → hash + chặn trùng → lưu bản copy app-owned → metadata → persist (khác Flow A: file được **copy** vào app data; `source_url` được giữ).                                                  |
| 5d   | SHA trùng → dialog conflict; không nhân bản.                                                           |
| 6    | Optional lưu `source_url` trên `BOOK`. Đóng overlay → toast → Library refresh.                         |


#### Ràng buộc bảo mật / kỹ thuật (URL)


| Ràng buộc     | Chi tiết                                                                  |
| ------------- | ------------------------------------------------------------------------- |
| Ai fetch?     | **Chỉ Main** (hoặc worker Main) — Renderer không tải + ghi disk tùy ý.   |
| Scheme        | Ưu tiên `https://`. Không `file://`.                                      |
| Loại URL      | **Direct file URL**. Không scrape HTML bookstore.                         |
| Size / timeout| Giới hạn cấu hình (chốt lúc implement; vd. timeout 60s).                  |
| Sau download  | File trong sandbox Read-Only; đọc offline.                                |


#### Trạng thái UI (trong overlay)


| Trạng thái        | UI                                                                      |
| ----------------- | ----------------------------------------------------------------------- |
| Idle (URL)        | Sheet/dialog: input URL + Cancel / Import                               |
| Đang import / tải | Progress “Importing…” / “Downloading…” trên dialog/sheet                |
| Thành công        | **Đóng** overlay + toast ngắn; sách mới trên Library                    |
| Lỗi / trùng       | Dialog/sheet 1–2 hành động (Dismiss / Open existing)                    |


#### Acceptance (Import overlay)


| #   | Tiêu chí                                                                 |
| --- | ------------------------------------------------------------------------ |
| 1   | Import **không** xuất hiện trong nav / không có route màn hình riêng.    |
| 2   | Desktop = modal; mobile = bottom sheet (hoặc tương đương).               |
| 3   | File máy / URL hợp lệ → sách hiện Library sau khi đóng overlay.          |
| 4   | Hủy picker / đóng sheet → không tạo bản ghi.                             |
| 5   | Trùng SHA → không nhân đôi; có thể Open existing.                        |
| 6   | Lỗi mạng / format → thông báo rõ; không orphan temp.                     |
| 7   | Không UI mua sách / browse store.                                        |




### 4.6. SCR-03 — Reader

**Mockup:** `[docs/mockups/reading.html](../mockups/reading.html)`  
**SRS:** FR-02–FR-07, FR-09, FR-10, FR-11 · **WF:** WF-03, WF-04 · **UC:** UC-02…UC-06 · **BR:** BR-01, BR-02, BR-04, BR-05

#### Mục đích

Không gian đọc **content-first**: render tài liệu, lưu vị trí, highlight / note / bookmark / **comment theo đoạn** qua Overlay — chrome ẩn mặc định (tap giữa để hiện/ẩn).

**Ôn dấu ấn (thay SCR-04):** mọi highlight / note / comment / bookmark gắn `bookId` của document đang mở. User xem lại và **jump** trong sidebar Reader — **không** có màn list annotation xuyên thư viện.

**Use case Comment (MVP mockup):** gắn ghi chú / đáp án vào đúng đoạn trên tài liệu (vd. file bài tập được gửi) — **không** phải mạng xã hội / feed bình luận công cộng. Comment lưu local theo `bookId` + location đoạn; sidebar đánh dấu chương/trang nào đã có comment.

#### Cấu trúc giao diện (theo mockup)


| Vùng                 | Mặc định | Khi hiện / mở                                                              |
| -------------------- | -------- | -------------------------------------------------------------------------- |
| Content canvas       | Full     | Reflow (EPUB/TXT/MD) hoặc fixed page (PDF — Phase renderer)                |
| Top chrome           | Ẩn       | Back · title / chapter · **Tools** · **Settings** · **More (⋮)**           |
| Active-tool chip     | Ẩn       | Khi đang chọn tool: chip ngắn (vd. `Highlight ✕`) cạnh Tools — 1 tap tắt   |
| Bottom chrome        | Ẩn       | Location scrubber mỏng + nhãn vị trí hiện tại (chương/trang) — **không** % hoàn thành |
| TOC edge (trái)      | Luôn sẵn | Dải chạm cạnh trái mở sidebar mục lục                                      |
| Bookmark edge        | Luôn sẵn | Ribbon trái — đánh dấu chương hiện tại / mở tab Bookmark                   |
| Sidebar trái         | Đóng     | Tabs: **Chapters** · **Bookmark** · **Note** · **Comment**                 |
| Selection menu       | —        | Highlight (màu) · Note · Copy — sau khi bôi chọn text                      |
| Comment drawer       | Đóng     | Comment / đáp án theo đoạn; badge số trên đoạn + trên mục lục chương      |
| Reading Settings     | Đóng     | Panel **SCR-05** (desktop: popover; mobile: bottom sheet)                  |
| More menu (⋮)        | Đóng     | Share document · Add to Favorites · Book info · Move to trash              |


#### Tools (gói trong icon header)

Để tránh che vùng đọc trên mobile, **không** dùng thanh công cụ nổi giữa màn hình. Annotate tools gói trong **Tools**:


| Tool        | Hành vi (mockup)                                                                 |
| ----------- | -------------------------------------------------------------------------------- |
| **Note**    | Bôi chọn → ghi chú gắn đoạn (highlight + note)                                   |
| **Highlight** | Bôi chọn → tô màu (vàng / xanh / hồng)                                         |
| **Comment** | Bật chế độ comment → tap đoạn để mở drawer ghi đáp án / ghi chú vị trí           |
| **Shape**   | Stub mockup (vẽ hình chú thích — Phase sau)                                      |

Đổi tool: mở Tools → chọn. Tắt nhanh: chip `✕` hoặc chọn lại cùng tool trong menu.

#### Sidebar trái (TOC)


| Tab         | Nội dung                                                                 |
| ----------- | ------------------------------------------------------------------------ |
| Chapters    | Danh sách chương; **badge** số comment nếu chương đó có comment          |
| Bookmark    | Thêm / bỏ bookmark tại chương hiện tại; list jump                        |
| Note        | List highlight có `note` của **sách đang mở** (FR-09 / WF-04); tap → jump `location` |
| Comment     | List comment / đáp án **gom theo chương**; tap → jump + mở drawer đoạn   |

Empty Note/Comment: “No notes yet” / tương đương — CTA quay vùng đọc (không navigate màn khác).


#### Tương tác đọc


| Gesture / action        | Kết quả                                                              |
| ----------------------- | -------------------------------------------------------------------- |
| Tap / click giữa        | Toggle chrome (top + bottom)                                         |
| Scroll                  | Cuộn reflow (mode **Scroll**); autosave location debounce            |
| Page mode **Paginated** | Snap / lật trang (theo Settings)                                     |
| Landscape + Dual page   | 2 cột khi cửa sổ rộng (≥ ~900px) và setting **2 pages** bật          |
| Bôi chọn text           | Menu Highlight / Note / Copy                                         |
| Edge trái / ribbon      | Mở TOC / bookmark                                                    |
| Back                    | Flush progress → Library                                             |
| Crash / kill app        | Giữ autosave gần nhất (**NFR-09**)                                   |


#### Renderer / Overlay (theo format)

- **Reflow + DOM/CSS Overlay:** EPUB, TXT, Markdown — mockup hiện minh họa reflow HTML.
- **Fixed + Canvas Overlay:** PDF (lớp trong suốt theo trang) — cùng Reader shell, renderer khác.
- Theme / typography áp dụng qua CSS variables — **không reload toàn document** (**NFR-03**).

#### Don'ts (Reader)

- Không thanh annotate nổi giữa vùng đọc (che chữ) — dùng Tools + chip.
- Không popup rate-app / promo / ads trong vùng đọc (**NFR-02**).
- Không AI tự chạy trên nội dung (**NFR-05**).
- Không chỉnh sửa file gốc.
- Comment **không** phải social feed / đăng công khai (MVP = annotation local).

#### Acceptance (Reader)


| #   | Tiêu chí                                                                              |
| --- | ------------------------------------------------------------------------------------- |
| 1   | Mở sách → chrome ẩn; nội dung đúng format (**BR-04**).                                |
| 2   | Thoát / mở lại → đúng `last_read_location`.                                           |
| 3   | Highlight ≤ 2 thao tác từ selection; lưu overlay SQLite (**BR-02**).                  |
| 4   | Note / Bookmark / Comment lưu local; jump lại đúng location (sidebar hoặc drawer).    |
| 5   | Tab Note liệt kê đúng theo `bookId` đang mở; jump đúng location (**FR-09**, **WF-04**). |
| 6   | Location scrubber / nhãn vị trí mỏng không phá immersion khi chrome ẩn; không hiện % hoàn thành. |
| 7   | Hash file gốc không đổi sau highlight / đổi theme (**NFR-08**).                       |
| 8   | Mobile: Tools trong header; chip tắt tool; Settings = bottom sheet; dual-page tắt.    |
| 9   | Chapters có badge khi có comment; tab Comment liệt kê theo trang/chương.              |
| 10  | Xóa sách → annotation của sách đó biến mất (**BR-06**); không còn màn Notes toàn cục. |




### 4.7. SCR-05 — Reading Settings

**Mockup:** panel trong `[docs/mockups/reading.html](../mockups/reading.html)` (không file HTML riêng).  
**SRS:** FR-04 · **BR:** BR-02, BR-05 · **NFR:** NFR-03, NFR-07

#### Mục đích

Chỉnh **thoải mái thị giác** và cách trình bày trang khi đọc. Lưu **per-book** trong `READING_SESSION_STATE` (default app-level lấy từ **SCR-06** Appearance khi mở sách mới).

**Không nhầm với SCR-06:** đây là panel trong Reader; cài đặt shell / linked libraries / file scan nằm ở App Settings.

#### Cách mở

Từ Reader chrome → **Settings**. Desktop: popover cạnh nút. Mobile: **bottom sheet**. Không full-page che mất ngữ cảnh đọc.

#### Controls (MVP — theo mockup)


| Control            | Giá trị                                              | Hành vi                                         |
| ------------------ | ---------------------------------------------------- | ----------------------------------------------- |
| Theme / màu nền    | Night / Sepia / Day                                  | Đổi nền + màu chữ (**BR-05**)                   |
| Font size          | A− / A+ (clamp ~12–32px)                             | Áp dụng tức thì                                 |
| Font family        | Serif / Sans / Mono                                  | Không reload document                           |
| Font weight        | Light / Regular / Bold                               | CSS `font-weight`                               |
| Line height        | Slider ~1.2–2.2                                      | Reflow cập nhật                                 |
| Text align         | Left / Justify / Center                              | CSS `text-align`                                |
| Margins            | On/Off + Narrow / Normal / Wide (khi On)             | Max-width / padding vùng đọc                    |
| Page turn          | Scroll / Paginated                                   | Cuộn vs snap lật trang                          |
| Dual page          | 1 page / 2 pages                                     | 2 cột khi landscape + cửa sổ rộng (≥ ~900px)    |


PDF: subset hợp lý (zoom, theme overlay nếu có); không giả reflow text PDF.

#### Acceptance


| #   | Tiêu chí                                                              |
| --- | --------------------------------------------------------------------- |
| 1   | Đổi theme / size / font không reload toàn bộ document.                |
| 2   | Preference lưu local; mở lại cùng sách giữ setting.                   |
| 3   | Contrast đủ trên 3 theme (**NFR-07**).                                |
| 4   | Không popup; đóng panel bằng overlay / ✕ / tap ngoài.                 |
| 5   | Mobile: bottom sheet + safe-area; dual-page không ép trên màn hẹp.    |




### 4.8. SCR-06 — App Settings

**Mockup:** `[docs/mockups/setting.html](../mockups/setting.html)`  
**SRS:** NFR-06 (local-first) · NFR-11 / BR-08 (không tài khoản app) · FR-04 (theme app-level) · FR-30 stub (linked libraries) · liên quan FR-01 (file scan → import)

#### Mục đích

Màn **cài đặt toàn ứng dụng** (shell / OS / thư viện) — khác **SCR-05 Reading Settings** (chỉ khi đang đọc, per-book).

| | **SCR-05 Reading Settings** | **SCR-06 App Settings** |
| --- | --- | --- |
| Entry | Reader chrome → Settings | Library sidebar / More → Settings |
| Phạm vi | Per-book (font, size, margins, page mode…) | App-wide (linked libraries, chrome theme, scan, multi-doc, language, fullscreen) |
| Pattern | Panel / bottom sheet (không rời Reader) | Full-page screen |
| Persist | `READING_SESSION_STATE` | App preferences key-value + watched folders + linked library paths (§3.6) |

#### Entry / exit


| Sự kiện | Hành vi |
| --- | --- |
| Library → nav **Settings** | → **SCR-06** |
| Mobile More sheet → Settings | → **SCR-06** |
| **Back to library** / brand | → **SCR-01** |

**Không** có sidebar Log out / Sign in identity (**NFR-11**).

#### Cấu trúc giao diện (theo mockup)


| Vùng | Nội dung | Ghi chú thiết kế |
| --- | --- | --- |
| App sidebar | Library · Favorites · **Settings** (active) + device chip (local-only, không account) | Cùng chrome Library; Settings = current |
| Top bar | Eyebrow “Application” · title **Settings** · Fullscreen · Back to library | English UI |
| Category rail | **Linked libraries** · Appearance · File scan · Multi-document · Language · Fullscreen | Desktop: cột trái; mobile: chip horizontal scroll |
| Content panel | Một nhóm cài đặt tại một thời điểm | Max-width ~720px; card + rows |

#### Nhóm cài đặt (MVP — theo mockup)

##### Linked libraries

Thay nhóm **Account** cũ. App **không** đăng nhập email/password và **không** OAuth2 làm identity (**BR-08**).

| Control | Hành vi |
| --- | --- |
| Local-only badge | Nhấn mạnh MVP offline (**NFR-06**); dữ liệu trên thiết bị này |
| Google Drive | MVP: stub “Coming in Special”. Phase 3: chọn thư mục Drive đã sync trên máy → pull danh sách file hỗ trợ vào Library |
| Google Books | MVP: stub. Phase 3: liên kết thư viện / export catalog Books → hiện list tài liệu; chọn để tải về và lưu bản copy app-owned |
| Apple Books | MVP: stub. Phase 3: liên kết thư mục / thư viện Apple Books trên máy → pull danh mục |
| Sync now (per source) | Phase 3: refresh catalog từ nguồn đã link; dedup theo SHA-256 (**BR-03**) khi import file |
| Unlink | Gỡ liên kết nguồn; **không** xóa sách / highlight đã import local |

Cơ chế kết nối ưu tiên **folder / library path** đã có trên máy (Drive Desktop, Books library folder) — không dùng OAuth2 Sign-in app. File gốc không bị sửa (**BR-01**); file kéo từ nguồn ngoài (tải về) được lưu bản copy app-owned (**BR-09**).

##### Appearance

| Control | Giá trị | Hành vi |
| --- | --- | --- |
| App theme | Night / Sepia / Day | Đổi CSS variables shell (sidebar, Library, Settings) ngay |
| Follow system | On / Off | Map OS light/dark → Day / Night (Sepia vẫn thủ công) |
| Reduce motion | On / Off | Tắt animation không cần thiết |

Theme app có thể làm **default** khi mở sách mới; preference per-book (SCR-05) vẫn ghi đè.

##### File scan

| Control | Hành vi |
| --- | --- |
| Watch folders | Bật theo dõi FS (Main process) trên các path đã thêm |
| Auto-import on detect | Đăng ký **tham chiếu** file mới phát hiện — không copy (gốc không bị sửa — **BR-01**, **BR-09**) |
| Watched folder list | Add / remove path; hiện số file ước lượng |
| Formats | Chip `.epub` · `.pdf` · `.txt` · `.md` · `.docx` · `.doc` |
| Scan now | Quét thủ công + progress; kết quả → toast / sẵn sàng import |
| History | Lần quét gần nhất (local log tối giản) |

File scan **bổ sung** UX-IMP (Add file thủ công), không thay thế. Khác Linked libraries: File scan = watch folder local bất kỳ; Linked libraries = connector gắn nhãn siêu app (Drive / Books / Apple Books).

##### Multi-document

| Control | Hành vi |
| --- | --- |
| Allow multiple documents | On: mở sách mới không đóng sách đang đọc · Off: single-doc |
| Display mode | Tabs · Windows · Split |
| Maximum documents | 3 / 5 / 8 / 12 (clamp hiệu năng) |
| Restore previous session | Khôi phục tab/cửa sổ khi khởi động |

##### Language

| Control | Hành vi |
| --- | --- |
| Interface language | English (default) · Tiếng Việt | Copy UI; nội dung sách không đổi |
| Date & time format | Match UI language · vi-VN · en-US |

##### Fullscreen

| Control | Hành vi |
| --- | --- |
| Enter / Exit fullscreen | Toggle cửa sổ; ẩn sidebar (F11 / Esc) |
| Launch in fullscreen | Preference khởi động |
| Hide toolbar while reading | Align Invisible UI Reader (chrome ẩn mặc định) |
| Shortcuts | F11 toggle · Esc exit |

#### Overlay trên SCR-06


| Overlay | Mục đích |
| --- | --- |
| Link library (Phase 3) | Chọn folder / xác nhận liên kết Google Drive · Google Books · Apple Books |
| Unlink confirm | Gỡ connector; giữ data local đã import |
| Catalog preview (Phase 3) | List tài liệu từ nguồn → chọn import |

**Không** có Sign-in / Log out dialog identity.

#### Acceptance


| # | Tiêu chí |
| --- | --- |
| 1 | Từ Library Settings nav mở được SCR-06; Back to library về SCR-01. |
| 2 | Phân biệt rõ SCR-05 (Reader panel) vs SCR-06 (full-page app settings). |
| 3 | Theme Night / Sepia / Day áp dụng shell ngay, không reload app. |
| 4 | Toàn bộ đọc/import local chạy **không** cần đăng nhập (**NFR-06**, **NFR-11**). |
| 5 | Không có UI email/password hay OAuth2 Sign-in; unlink connector không xóa data local. |
| 6 | Watch folders + Scan now chạy qua Main (path sandbox-aware); format ngoài MVP bị bỏ qua / báo rõ. |
| 7 | Multi-doc Off → chỉ một sách mở; On tôn trọng max documents. |
| 8 | Language English mặc định; đổi locale cập nhật copy UI. |
| 9 | Fullscreen F11 / Esc; preference launch-in-fullscreen persist. |
| 10 | Mobile: cùng nhóm settings; category rail → list hoặc chips. |
| 11 | MVP: Linked libraries hiển thị stub 3 nguồn; Phase 3 mới pull catalog thật (**FR-30**). |



### 4.9. Quyết định đã chốt (Screen / IA)


| Chủ đề              | Quyết định                                                                 |
| ------------------- | -------------------------------------------------------------------------- |
| Ngôn ngữ UI         | English (default); SCR-06 cho phép đổi Tiếng Việt                          |
| Library model       | Local library of imported files (device **or** URL download) — no store   |
| Phân loại sách      | Shelves dọc + horizontal rails; reorder bằng `=`; detail bằng `›`          |
| Tab mini filter     | Không dùng trên Library hub                                                |
| Import UX           | **Không phải screen** — modal (desktop) / bottom sheet (mobile) trên Library; device + URL; không store |
| Reader              | Invisible UI; Tools dropdown + active-tool chip; selection ≤ 2 taps Highlight; Comment = annotation local theo đoạn |
| Highlights & Notes  | **Không có SCR-04** — annotation theo document; ôn/jump trong SCR-03 sidebar (Note · Comment · Bookmark). FR-09 / WF-04 gắn Reader |
| Settings đọc        | Panel / bottom sheet từ Reader (**SCR-05**); per-book overlay; dual-page chỉ màn rộng landscape |
| Settings app        | Full-page từ Library (**SCR-06** `setting.html`); Linked libraries + Appearance + File scan + Multi-doc + Language + Fullscreen |
| Identity            | **Không** tài khoản app; **không** email/password; **không** OAuth2 đăng nhập (**NFR-11**, **BR-08**) |
| Phase 3 libraries   | Google Drive / Google Books / Apple Books = catalog connectors (folder/path); không sync account đa thiết bị |
| Mockup đã có        | SCR-00 Splash, SCR-01 / 01a Library, UX-IMP Import, **SCR-03 Reader**, **SCR-05** (trong reading.html), **SCR-06 App Settings** |
| Mockup còn thiếu    | — (không còn SCR-04 HTML riêng) |


---

