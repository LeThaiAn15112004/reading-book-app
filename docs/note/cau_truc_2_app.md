# Cấu Trúc Kiến Trúc: Thorium Reader vs reading-book-app

> Đọc trực tiếp mã nguồn 2 repo ngày 2026-09-03. Tài liệu này nói về **cách tổ chức code/kiến trúc tổng thể**, không nhắc lại chi tiết bookmark/annotation hay page-rendering đã có ở 2 file trước (`thorium_vs_reading_book_app_comparison.md`, `thorium_dinh_dang_ho_tro.md`).

---

## 0. Bảng tổng quan nhanh

| | Thorium Reader | reading-book-app |
|---|---|---|
| Kiểu repo | 1 app duy nhất, không phải monorepo | **npm workspaces monorepo** (`apps/*`, `packages/*`) |
| Build tool | **Webpack** — 7 config file riêng biệt cho từng bundle | **Vite** (`vite-plugin-electron`) |
| State management | **Redux + Redux-Saga** (side-effect qua generator/saga) | **Zustand** (store nhẹ, không boilerplate action/reducer) |
| Dependency Injection | **InversifyJS** (`Container`, `@injectable`, symbol table) ở Main process | Không dùng framework DI — wiring thủ công qua factory function |
| Kiến trúc phân lớp | Không tách lớp domain/application rõ ràng — code nghiệp vụ nằm lẫn trong `main/services`, `main/db`, saga | **Layered + Ports & Adapters** tường minh: Presentation → Application (use case) → Domain (model/port) → Infrastructure |
| Engine đọc | Vendor hoá toàn bộ Readium (`r2-xxx-js/`) — code lib nằm ngay trong repo | Dùng `epub.js` như dependency ngoài qua npm, không fork |
| Độ trưởng thành | Production nhiều năm | MVP đang phát triển |

---

## 1. Cấu trúc thư mục — Thorium Reader

```
thorium-reader/
├── src/
│   ├── main.ts                  # Entry point Electron Main process
│   ├── main/                    # ── MAIN PROCESS ──
│   │   ├── di.ts                 # InversifyJS container — khởi tạo toàn bộ service/repository
│   │   ├── diSymbolTable.ts      # Bảng symbol để inject (thay cho string key thô)
│   │   ├── menu.ts, keyboard.ts, sessions.ts
│   │   ├── db/                   # Persistence (SQLite, xem file so sánh trước)
│   │   │   ├── sqlite/            # bảng notes (bookmark+annotation)
│   │   │   ├── document/          # publication/opds — lưu qua Redux state serialize JSON
│   │   │   └── repository/        # PublicationRepository, OpdsFeedRepository
│   │   ├── streamer/              # Serve nội dung EPUB/PDF qua local server ảo
│   │   ├── services/              # LcpManager, DeviceIdManager, OpdsService, LSDManager...
│   │   ├── converter/             # Convert model nội bộ ↔ "View" model gửi ra renderer
│   │   ├── redux/                 # store + sagas riêng cho Main process
│   │   ├── network/, fs/, zip/, stream/, w3c/, pdf/, tools/, cli/, analytics/, customization/
│   │   └── storage/                # publication-storage, publication-data
│   │
│   ├── renderer/                # ── RENDERER PROCESS (UI) ──
│   │   ├── library/               # Màn hình thư viện (danh sách sách, import, OPDS)
│   │   ├── reader/                 # Màn hình đọc sách
│   │   │   ├── components/
│   │   │   │   ├── Reader.tsx        # 178KB — component "trung tâm vũ trụ", xử lý EPUB/Divina
│   │   │   │   ├── ReaderHeader.tsx  # 100KB
│   │   │   │   ├── ReaderFooter.tsx  # 42KB
│   │   │   │   ├── ReadingAudio.tsx  # Audiobook player riêng
│   │   │   │   ├── pdf/               # UI riêng cho PDF (tách khỏi Reader.tsx)
│   │   │   │   ├── ReaderSettings/, ReaderMenu/
│   │   │   │   └── AnnotationEdit.tsx, BookmarkEdit.tsx
│   │   │   └── redux/               # sagas riêng cho renderer (note.ts, readerConfig.ts...)
│   │   └── common/                 # hook/component dùng chung
│   │
│   ├── common/                  # ── DÙNG CHUNG MAIN + RENDERER ──
│   │   ├── redux/                  # actions, states (dùng chung schema Redux 2 bên)
│   │   ├── models/                  # kiểu dữ liệu chia sẻ (reader config, publication view...)
│   │   ├── ipc/                     # định nghĩa kênh IPC
│   │   ├── services/, api/, readium/, type/
│   │   └── lcp.ts, rgb.ts, keyboard.ts...
│   │
│   └── r2-xxx-js/               # ── ENGINE READIUM VENDOR HOÁ ──
│       ├── r2-shared-js/           # Model + parser (EPUB/CBZ/Divina/DAISY/Audiobook)
│       ├── r2-streamer-js/         # Serve nội dung
│       ├── r2-navigator-js/        # Render/điều hướng/highlight/CFI
│       ├── r2-lcp-js/              # DRM
│       ├── r2-opds-js/             # Catalog OPDS
│       └── r2-utils-js/            # Zip, HTTP utils
│
├── webpack.config*.js           # 7 file: main, preload, renderer-library,
│                                 #   renderer-reader, renderer-pdf, renderer-pdf-extract,
│                                 #   (+ preprocessor-directives dùng chung)
└── package.json                 # 1 package duy nhất, ~439 dependency entries
```

