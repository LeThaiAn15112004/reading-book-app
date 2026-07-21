# Giai đoạn 0 — Nền tảng kỹ thuật

**Mục tiêu:** Skeleton desktop chạy được; có chỗ lưu dữ liệu và gọi Main an toàn — chưa cần UI đẹp.

**Điều kiện vào:** SRS/SDS đã đọc; monorepo `source/` đã có.

**Không làm:** Import thật, Reader, AI.

---

## 1. Outcome

Dev mở được:

```bash
cd source/apps/reading-book-desktop
npm install
npm run dev
```

Cửa sổ Electron hiện; Renderer gọi được IPC thử (`ping` / `getAppInfo`); SQLite mở được file DB trong app data.

## 2. Việc cần làm

### 2.1. Packages domain (theo SDS §2.6, §2.11, §3)

Bám cây `source/packages/{domain,shared,config}` trong SDS §2.11. Domain **không** import Electron / SQLite.

| Task | Chi tiết | Vị trí |
| :--- | :--- | :--- |
| T0.1 | Domain models (SDS §3): `Book`, `Author`, `BookAuthor`, `Collection`, `CollectionBook`, `ReadingSessionState`, `Highlight`, `Note`, `Bookmark`, `BookChunk`, `Location` (CFI / page-rect / text-offset), `DocumentFormat` (`epub` \| `pdf` \| `txt` \| `md`), `Preferences` (app-level) | `packages/domain` — file: `book.ts`, `author.ts`, `collection.ts`, `location.ts`, `reading-session-state.ts`, `highlight.ts`, `note.ts`, `bookmark.ts`, `book-chunk.ts`, `document-format.ts`, `preferences.ts`, `index.ts` |
| T0.2 | Port stubs (SDS §2.6): `DocumentImporter`, `UrlDocumentFetcher`, `DocumentNormalizer` (stub OK), `DocumentRenderer`, `OverlayPainter`, `LocationCodec`, `LibraryStore`, `CollectionStore`, `OverlayStore`, `AiProvider` (**NoOp**), `ExternalLibraryConnector` (**NoOp**; không Auth/account) | `packages/domain/ports` |
| T0.3 | Config: `formats` (epub/pdf/txt/md), theme tokens stub, feature flags `aiEnabled=false`, `externalLibrariesEnabled=false` (không tài khoản app) | `packages/config` — `formats.ts`, `theme.ts`, `features.ts` |
| T0.4 | Use case skeleton (SDS §2.11 `shared/services`): `importBook`, `openReader`, `saveReadingSessionState`, `addHighlight`, `addNote`, `listAnnotations`, `createCollection`, `manageCollectionBooks` — impl nhẹ / empty OK | `packages/shared/services` (+ folder `models`, `repositories`, `readers`, `storage`, `utils` theo SDS) |

### 2.2. Electron Infrastructure

| Task | Chi tiết | Vị trí |
| :--- | :--- | :--- |
| T0.5 | Cấu trúc folder theo SDS §2.11: `electron/ipc`, `persistence`, `files`, `adapters` | desktop |
| T0.6 | SQLite + migration v1 theo SDS §3: `books`, `authors`, `book_authors`, `collections`, `collection_books`, `reading_session_states`, `highlights`, `notes`, `bookmarks`, `book_chunks` (embedding nullable), `app_settings` | `electron/persistence` |
| T0.7 | Sandbox path: thư mục books trong userData; allowlist path | `electron/files/sandbox.ts` |
| T0.8 | Preload `contextBridge` — API hẹp typed | `electron/preload.ts` |
| T0.9 | IPC channels: `library:*`, `import:*`, `overlay:*` (handler stub OK) | `electron/ipc` |

### 2.3. Presentation skeleton

| Task | Chi tiết |
| :--- | :--- |
| T0.10 | Router / state: Splash → Library → Reader → Settings (màn trống cũng được) |
| T0.11 | Bridge typed `window.api` wrappers |
| T0.12 | Theme CSS variables tối thiểu (theo Design System / mockup) |

## 3. Thứ tự khuyến nghị

```text
T0.1 → T0.2 → T0.3
  → T0.6 → T0.7 → T0.8 → T0.9
  → T0.4 → T0.10 → T0.11 → T0.12
```

## 4. Nghiệm thu

- [ ] `npm run dev` không lỗi
- [ ] DB file tạo được sau lần chạy đầu
- [ ] Renderer gọi IPC thành công (không `require('fs')` từ renderer)
- [ ] `packages/domain` có đủ domain models SDS §3 (gồm `Author` / `BookAuthor` / `Collection` / `CollectionBook` / `BookChunk` / `Location`)
- [ ] `packages/domain/ports` có đủ port SDS §2.6 (gồm `CollectionStore`); `AiProvider` / `ExternalLibraryConnector` = NoOp; **không** port Auth/login
- [ ] `packages/domain` / `packages/shared` không import Electron / SQLite
- [ ] Feature flag AI/Sync = off

## 5. Tham chiếu

- SDS §2.6 (Ports), §2.7–2.11 (monorepo + folder), §3 (ERD / models)
- Plan cũ: Epic A trong [`docs/plan/04_Phase_MVP_Free_Core.md`](../plan/04_Phase_MVP_Free_Core.md)
