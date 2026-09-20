# Project Brief — reading-book-app

> Tài liệu tinh gọn để bàn giao ngữ cảnh dự án cho các AI agent khác. Tổng hợp từ source code,
> cấu trúc thư mục, và các tài liệu sẵn có (`CLAUDE.md`, `docs/software/SDS.md`, `docs/software/SRS.md`)
> tại thời điểm 2026-09-13. Không phải nguồn thay thế cho SDS/SRS — khi cần chi tiết đầy đủ, đọc
> `docs/software/SDS.md` (kiến trúc/schema) và `docs/software/SRS.md` (yêu cầu sản phẩm).

---

## 1. Tổng quan & Mục tiêu

- **Tên dự án:** reading-book-app — ứng dụng đọc sách **local-first**.
- **MVP hiện tại:** desktop app (Electron + Vite + React + TypeScript). Mobile (Expo + React Native)
  mới chỉ là scaffold ban đầu (Expo Router), **chưa** nối vào các package dùng chung.
- **Định dạng sách hỗ trợ:** epub, pdf, txt, md, docx, doc (qua adapter riêng từng định dạng).
- **Nguyên tắc cốt lõi:** file gốc import vào **không bao giờ bị chỉnh sửa** — mọi highlight/note/
  bookmark/tiến độ đọc được lưu tách biệt trong SQLite ("overlay"), file gốc luôn ở bản sao sandbox
  read-only.
- **Có nguồn cloud:** liên kết OAuth với Google Drive / Dropbox / OneDrive để import sách từ cloud.
- **Tài liệu bối cảnh sản phẩm:** `docs/reading-habbit/` (persona, nỗi đau người đọc, UX rationale).
- **Tài liệu kiến trúc & schema chính thức:** `docs/software/SDS.md` (tiếng Việt) — đọc trước khi
  đổi cấu trúc. Yêu cầu chức năng: `docs/software/SRS.md`.
- **Chưa có test runner nào được cấu hình** trong repo (không vitest/jest, không script `test`).

---

## 2. Công nghệ sử dụng (Tech Stack)

### Desktop app (`source/apps/reading-book-desktop`)
| Layer | Công nghệ |
|---|---|
| Shell | Electron ^39, Vite ^8 (`vite-plugin-electron`, `vite-plugin-electron-renderer`) |
| UI | React 18 + TypeScript 5, Tailwind CSS 4 (`@tailwindcss/vite`) |
| State | Zustand ^5 (chuẩn cho custom hook state trong dự án này — ưu tiên store thay vì `useState`/`useRef` rải rác) |
| Router | react-router-dom ^7 |
| DB | better-sqlite3 ^12, migration bằng file `.sql` đánh số chạy qua `migrate.ts` |
| EPUB engine | epubjs ^0.3.93 (annotation/highlight vẽ qua API `rendition.annotations` gốc của epubjs — không có layer overlay DOM riêng) |
| Khác | jszip, fast-xml-parser, foliate-js, react-colorful |
| Build | electron-builder, TypeScript strict, ESLint (`--max-warnings 0`) |
| Spikes | script Node độc lập trong `spikes/` — không phải một phần app build (epub fixture/eval, overlay CFI, session roundtrip, theme contrast) |

### Mobile app (`source/apps/reading-book-mobile`) — scaffold, chưa build đầy đủ
Expo ~57, React Native 0.86, React 19, expo-router, NativeWind (Tailwind cho RN), react-native-reanimated/gesture-handler. Chưa dùng chung `packages/*`.

### Packages dùng chung (npm workspaces)
- `packages/domain` — model + port interface, **không I/O, không phụ thuộc framework**.
- `packages/shared` — helper domain + use case tầng Application (platform-agnostic).
- `packages/config` — theme, format, feature flag, OAuth config dùng chung.

---

## 3. Cấu trúc thư mục cốt lõi