**Điểm đặc trưng của kiến trúc Thorium:**
- **3 tiến trình Electron rõ rệt** (`main`, `preload`, `renderer`), nhưng **`common/`** chứa cả Redux state schema dùng chung 2 bên — Main và Renderer đều chạy Redux, đồng bộ qua IPC (mỗi bên có store + saga riêng, action được "bắc cầu" qua kênh IPC).
- **Dependency Injection bằng InversifyJS** ở Main: `di.ts` khai báo và bind mọi service/repository vào 1 `Container`, các class dùng `@injectable()`/`@inject(diSymbolTable.xxx)` — kiểu kiến trúc "enterprise Java/C#" áp vào Node.
- **Không có ranh giới domain/application/infra rõ ràng** như Clean Architecture — `main/services/`, `main/db/`, `main/converter/` đứng ngang hàng nhau, phụ thuộc lẫn nhau khá tự do (không có 1 lớp domain thuần không phụ thuộc framework).
- **Engine đọc sách nằm ngay trong repo** (`r2-xxx-js/`) chứ không phải black-box từ `node_modules` — muốn hiểu/sửa cách app phân trang, highlight, parse EPUB đều đọc/sửa được trực tiếp.
- **7 webpack config riêng** phản ánh việc app build ra nhiều bundle riêng biệt (main process, preload script, cửa sổ thư viện, cửa sổ đọc EPUB, cửa sổ đọc PDF, worker trích xuất PDF) — mỗi bundle có thể có dependency/target khác nhau (Node vs browser).

---

## 2. Cấu trúc thư mục — reading-book-app

```
reading-book-app/
├── docs/                        # Tài liệu SDS/SRS, kế hoạch triển khai, diagram PlantUML...
└── source/                      # npm workspaces root
    ├── apps/
    │   ├── reading-book-desktop/   # ── APP CHÍNH (MVP) ──
    │   │   ├── electron/             # ── INFRASTRUCTURE: Main + Preload ──
    │   │   │   ├── main.ts / preload.ts
    │   │   │   ├── ipc/                # channels.ts + <feature>.ipc.ts (handler) theo từng nhóm
    │   │   │   ├── persistence/         # better-sqlite3 + migrations/001..017 + sqlite-*-store.ts
    │   │   │   ├── adapters/            # DocumentImporter theo format: epub/pdf/txt/md/docx/doc
    │   │   │   ├── files/               # kiểm tra path sách (app-owned / tham chiếu), copy URL·cloud, relink
    │   │   │   ├── security/            # token-vault (OAuth cloud)
    │   │   │   └── config/, theme/
    │   │   └── src/                  # ── PRESENTATION: Renderer (React) ──
    │   │       ├── bridge/              # wrapper typed quanh window.api (1 file / feature)
    │   │       ├── screens/              # Library, Reader, Settings, Splash
    │   │       ├── reader/                # shell đọc sách
    │   │       │   ├── chrome/             # layout khung UI reader
    │   │       │   ├── renderers/epub/      # EpubRenderer.tsx (92KB) + openEpubjs.ts (88KB)
    │   │       │   │   ├── cfi/              # CFI codec riêng cho EPUB
    │   │       │   │   ├── progress/          # pagination cache
    │   │       │   │   └── previews/          # cache preview HTML/thumbnail
    │   │       │   ├── overlays/            # highlight/freehand/typewriter overlay (DOM CSS)
    │   │       │   ├── pageturn/             # PageTurnController — engine lật trang 3D
    │   │       │   ├── interaction/          # cursor, hit-test
    │   │       │   └── typewriter/           # textbox tool
    │   │       ├── components/, chrome/, theme/, styles/, utils/
    │   │       └── screens/Reader/logic/hooks/ # useReaderSessionBridge...
    │   └── reading-book-mobile/     # Expo Router — mới là scaffold, chưa nối vào packages/*
    │
    └── packages/                  # ── DOMAIN & SHARED (dùng chung desktop + mobile) ──
        ├── domain/                   # models + port interfaces — KHÔNG import electron/sqlite/epubjs
        │   ├── models/                 # Book, Bookmark, Annotation, Location (đa hình), ReadingSessionState...
        │   └── ports/                   # OverlayStore, LibraryStore, DocumentImporter, DocumentRenderer,
        │                                 #   LocationCodec, AiProvider, SyncService, ExternalLibraryConnector
        ├── shared/                    # domain helpers + application use case (platform-agnostic)
        │   ├── services/                # use case (Application layer)
        │   ├── hooks/                    # hook dùng chung logic (reader session autosave...)
        │   └── models/                    # reading-prefs, reading-session-prefs
        └── config/                     # theme/formats/feature flags dùng chung
```

