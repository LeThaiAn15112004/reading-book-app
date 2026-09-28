# Tài liệu database SQLite — ReadMate Reader (desktop)

> Nguồn: `docs/software/schema.dbml`, `electron/persistence/{db,migrate,sqlite-library-store,sqlite-overlay-store}.ts`
> và `electron/persistence/migrations/001…019`. Schema khớp trạng thái sau migration `020_optimized_books_schema.sql`.

## 1. Tổng quan

- Engine: **SQLite** qua thư viện `better-sqlite3` (đồng bộ, chạy trong Electron main process).
- File DB: `reading-book.db` nằm trong thư mục `app.getPath('userData')` của Electron.
- Khi mở (`openDatabase()` trong `db.ts`): bật `PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = WAL`, rồi chạy `migrate()`. DB là singleton (`getDatabase()` / `closeDatabase()`).
- Renderer **không** truy cập SQLite trực tiếp; mọi thứ đi qua IPC/preload tới main process.
- **Nguyên tắc cốt lõi (SDS §3):** file sách không bao giờ bị sửa (file gốc của user với import local; bản copy app-owned với URL / cloud). Mọi dữ liệu người dùng (highlight, note, bookmark, tiến độ đọc, ...) là *overlay* lưu trong DB, khoá theo `book_id`.

### Quy ước

| Hạng mục | Quy ước |
|---|---|
| Tên bảng/cột | `snake_case` |
| Thời gian | `TEXT` ISO-8601 |
| Boolean | `INTEGER` 0/1 |
| Khoá chính | UUID dạng `TEXT` |

## 2. Sơ đồ quan hệ (rút gọn)

```
books ──< book_authors >── authors
books ──< collection_books >── collections
books ──< notes ──< note_tags >── tags
books ──< book_chunks
```

Tất cả FK trỏ về `books` đều `ON DELETE CASCADE` (xoá sách là xoá sạch overlay). Riêng `book_authors.author_id → authors.id` là `RESTRICT`.

## 3. Các bảng

### `books`
Thư viện sách. Từ migration 020, genres / phiên đọc / metadata lẻ nằm ngay trong dòng `books` dưới dạng 3 cột JSON (không còn bảng `genres`, `book_genres`, `reading_session_states`).

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | TEXT PK | UUID |
| `title` | TEXT NOT NULL | |
| `file_path` | TEXT NOT NULL | path tuyệt đối của file mà Reader mở. **Local import:** file gốc của user (*referenced* — app không ghi/di chuyển/xóa). **URL / cloud:** bản copy app-owned `{userData}/books/{uuid}/…` (*managed*, read-only; gồm cả sách import trước khi có thư viện tham chiếu). Loại suy ra từ path, không có cột riêng. Đổi giá trị này (Locate file) không đổi `id` |
| `normalized_path` | TEXT | bản trích xuất cho DOC/DOCX |
| `file_format` | TEXT NOT NULL | `epub` \| `pdf` \| `txt` \| `md` \| `docx` \| `doc` |
| `cover_path` | TEXT | ảnh bìa đã trích, do app sở hữu: `{userData}/covers/` (sách cũ: cạnh bản copy trong `{userData}/books/{uuid}/`) |
| `sha256` | TEXT NOT NULL UNIQUE | chống trùng (BR-03) |
| `is_favorite` | INTEGER 0/1 | |
| `source_url` | TEXT | khi import từ URL |
| `reading_status` | TEXT | `reading` \| `completed` \| `not-started` (mặc định) |
| `source_provider`, `external_id` | TEXT | nguồn cloud: `google-drive` / `dropbox` / `onedrive` |
| `metadata_json` | TEXT NOT NULL `'{}'` | `{ fileSizeBytes, pageCount, description, isSigned, signerName, signatureStatus, signedAt }`; `signatureStatus` ∈ `valid/invalid/expired/unknown` |
| `genres_json` | TEXT NOT NULL `'[]'` | mảng tên genre, sắp A→Z, không trùng (không phân biệt hoa/thường) |
| `reading_state_json` | TEXT NOT NULL `'{}'` | vị trí đọc + tuỳ chọn hiển thị: `{ lastReadLocation, percent, fontFamily, fontSize, fontWeight, lineHeight, textAlign, layoutMode, pageTurnMode, marginsEnabled, marginPreset, isLandscape, updatedAt }` — `lastReadLocation` là CFI / page-rect / text-offset (đóng gói kèm label) hoặc placeholder `Started` |
| `added_at`, `updated_at` | TEXT NOT NULL | |

Cả 3 cột JSON có `CHECK (json_valid(...))`. Quy ước: key camelCase, `null` ≡ vắng; ghi từng phần bằng `json_patch` (RFC 7396: key có trong patch thì ghi đè, `null` xoá key, key vắng thì giữ). `reading_state_json.updatedAt` là mốc chống ghi cũ đè mới (`books.updated_at` cũng bị bump khi sửa metadata nên không dùng làm mốc).

Index: `sha256` (unique), `is_favorite`, `reading_status`, `(source_provider, external_id)`, `updated_at`.

### `authors` / `book_authors`
`authors(id, name, sort_name, created_at)`. Bảng nối `book_authors(book_id, author_id, sort_order)` với PK kép; `sort_order` giữ thứ tự tác giả.

### `collections` / `collection_books`
`collections(id, name, description, created_at, updated_at)`. Bảng nối `collection_books(collection_id, book_id, sort_order, added_at)`.

### `notes`
Bảng hợp nhất cho **annotation** (highlight, underline, strikethrough, textbox, ...) và **bookmark**, theo mô hình Thorium Reader / Readium Web Annotation.