```
source/                              # npm workspaces root
├── apps/
│   ├── reading-book-desktop/        # MVP — Electron main/preload + React renderer
│   └── reading-book-mobile/         # Expo scaffold, chưa nối packages/*
└── packages/
    ├── domain/    models/ ports/    # Domain thuần (Book, Annotation/Highlight/Bookmark/Note, LibraryStore, OverlayStore, DocumentImporter, DocumentRenderer, LocationCodec, AiProvider, ExternalLibraryConnector...)
    ├── shared/    services/ hooks/  # Use case tầng Application, hook dùng chung
    └── config/                      # theme, formats, feature flags, OAuth
```

### Bên trong `reading-book-desktop`

```
electron/                # Infrastructure — Main + Preload
├── main.ts / preload.ts
├── ipc/                  # channels.ts + <feature>.ipc.ts, đăng ký qua registerAllIpcHandlers()
├── persistence/          # better-sqlite3, migrations/001..019, sqlite-*-store.ts
├── adapters/             # DocumentImporter theo format: epub/pdf/txt/md/docx/doc.adapter.ts
├── files/                # sandbox copy, path allowlist, cover:// protocol
├── security/             # token-vault.ts (OAuth token, không lộ ra renderer)
└── config/, theme/       # OAuth config, native titlebar theming

src/                     # Presentation — Renderer (React)
├── bridge/               # wrapper typed quanh window.api, 1 file / feature
├── screens/              # Library, Reader, Settings, Splash
├── reader/                # renderers/epub (EpubRenderer.tsx, openEpubjs.ts, cfi/…), interaction/, chrome/, pageturn/
├── components/, chrome/, theme/, styles/, utils/
```

**IPC (Main ↔ Renderer)** luôn đi qua 4 điểm phải đồng bộ: `electron/ipc/channels.ts` (hằng số
channel) → `electron/ipc/<feature>.ipc.ts` (handler Main) → `electron/preload.ts`
(`contextBridge`, kiểu bởi `DesktopApi`) → `src/bridge/<feature>.ts` (wrapper renderer dùng).
DTO (`*Dto` trong `api-types.ts`) là plain object structured-clone-safe — domain model **không**
băng qua IPC trực tiếp.

**Renderer sách hiện tại:** chỉ có EPUB (`reader/renderers/epub/`). **Chưa có `DocumentRenderer`
cho PDF** — PDF hiện chỉ có adapter import (đọc metadata), chưa có màn đọc riêng.

---

## 4. Cơ sở dữ liệu (SQLite) — trạng thái schema hiện tại

Migration chạy tuần tự `001` → `019` (numbered `.sql` trong `electron/persistence/migrations/`),
qua nhiều lần đổi mô hình annotation:

```
highlights (009) → annotations (011) → annotations_v2 (012) → notes (018, JSON blob kiểu Thorium/Readium)
bookmarks (015 thêm excerpt) → gộp vào notes (019, phân biệt qua note_json.group)
book_signatures (003) → gộp thẳng vào cột books.signer_name/signature_status/signed_at (018)
comments (004) → đã DROP từ migration 010 (không còn dùng)
```

**Bảng chính hiện tại:**
- `books` — metadata sách, đã gồm cả chữ ký số (`is_signed`, `signer_name`, `signature_status`,
  `signed_at`), trạng thái đọc (`reading_status`), nguồn cloud (`source_provider`, `external_id`).
- `notes` — **bảng hợp nhất duy nhất** cho highlight / underline / strikethrough / bookmark / (freehand,
  stamp — có enum nhưng **chưa có UI**). Không có cột riêng cho từng thuộc tính; toàn bộ payload
  (`type`, `locatorExtended.locator` để "jump", `locatorExtended.raw` để render, `textualValue`,
  `note`, `style`, `status`, `isChecked`, `group`: `'annotation' | 'bookmark'`) nằm trong 1 cột JSON
  `note_json`. Index expression trên `note_json ->> 'group'` để lọc nhanh.