**Điểm đặc trưng của kiến trúc reading-book-app:**
- **npm workspaces monorepo** thật sự: `packages/domain` và `packages/shared` **không được phép** import `electron`, `better-sqlite3`, hay bất kỳ engine format nào (`epubjs`, PDF lib...) — quy ước này *được ghi rõ trong `CLAUDE.md`* dù không có tool ép buộc tự động (enforced by convention, not tooling).
- **Ports & Adapters tường minh**: mọi thao tác dữ liệu đi qua interface (`OverlayStore`, `LibraryStore`, `DocumentImporter`, `DocumentRenderer`, `LocationCodec`) định nghĩa trong `packages/domain/ports/` — Electron/SQLite chỉ là 1 cách hiện thực (adapter) cho các interface này, đổi sang IndexedDB/remote API sau này về lý thuyết không phải sửa domain/UI.
- **IPC đi qua đúng 4 điểm phải khớp nhau theo quy ước**: `channels.ts` (khai báo kênh) → `<feature>.ipc.ts` (xử lý ở Main) → `preload.ts` (expose qua `contextBridge`) → `bridge/<feature>.ts` (renderer gọi vào) — không có DI container, wiring là các hàm `register...()` gọi thủ công.
- **State quản lý bằng Zustand** — không có action/reducer/saga như Redux, code ít boilerplate hơn, nhưng cũng không có middleware sinh thái phong phú như redux-saga cho side-effect phức tạp (undo/redo, replay, time-travel debug).
- **Không có tầng "vendor hoá engine"** như Thorium — `epub.js` được dùng nguyên bản từ `node_modules`, mọi tuỳ biến (CFI, pagination cache, page-turn 3D) được viết **đè lên trên** epub.js chứ không sửa trực tiếp source của nó.
- Domain model có sẵn interface cho AI (`AiProvider`) và đồng bộ ngoài (`ExternalLibraryConnector`, `SyncService`) nhưng **chỉ có implementation `NoOp*`** — là port dựng sẵn cho roadmap Premium/Sync, chưa code thật.

---

## 3. So sánh theo từng khía cạnh kiến trúc

### 3.1 Mô hình tiến trình Electron

| | Thorium | reading-book-app |
|---|---|---|
| Main | 1 Redux store + saga riêng, DI container Inversify quản lý toàn bộ service | Không Redux — service/store SQLite khởi tạo trực tiếp, expose qua IPC handler thuần |
| Renderer | 1 Redux store + saga riêng, đồng bộ action với Main qua IPC | Zustand store cục bộ + hook gọi `bridge/*` (typed wrapper quanh `window.api`) |
| Kênh giao tiếp Main ↔ Renderer | IPC + đồng bộ Redux action 2 chiều (khá phức tạp — phải serialize action) | IPC thuần theo kiểu request/response qua `contextBridge`, DTO plain object (`*Dto`), không đồng bộ state 2 chiều |

→ reading-book-app có mô hình giao tiếp **đơn giản và dễ suy luận hơn** (gọi hàm - nhận kết quả, giống REST nội bộ); Thorium **phức tạp hơn** vì phải giữ đồng bộ 2 Redux store ở 2 tiến trình khác nhau.

### 3.2 Quản lý state

- **Thorium (Redux + Redux-Saga):** nhiều boilerplate (action type, action creator, reducer, saga watcher/worker) nhưng có **generator-based side-effect** mạnh — dễ viết các luồng phức tạp (cancel, race, sequence) như mở sách/giải mã DRM/đợi streamer sẵn sàng. Phù hợp với app có nhiều luồng bất đồng bộ chồng chéo (điều đúng với 1 reading app hỗ trợ DRM/network/OPDS).
- **reading-book-app (Zustand):** gọn nhẹ, ít mã nguồn hơn nhiều cho cùng 1 tính năng, học nhanh hơn — nhưng khi luồng bất đồng bộ phức tạp lên (nhiều bước, cần cancel/rollback) sẽ phải tự viết tay logic đó thay vì có sẵn công cụ như saga effect (`call`, `race`, `cancel`).

### 3.3 Dependency Injection