| Cột | Ghi chú |
|---|---|
| `id` | UUID PK |
| `book_id` | FK → `books.id` |
| `note_json` | JSON payload, mặc định `'{}'` |
| `created_at`, `updated_at` | |

`note_json` chứa: `type`, `group` (`'annotation'` \| `'bookmark'`), `locatorExtended.locator` (dùng để *jump*), `locatorExtended.raw` (payload render theo type), `pdfAnnotation`, `style`, `textualValue`, `note`, `tags`, `label`, `creator`, `status`, `isChecked`, ... (kiểu `INoteState` trong `packages/domain`).

Index: `book_id`, `updated_at`, và expression index `idx_notes_group` trên `json_extract(note_json, '$.group')` để lọc annotation/bookmark không phải full scan.

> Bảng `bookmarks` cũ đã bị gộp vào `notes` và xoá ở migration 019; bookmark giờ là row có `group = 'bookmark'`, `type = 'bookmark'`.

### `tags` / `note_tags`
`tags(id, name UNIQUE, color_hex)`. Bảng nối `note_tags(note_id, tag_id)`, PK `pk_note_tags`.

### `book_chunks`
Chuẩn bị cho AI (Phase 2): `(id, book_id, chunk_index, content, location_start, location_end, embedding BLOB, created_at)`. `embedding` nullable cho đến khi có AI. Unique `(book_id, chunk_index)`.

### `schema_migrations`
Do `migrate.ts` tự tạo: `(id AUTOINCREMENT, name UNIQUE, applied_at)` — ghi lại migration nào đã chạy.

## 4. Migration

File `.sql` đánh số nằm ở `electron/persistence/migrations/`, được import bằng `?raw` và khai báo thủ công trong mảng `MIGRATIONS` của `migrate.ts`.

Cách chạy: mỗi migration nằm trong một transaction cùng lệnh ghi vào `schema_migrations` (idempotent — migration đã áp dụng sẽ bị bỏ qua).

**Lưu ý quan trọng:** `PRAGMA foreign_keys` là no-op bên trong transaction, nên `migrate()` tắt FK ở mức connection trước mỗi migration và bật lại sau. Nếu không, các migration rebuild `books` (DROP + rename) sẽ kích hoạt `ON DELETE CASCADE` và xoá sạch `book_authors`, session, overlay. SQLite không hỗ trợ `ALTER/DROP COLUMN` đầy đủ nên nhiều migration dùng cách rebuild bảng (`*_new` → copy → drop → rename).

| # | File | Nội dung chính |
|---|---|---|
| 001 | initial | Schema overlay v1 |
| 002 | expand_file_formats | Mở rộng `file_format` |
| 003 | book_signatures | Chữ ký số sách |
| 004 | comments | Comment |
| 005 | drop_app_settings | Bỏ bảng app settings |
| 006 | book_library_metadata | Metadata thư viện (page_count, description, ...) |
| 007 | genres_nn | Genres quan hệ N–N |
| 008 | reading_session_v2 | Session đọc v2 |
| 009 | highlights_v2 | Highlight v2 |
| 010 | typewriter_notes | Typewriter notes |
| 011–012 | annotations / v2 | Bảng annotations |
| 013 | book_reading_status | `reading_status` |
| 014 | cloud_provenance | `source_provider`, `external_id` |
| 015 | bookmark_excerpt | Excerpt cho bookmark |
| 016–017 | annotations_notes / location_ref | Ghi chú + `location_ref` |
| 018 | notes_thorium | `annotations` → `notes` (JSON), inline chữ ký vào `books` |
| 019 | bookmarks_notes_merge | Gộp `bookmarks` vào `notes`, thêm `idx_notes_group` |
| 020 | optimized_books_schema | Gộp `reading_session_states`, `genres`/`book_genres` và metadata lẻ vào 3 cột JSON của `books` |

**Thêm migration mới:** tạo `021_xxx.sql`, import `?raw` và thêm vào `MIGRATIONS` trong `migrate.ts` (theo đúng thứ tự), rồi cập nhật `docs/software/schema.dbml`.

## 5. Lớp truy cập dữ liệu

- `SqliteLibraryStore` (`sqlite-library-store.ts`) — implement `LibraryStore` / `CollectionStore`: CRUD sách, tìm theo id/sha256, link tác giả (`findOrCreateAuthorByName`, ...), đặt genre (`setGenres` → `genres_json`), favorite, trạng thái đọc (`markAsReading`), collections (`addBookToCollection`, `deleteCollection`, ...), `listAll()`, `deleteCascade()`. Truy cập qua `getLibraryStore()`.
- `SqliteOverlayStore` (`sqlite-overlay-store.ts`) — implement `OverlayStore`: đọc/ghi `books.reading_state_json` (vị trí + tuỳ chọn hiển thị), và CRUD annotation/bookmark trên bảng `notes`. Truy cập qua `getOverlayStore()`.
- Ngoài ra: `backfill-library-metadata.ts` (backfill metadata thư viện), `reading-session-location.ts` (xử lý vị trí đọc).

## 6. Lưu ý khi làm việc với DB

- Xoá sách chỉ cần `DELETE FROM books WHERE id = ?` — cascade lo phần còn lại (cần FK bật).
- Lọc note theo loại nên dùng `json_extract(note_json, '$.group')` để tận dụng `idx_notes_group`.
- Thời gian luôn là chuỗi ISO-8601; boolean luôn 0/1.
- Không bao giờ ghi vào file sách gốc — chỉ ghi vào overlay.