- `note_tags` — N–N note ↔ tag (thay `annotation_tags` cũ).
- `genres`, `collections`, `reading_sessions`, `reading-session` liên quan tiến độ đọc.
- `tags` — dùng chung cho `note_tags`.

**Đã bị loại bỏ hoàn toàn khỏi codebase (không phải chỉ đổi tên):**
- Layer vẽ overlay riêng: `DomCssOverlay`, `InkIframeLayer`, `TypewriterIframeLayer` (port
  `OverlayPainter` đã xoá) — highlight/underline giờ vẽ trực tiếp qua API native của epubjs
  (`EpubjsHandle.applyHighlight/removeHighlight`), tự vẽ lại khi re-render.
- **Typewriter** (hộp text rich-text kéo-thả) — gỡ hoàn toàn, không di dời đi đâu. Về khái niệm được
  thay bằng `textbox`, một kiểu highlight neo theo vùng chọn text như highlight thường.
- Freehand/Pencil vẽ tay — vẫn còn giá trị enum `note_json.type` nhưng **chưa từng có UI hoàn thiện**,
  đang là stub chờ renderer PDF.

Chi tiết đầy đủ từng bảng/cột: `docs/software/schema.dbml` và `docs/software/SDS.md` §3.

---

## 5. Quy ước mã nguồn

- **Dependency rule (theo convention, không có tool enforce):** `packages/domain` và
  `packages/shared` **không được** import `electron`, `better-sqlite3`, hay bất kỳ engine định dạng
  nào (`epubjs`, PDF lib...) — các thứ đó chỉ tồn tại trong
  `apps/reading-book-desktop/electron/**` và `src/reader/renderers|interaction`.
- **Screens/components không được đụng SQL hay `fs` trực tiếp** — luôn gọi qua use case
  (`packages/shared/services/*`) hoặc IPC bridge (`src/bridge/*`).
- **State trong custom hook: dùng Zustand store**, không dùng `useState`/`useRef` rải rác kể cả khi
  state chỉ scope trong 1 màn hình (chuẩn riêng của dự án này).
- **Path alias:** `@reading-book/shared`, `@reading-book/domain`, `@reading-book/config` — khai báo
  đồng thời ở `tsconfig.json` và `vite.config.ts`, phải giữ đồng bộ khi thêm package mới.
- **AI / external-library sync:** đã có port (`AiProvider`, `ExternalLibraryConnector`,
  `SyncService`) nhưng chỉ có implementation `NoOp*` — cố tình để trống cho pha sau, không phải
  code thiếu.
- Thêm định dạng sách mới = adapter file (`electron/adapters/<fmt>.adapter.ts`) + đăng ký
  `importer-registry.ts` + renderer tương ứng dưới `src/reader/renderers/<fmt>/` (nếu cần) + đăng
  ký `packages/shared/readers` / `packages/config`.

---

## 6. Trạng thái hiện tại / việc chưa xong (biết để tránh giả định sai)

- PDF: có import/metadata adapter, **chưa có renderer đọc** — đọc PDF trong app chưa hoạt động đầy đủ.
- Freehand/Pencil, Stamp annotation: có chỗ trong schema, **không có UI**.
- Typewriter: đã bị gỡ bỏ khỏi roadmap hiện tại, thay bằng textbox-as-highlight.
- Mobile app: chỉ là Expo scaffold, chưa dùng chung domain/shared packages, chưa có kế hoạch build
  gần.
- Không có test runner nào cấu hình — không giả định có test suite khi review code.
- Tài liệu kế hoạch triển khai theo giai đoạn (Giai đoạn 0–8): `docs/ke-hoach-trien-khai/*.md` —
  vừa được cập nhật (2026-09) để khớp kiến trúc notes/epubjs-native hiện tại, các phần Typewriter/
  Pencil trong đó đã được đánh dấu là bỏ/chưa hoàn thiện.