- **Thorium dùng InversifyJS thật sự** — class có decorator `@injectable`, bind trong `di.ts`, resolve qua `Container`. Ưu điểm: dễ test (mock service qua rebind), rõ ràng về lifecycle. Nhược điểm: thêm 1 tầng trừu tượng (symbol table, container) khiến người mới đọc code khó truy vết "hàm này thực sự được implement bởi class nào" nếu không quen Inversify.
- **reading-book-app không dùng DI framework** — wiring thủ công (import trực tiếp, gọi factory function). Đơn giản, dễ đọc luồng gọi trực tiếp bằng "Go to definition", nhưng khi số lượng service tăng lên, việc thay thế 1 implementation (VD đổi `sqlite-overlay-store` sang bản mock để test) phải sửa tay ở từng nơi gọi, không có 1 chỗ trung tâm để rebind như Inversify.

### 3.4 Build tooling

- **Thorium — Webpack, 7 config riêng biệt**: kiểm soát chi tiết từng bundle (target Node cho main, target Electron-renderer cho renderer, worker riêng cho PDF-extract) — mạnh nhưng cấu hình nặng, thời gian build/rebuild chậm hơn, chi phí bảo trì config cao khi Webpack có breaking change.
- **reading-book-app — Vite + `vite-plugin-electron`**: dev server HMR nhanh hơn nhiều, cấu hình gọn hơn hẳn (theo `CLAUDE.md`: `npm run dev` chạy Vite + Electron dev server) — phù hợp vòng lặp phát triển nhanh của giai đoạn MVP.

### 3.5 Tổ chức mã nguồn / ranh giới module

- **Thorium**: tổ chức theo **process** trước (`main/`, `renderer/`, `common/`) rồi mới theo tính năng bên trong mỗi process — không có ranh giới domain/infra tường minh, 1 file như `Reader.tsx` (178KB) gánh rất nhiều trách nhiệm (UI + gọi trực tiếp API navigator + xử lý annotation...).
- **reading-book-app**: tổ chức theo **lớp kiến trúc** trước (domain/shared/infra) rồi mới theo process — ranh giới rõ ràng hơn, file lớn nhất (`EpubRenderer.tsx` 92KB) vẫn lớn nhưng đã tách được khá nhiều phần (CFI, pagination-cache, preview-cache, overlay) ra module riêng thay vì gộp hết vào 1 file như Thorium.

---

## 4. Đánh giá tổng thể

| Tiêu chí | Thorium mạnh hơn | reading-book-app mạnh hơn |
|---|---|---|
| Độ trưởng thành, đã hứng nhiều edge-case thực tế | ✅ | |
| Khả năng viết luồng bất đồng bộ phức tạp (saga effect) | ✅ | |
| Kiểm soát chi tiết build/bundle | ✅ | |
| Tốc độ vòng lặp phát triển (dev server, HMR) | | ✅ (Vite) |
| Độ đơn giản khi đọc luồng gọi (không qua DI container) | | ✅ |
| Ranh giới kiến trúc rõ ràng (domain tách khỏi infra) | | ✅ |
| Dễ viết test/mock (nhờ port/interface + DI) | Có DI nhưng thiếu ranh giới domain rõ | Có ranh giới domain rõ nhưng thiếu DI tự động |
| Độ gọn nhẹ của state management | | ✅ (Zustand ít boilerplate hơn Redux-Saga) |

**Kết luận:** hai app chọn 2 triết lý kiến trúc khác hẳn nhau, phù hợp với 2 giai đoạn khác nhau của vòng đời sản phẩm:
- **Thorium** dùng bộ công cụ "nặng đô" (Redux-Saga, InversifyJS, Webpack đa cấu hình) — hợp lý cho 1 sản phẩm **đã trưởng thành, nhiều người maintain, nhiều luồng nghiệp vụ phức tạp** (DRM, đồng bộ nhiều cửa sổ, OPDS...), đổi lại là chi phí học/bảo trì cao hơn cho người mới.
- **reading-book-app** dùng bộ công cụ "nhẹ, hiện đại" (Zustand, Vite) nhưng bù lại bằng **kỷ luật kiến trúc rất chặt** (Ports & Adapters, cấm domain import framework, DTO tách biệt model) — hợp lý cho **giai đoạn MVP cần lặp nhanh** nhưng vẫn muốn giữ khả năng mở rộng/test về lâu dài mà không cần công cụ DI phức tạp.

---

*Nguồn: phân tích tĩnh mã nguồn `thorium-reader` (`src/main/di.ts`, `src/renderer/reader/components/`, `webpack.config*.js`) và `reading-book-app` (`source/apps/reading-book-desktop/CLAUDE.md`, `electron/`, `src/`, `packages/domain|shared|config`) ngày 2026-09-03. Không chạy thử app.*
