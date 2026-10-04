# UI/UX Flows — Reading Book App

**Tài liệu:** Chi tiết các luồng giao diện và trải nghiệm người dùng  
**Phiên bản:** 1.0  
**Ngày cập nhật:** 2026-10-04  
**Các screens chính:** SCR-00 (Splash), SCR-01 (Library), SCR-03 (Reader), SCR-05 (Reading Settings), SCR-06 (App Settings)

---

## Mục lục

- [1. Tổng quan kiến trúc UI](#1-tổng-quan-kiến-trúc-ui)
- [2. Flowchart chủ đạo](#2-flowchart-chủ-đạo)
- [3. Chi tiết từng Screen](#3-chi-tiết-từng-screen)
  - [SCR-00: Splash Screen](#scr-00-splash-screen)
  - [SCR-01: Library Screen](#scr-01-library-screen)
  - [SCR-03: Reader Screen](#scr-03-reader-screen)
  - [SCR-05: Reading Settings](#scr-05-reading-settings)
  - [SCR-06: App Settings](#scr-06-app-settings)
- [4. Sequence Diagrams — Các use cases chính](#4-sequence-diagrams--các-use-cases-chính)
  - [UC-01: Import Book từ File](#uc-01-import-book-từ-file)
  - [UC-02: Import Book từ URL](#uc-02-import-book-từ-url)
  - [UC-03: Mở và Đọc Sách](#uc-03-mở-và-đọc-sách)
  - [UC-04: Tạo Highlight & Note](#uc-04-tạo-highlight--note)
  - [UC-05: Quản lý Library (Metadata & Collections)](#uc-05-quản-lý-library-metadata--collections)
  - [UC-06: Kết nối Cloud Sources](#uc-06-kết-nối-cloud-sources)
  - [UC-07: Tìm kiếm trong Sách](#uc-07-tìm-kiếm-trong-sách)
  - [UC-08: Dịch Văn bản](#uc-08-dịch-văn-bản)
- [5. Component Hierarchy](#5-component-hierarchy)
- [6. State Management](#6-state-management)

---

## 1. Tổng quan kiến trúc UI

### Kiến trúc Layered UI

```
Presentation Layer (React Components)
├── Screens (SCR-00, SCR-01, SCR-03, SCR-05, SCR-06)
├── Components (reusable UI components)
├── Reader (reader-specific renderers & overlays)
└── Chrome (UI chrome: headers, footers, sidebars)
       ↓
Bridge Layer (IPC wrappers)
├── libraryApi
├── importApi
├── overlayApi
├── searchApi
├── translationApi
└── appApi
       ↓
Electron Main Process
├── IPC Handlers
├── Persistence (SQLite)
├── File System
├── Cloud Services
└── Security (OAuth tokens)
```

### Navigation Model (React Router)

```
/ (root)
├── /splash (SCR-00)
├── /library (SCR-01)
│   ├── (sidebar filters: All / Reading / Not started / Completed / Favorites — state, not routes)
│   └── /collection/:collectionId (SCR-01b — collection view)
├── /reader/:bookId (SCR-03)
│   ├── /reader/:bookId/settings (SCR-05 — inline panel)
│   └── /reader/:bookId/signature (SCR-03 — signature info)
└── /settings (SCR-06)
```

---

## 2. Flowchart chủ đạo

### Luồng từ Boot đến Library

```mermaid
flowchart TD
    A["App Launch<br/>(Electron main)"] --> B["SCR-00 Splash<br/>(Boot gate)"]
    B --> C{"Main Process<br/>Ready?"}
    C -->|Yes| D["Auto-navigate<br/>to /library"]
    C -->|No| E["Show boot error"]
    E --> E1["BootErrorBanner<br/>in Library"]
    D --> F["SCR-01 Library<br/>(Live)"]
    F --> G["User selects book"]
    G --> H["Navigate to<br/>/reader/:bookId"]
    H --> I["SCR-03 Reader"]
```

### Luồng Import (từ Library)

> Chi tiết từng trạng thái lỗi: §9 *Import Errors*; state machine: §9 *Import state machine*.

```mermaid
flowchart TD
    A["User in SCR-01<br/>clicks Import"] --> B{"Import source?"}
    B -->|Add file| C["Main opens native<br/>file dialog (1 file)"]
    B -->|Import URL| D["ImportUrlDialog"]
    B -->|Cloud Sources| CL["CloudSourcesHub<br/>Download entry"]
    C -->|Cancel| IDLE["Idle (silent)"]
    D -->|Cancel| IDLE
    C -->|Picked| P1["ImportProgressDialog<br/>Importing…"]
    D -->|Submit| P2["ImportProgressDialog<br/>Downloading… (bytes, Cancel)"]
    CL --> P3["Inline ring on entry<br/>(bytes, Cancel)"]
    P2 -->|network / timeout / http| D
    P2 -->|too_large / not_direct_file| D
    P2 -->|User cancel| T0["Toast info:<br/>Download cancelled"]
    P2 -->|Downloaded| P1
    P3 -->|Downloaded| P1
    P3 -->|error| TE["Toast error<br/>[Retry] / [Connect]"]
    P1 --> V{"Format / access /<br/>duplicate check"}
    V -->|unsupported / missing /<br/>denied / corrupted| TE2["Toast error"]
    V -->|Duplicate| K["ImportConflictDialog"]
    V -->|OK| M["Extract metadata<br/>+ signature (non-fatal)"]
    M --> R["Save to SQLite"]
    R -->|save_failed| TE
    R -->|OK| S["Toast success [Open]<br/>+ refresh Library"]
    K -->|Open existing| O["/reader/:bookId"]
    K -->|Discard| IDLE
    S -->|Open| O
```

### Luồng Reading Session (dalam Reader)

```mermaid
flowchart TD
    A["Reader opens<br/>SCR-03"] --> B["Load book<br/>content"]
    B --> C["Load session state<br/>(overlay:getSessionState)"]
    C --> D["Restore last<br/>read location"]
    D --> E["User reads &<br/>interacts"]
    E --> F{"User action?"}
    F -->|Highlight text| G["Show color picker"]
    F -->|Add note| H["Show note dialog"]
    F -->|Search| I["Show search panel"]
    F -->|Translate| J["Show translator"]
    F -->|Navigate| K["Update location"]
    G --> L["Save highlight<br/>(overlay:saveHighlight)"]
    H --> M["Save note<br/>(overlay:saveHighlight)"]
    I --> N["Query FTS<br/>(search:searchBook)"]
    J --> O["Translate text<br/>(translation:translate)"]
    K --> P["Save session state<br/>(overlay:saveSessionState)"]
    L --> Q["UI refresh"]
    M --> Q
    N --> Q
    O --> Q
    P --> Q
    Q --> R["Continue reading"]
    R --> E
    F -->|Close reader| S["Flush session<br/>on app close"]
    S --> T["App exits"]
```

---

## 3. Chi tiết từng Screen

### SCR-00: Splash Screen

**Mục đích:** Boot gate & branding  
**Nơi:** `src/screens/Splash/`  
**Components chính:**
- `SplashBrand` — Logo & brand text
- `SplashSpinner` — Loading indicator

**Luồng:**
1. App khởi động, render Splash
2. `useSplashBoot()` hook kiểm tra Main process ready
3. Nếu ready → auto-navigate đến `/library`
4. Nếu boot error → show `BootErrorBanner` (sau khi navigate)

**State:**
- `bootError?: string` (từ location state)

**IPC calls:**
- `app:ping` (implicit trong boot check)

---

### SCR-01: Library Screen

**Mục đích:** Quản lý thư viện sách  
**Nơi:** `src/screens/Library/`  
**Components chính:**

> Bố cục Library (sidebar + Grid ⇄ Table + Continue Reading) — chi tiết: `docs/change_plan/library_layout_redesign.md`.

#### Layout & Top-level
- `LibraryScreen` (shell: hub ↔ Collections ↔ Cloud Sources + dialogs)
- `LibraryHub` (home: sidebar + browse area)
- `LibrarySidebar` (All books / Reading / Not started / Completed / Favorites + counts)
- `LibraryTopBar` (search + import buttons)
- `ContinueReading` (≤ 3 sách đang đọc, chỉ ở All books, không search)
- `LibraryBrowseToolbar` (tiêu đề filter + số sách, Sort, Grid ⇄ Table — được nhớ)
- `LibraryBookGrid` (lưới tự xuống dòng, cuộn dọc) → `ShelfRailCard`
- `LibraryBookTable` (bảng, chọn dòng) + `LibraryBookDetailPanel` (panel bên phải)
- `LibraryEmptyState` (empty library message)
- `BootErrorBanner` (boot error, nếu có)

#### Collection detail (tab Collections)
- `ShelfDetailView` (Back · tên collection · Grid/List) → `ShelfRailCard` / `ShelfDetailItem`
- `ViewModeToggle` (grid ↔ list, chỉ cho collection detail)

#### Dialogs & Popups
- `LibraryBookInfoDialog` (book info + reading status)
- `EditBookMetadataDialog` (edit metadata)
- `ConfirmBookActionDialog` (confirm actions)
- `BookItemMenu` (context menu for book)
- `NewCollectionDialog` (create/edit collection)
- `CollectionsHub` (sidebar for collections)
- `CloudSourcesHub` (cloud integrations)

#### Import Dialogs
- `ImportProgressDialog` (Downloading / Importing; byte progress khi biết size; nút Cancel khi đang tải URL)
- `ImportConflictDialog` (duplicate — Open existing / Discard; dùng chung cho File, URL, Cloud)
- `ImportUrlDialog` (URL input; giữ URL + hiện lỗi inline sau khi tải thất bại; nút Retry cho lỗi tạm thời)
- `ImportToast` (toast chung của Library; có thể kèm 1 action: Open / Retry / Connect)

**Shelves (định nghĩa sẵn):**
- Continue Reading (sách đang đọc, sorted by last-read-at)
- In Progress (sách được mark as reading)
- All Books (tất cả)
- Favorites (sách favorite)
- Completed (sách completed)
- Genres (shelves per genre, dynamic)

**Features:**
- **Search:** Global search across title/author/description
- **Filter:** By reading status, favorites, genres
- **Collections:** User-curated collections (n-n với books)
- **Metadata editing:** Edit title, author, description, genres
- **Book actions:**
  - Open (→ Reader)
  - Mark as reading / completed
  - Toggle favorite
  - Show in folder (file management)
  - Copy file path
  - Edit metadata
  - Remove from library
  - Delete file (managed books only)
  - Locate file (if moved)
  - Check signature
  - Add to / remove from collection

**State Management (useLibraryScreen):**
```typescript
// Navigation
navigate: (path) => void
openReader: (bookId) => void
goCollections: () => void

// Search & filter
searchQuery: string
setSearchQuery: (q) => void
filterConfig: FilterConfig
filterItems: (list, query, filter) => filtered

// Book info dialog
bookInfoId: string | null
setBookInfoId: (id) => void
bookInfoBook: BookSummaryDto | null

// Edit metadata
editMetadataBook: BookSummaryDto | null
setEditMetadataId: (id) => void
handleSaveMetadata: (id, values) => Promise<void>

// Book menu
bookMenu: { bookId, point } | null
menuBook: BookSummaryDto | null
setBookMenu: (menu) => void
handleOpenBookMenu: (bookId, point) => void

// Removal
pendingRemoval: { bookId, kind } | null
setPendingRemoval: (removal) => void
confirmPendingRemoval: () => Promise<void>

// Book actions
handleToggleFavorite: (bookId) => void
handleMarkCompleted: (bookId) => void
handleOpenFileLocation: (bookId) => void
handleCopyFilePath: (bookId) => void
handleAddToCollection: (bookId, collectionId) => void
handleRemoveFromCollection: (bookId, collectionId) => void

// Import (state in zustand `useLibraryImportStore`, driven by `useLibraryImport`)
toast: { message, variant, action?: { label, run } } | null
clearToast: () => void
progress: { source: 'file' | 'url', stage: 'downloading' | 'importing', filename?, receivedBytes?, totalBytes? } | null
canCancel: boolean            // true while a URL download can still be aborted
conflict: { bookId, message? } | null
urlDialog: { open, initialUrl, error: { message, retryable } | null }
closeUrlDialog: () => void
handleFromDevice: () => Promise<void>
handleFromUrl: () => void
handleCancelImport: () => void
handleUrlSubmit: (url) => Promise<void>
handleConflictDiscard: () => void
handleConflictOpenExisting: () => void

// Shelves
view: 'shelves' | 'shelf-detail' | 'collection'
activeShelf: ShelfId | null
shelfItems: LibraryBook[]
reorderShelf: (shelfId, order) => void
reorderSections: (order) => void
hideEmptyShelves: boolean
visibleShelfIds: ShelfId[]
shelfCounts: Record<ShelfId, number>
viewMode: 'grid' | 'list'
setViewMode: (mode) => void

// Collections
openCollection: (collectionId) => void
collections: CollectionSummaryDto[]
activeCollection: CollectionSummaryDto | null
collectionItems: LibraryBook[]
newCollectionOpen: boolean
openNewCollection: () => void
openEditCollection: (collection) => void
closeCollectionDialog: () => void
submitCollection: (values) => Promise<void>
editingCollection: CollectionSummaryDto | null
pendingCollectionDelete: CollectionSummaryDto | null
confirmCollectionDelete: () => Promise<void>

// Empty states
isEmpty: boolean
noSearchMatches: boolean
showShelves: boolean
```

**IPC Calls:**
- `library:listBooks` → list all books with sessions
- `library:getBook` → get single book details
- `library:markAsReading` → mark as in-progress
- `library:markAsCompleted` → mark as completed
- `library:setFavorite` → toggle favorite
- `library:updateMetadata` → update title/author/genres/description
- `library:showInFolder` → open file in native explorer
- `library:copyFilePath` → copy path to clipboard
- `library:removeBook` → remove from library (keep file)
- `library:deleteBookFile` → delete managed book file
- `library:relinkBook` → re-attach moved file
- `library:checkSignature` → verify digital signature
- `library:listCollections` → list all user collections
- `library:createCollection` → create new collection
- `library:updateCollection` → edit collection metadata
- `library:deleteCollection` → delete collection
- `library:addBookToCollection` → add book to collection
- `library:removeBookFromCollection` → remove book from collection
- `import:fromFile` → Main mở native file dialog (1 file), import theo reference; renderer không gửi path
- `import:fromUrl` → tải HTTPS về temp rồi import bản copy app-owned
- `import:cancel` → huỷ lượt tải URL đang chạy
- `import:progress` (Main → renderer) → `{ stage, filename?, receivedBytes?, totalBytes? }`, chỉ gửi sau khi đã chọn file / submit URL
- `cloud:cancelDownload` → huỷ lượt tải Cloud của một `externalId`

---

### SCR-03: Reader Screen

**Mục đích:** Đọc sách & quản lý annotations  
**Nơi:** `src/screens/Reader/`  
**Components chính:**

#### Shell & Layout
- `ReaderScreen` (session wiring + main layout)
- `ReaderShell` (chrome layout, sidebar, canvas)
- `ReadingCanvas` (main content renderer)

#### Chrome (UI controls)
- `ReaderTopbar` (title, controls)
- `ReaderFooter` (location/progress, controls)
- `ReaderZoomViewport` (zoom + pan for zoom-able formats)
- `ToolsMenu` (tools: highlight, note, etc.)
- `MoreMenu` (more options)
- `ReaderOpenStatus` (file status: open, missing, error)

#### Chrome Controls
- `ChromeRevealButton` (show/hide chrome on click)
- `FullscreenButton` (toggle fullscreen)
- `ImmersiveExitButton` (exit immersive reading)
- `ZoomControl` (zoom in/out)

#### Sidebars & Panels
- `SidebarEdgeRail` (left rail: TOC, notes, bookmarks)
- `TocEdgeButton` (toggle TOC)
- `TocSidebar` (table of contents)
- `NoteFloatingMenu` (floating menu for notes)
- `NoteItemMenu` (context menu for note item)

#### Annotation Tools
- `HighlightColorPicker` (color picker for highlights)
- `HighlightEditPopup` (edit existing highlight)
- `NoteTextboxPopup` (sticky note dialog)
- `HighlightContextMenu` (right-click menu on highlight)

#### Companion Tools (Panels)
- `ReaderSearchPanel` (search within book)
- `WordCountPanel` (word count & statistics)
- `ReadAloudMenu` (text-to-speech controls)
- `TranslationPopover` (inline translation)
- `SnapshotOverlay` (screenshot tool)
- `AaSettingsPanel` (reading appearance: font, size, colors)
- `SignInfoPanel` (digital signature info)

#### Dialogs
- `BookInfoDialog` (book metadata in reader)
- `TrashConfirmDialog` (confirm annotation deletion)

**Renderers (format-specific):**
- `EpubRenderer` (EPUB rendering via epub.js)
- PDF renderer (future)
- Text/Markdown renderer
- etc.

**Features:**

1. **Reading Controls:**
   - Navigate by chapter, page, location
   - Zoom & pan (for zoomable formats)
   - Fullscreen & immersive mode

2. **Annotations:**
   - Highlight text (colors: yellow, orange, pink, green, blue)
   - Underline, strikethrough
   - Textbox (sticky note)
   - Edit & delete annotations
   - Tags for highlights
   - Status (normal, completed)

3. **Companion Tools:**
   - **Search:** FTS within book (page indicators, snippets)
   - **Word count:** Total + per-chapter statistics
   - **Read aloud:** TTS support
   - **Translate:** Offline translation (worker thread)
   - **Snapshot:** Capture & copy screen region

4. **Reading Settings (per-book):**
   - Font family, size, line-height
   - Text color & background color
   - Margins, letter-spacing
   - Theme (light, sepia, dark/night)

5. **File Management:**
   - Book signature verification status
   - File location & size
   - Missing/moved file handling

**State Management (useReaderScreen):**

```typescript
// Book & session
bookId: string
ensureTab: (bookId) => void
updateBookTitle: (bookId, title) => void

// Chrome UI
immersive: boolean
fullscreen: boolean
toggleFullscreen: () => Promise<void>
exitFullscreen: () => Promise<void>
immersiveReveal: () => void
readerChromeMenu: ReaderChromeMenuApi

// Search
readerSearchQuery: string
setReaderSearchQuery: (q) => void
readerSearchRequestId: string
requestReaderSearch: (q) => void

// Global reading prefs (per-app, not per-book)
globalPrefs: GlobalReadingPrefs
setGlobalPrefs: (prefs) => void

// Zoom (for zoomable formats)
zoomLevel: number
setZoomLevel: (level) => void

// Highlights & notes
highlights: HighlightDto[]
bookmarks: BookmarkDto[]
deleteHighlight: (highlightId) => Promise<void>
saveHighlight: (highlight) => Promise<void>

// Reading session state (per-book)
sessionState: ReadingSessionState
saveSessionState: (state) => Promise<void>
```

**IPC Calls:**
- `overlay:getSessionState` → get reading session (location, prefs)
- `overlay:saveSessionState` → save location & per-book prefs
- `overlay:listHighlights` → get all annotations
- `overlay:saveHighlight` → save/update annotation
- `overlay:deleteHighlight` → delete annotation
- `overlay:listBookmarks` → get all bookmarks
- `overlay:saveBookmark` → save/update bookmark
- `overlay:deleteBookmark` → delete bookmark
- `library:openBookContent` → open book file stream
- `library:getBook` → get book metadata
- `library:markAsReading` → mark as reading
- `search:searchBook` → FTS search (counts, positions, snippets)
- `bookIndex:ensure` → ensure book is indexed for search
- `bookIndex:status` → subscribe to indexing progress
- `translation:translate` → translate text (worker)
- `translation:progress` → subscribe to model download progress
- `wordCount:getStats` → get word count statistics
- `app:captureSnapshot` → capture screen region
- `library:checkSignature` → verify book signature

---

### SCR-05: Reading Settings

**Mục đích:** Cài đặt đọc sách (per-book preferences)  
**Nơi:** `src/screens/Reader/components/settings/`  
**Component:** `AaSettingsPanel` (nội tuyến trong Reader sidebar)

**Settings:**
- **Font:** Font family selection (e.g., "Georgia", "Roboto", "Serif", "Sans-serif")
- **Size:** Font size (px, range: 12–48)
- **Line-height:** Line spacing (ratio, range: 1.0–2.0)
- **Letter-spacing:** Character spacing
- **Text color:** Text color picker
- **Background color:** Background color picker
- **Margins:** Left/right margins (px)
- **Theme preset:** Light, Sepia, Night (dark)

**Storage:**
- Saved per-book in `reading_session_state_json` under `books.reading_state_json`
- Read/write via `overlay:saveSessionState`

**IPC Calls:**
- `overlay:saveSessionState` (with prefs)

---

### SCR-06: App Settings

**Mục đích:** Cài đặt ứng dụng toàn cục  
**Nơi:** `src/screens/Settings/`  
**Component:** `SettingsScreen`

**Sections:**

1. **Appearance:**
   - Theme (Light, Dark, Auto)
   - Font rendering options

2. **Reading Defaults:**
   - Global font family, size, line-height
   - Default theme for new sessions

3. **File Management:**
   - Scan for books in folder (future)
   - File import location settings

4. **Linked Libraries (Cloud):**
   - Google Drive connection status
   - Dropbox connection status
   - OneDrive connection status
   - Connect / disconnect buttons

5. **Languages & Translation:**
   - UI language
   - Translation model settings

6. **Keyboard & Accessibility:**
   - Keyboard shortcuts
   - Accessibility options

**Storage:**
- Electron store (platform-specific)
- Desktop: `~/.config/reading-book-app/` (or Windows equivalent)

**IPC Calls:**
- `cloud:connect` (Google Drive, Dropbox, OneDrive)
- `cloud:disconnect`
- `cloud:getAccessToken`

---

## 4. Sequence Diagrams — Các use cases chính

### UC-01: Import Book từ File

```mermaid
sequenceDiagram
    participant User as User
    participant Lib as SCR-01<br/>Library
    participant Bridge as Bridge<br/>(importApi)
    participant Main as Electron Main
    participant Fs as File System
    participant Db as SQLite

    User->>Lib: Click "Add file"
    Lib->>Bridge: importApi.fromFile()
    Bridge->>Main: import:fromFile IPC
    Main->>User: dialog.showOpenDialog (1 file, filter theo format hỗ trợ)

    alt User cancels picker
        Main-->>Bridge: { ok: false, errorCode: 'cancelled' }
        Bridge-->>Lib: (silent — không toast, không overlay)
    else File picked
        Main-->>Lib: import:progress { stage: 'importing', filename }
        Lib->>Lib: ImportProgressDialog "Importing…"
        Main->>Main: assertSupportedExtension()
        Main->>Main: reject nếu file nằm trong userData (inside_app_data)
        Main->>Fs: hashFile (SHA-256)
        Note over Main,Fs: ENOENT → missing_file · EACCES/EPERM → access_denied
        Main->>Db: findBySha256
        alt Duplicate
            Main-->>Bridge: { ok: false, bookId, errorCode: 'duplicate' }
            Bridge-->>Lib: ImportConflictDialog
        else New book
            Main->>Main: importer.import(filePath) — parse lỗi → corrupted
            Main->>Main: verifyOnImport() — lỗi chỉ để "chưa kiểm tra", không fail import
            Main->>Db: INSERT books (file_path = path gốc, referenced — không copy)
            Note over Main,Db: lỗi ghi DB → save_failed (UNIQUE → duplicate)
            Main-->>Bridge: { ok: true, bookId }
            Bridge-->>Lib: refresh Library + Toast success [Open]
        end
    end
```

### UC-02: Import Book từ URL

```mermaid
sequenceDiagram
    participant User as User
    participant Lib as SCR-01<br/>Library
    participant Dialog as ImportUrlDialog
    participant Bridge as Bridge<br/>(importApi)
    participant Main as Electron Main
    participant Http as HTTP Fetch
    participant Sandbox as App Sandbox
    participant Db as SQLite

    User->>Lib: Click "Import URL"
    Lib->>Dialog: Open dialog
    User->>Dialog: Enter URL, click "Download"
    Dialog->>Bridge: importApi.fromUrl(url)
    Lib->>Lib: ImportProgressDialog "Downloading…" + Cancel
    Bridge->>Main: import:fromUrl IPC

    Main->>Main: assertSupportedUrlPathExtension(url)
    Main->>Http: fetch (HTTPS only, ≤5 redirects, ≤100 MB, idle timeout 30s)
    loop each chunk
        Http-->>Main: bytes (re-arm idle timeout)
        Main-->>Lib: import:progress { stage: 'downloading', receivedBytes, totalBytes }
    end

    alt User clicks Cancel
        Lib->>Main: import:cancel
        Main-->>Bridge: { errorCode: 'cancelled' }
        Bridge-->>Lib: Toast info "Download cancelled"
    else network / timeout / http_status
        Main-->>Bridge: { errorCode }
        Bridge-->>Dialog: Reopen with same URL + inline error + [Retry]
    else scheme / too_large / not_direct_file
        Main-->>Bridge: { errorCode }
        Bridge-->>Dialog: Reopen with same URL + inline error (sửa URL)
    else Downloaded
        Main-->>Lib: import:progress { stage: 'importing' } (hết Cancel)
        Main->>Main: assertSupportedExtension + hash + duplicate check
        alt Duplicate
            Main-->>Bridge: { ok: false, bookId, errorCode: 'duplicate' }
            Bridge-->>Lib: ImportConflictDialog
        else New book
            Main->>Sandbox: copyIntoBooksSandbox(temp) → managed path (lỗi → save_failed)
            Main->>Main: importer.import(managedPath) (lỗi → corrupted, xoá bản copy)
            Main->>Main: verifyOnImport() (non-fatal)
            Main->>Db: INSERT books(file_path, source_url, ...)
            Main-->>Bridge: { ok: true, bookId }
            Bridge-->>Lib: refresh Library + Toast success [Open]
        end
    end
    Main->>Main: finally — xoá temp file (mọi nhánh)
```

### UC-03: Mở và Đọc Sách

```mermaid
sequenceDiagram
    participant User as User
    participant Lib as SCR-01<br/>Library
    participant Reader as SCR-03<br/>Reader
    participant Bridge as Bridge APIs
    participant Main as Electron Main
    participant Fs as File System
    participant Db as SQLite
    participant Renderer as Reader<br/>Renderer<br/>(epub.js, etc.)

    User->>Lib: Click book card
    Lib->>Lib: openReader(bookId)
    Lib->>Lib: navigate /reader/:bookId
    
    Lib-->>Reader: Mount Reader screen
    Reader->>Reader: useReaderBookOpen()
    
    Reader->>Bridge: libraryApi.openBookContent(bookId)
    Bridge->>Main: library:openBookContent IPC
    
    Main->>Db: SELECT * FROM books WHERE id = ?
    Db-->>Main: book record
    
    Main->>Main: resolveBookFile(book.file_path)
    Main->>Main: Validate path, check file exists
    
    alt File missing
        Main-->>Bridge: { ok: false, errorCode: 'missing_file' }
        Reader->>Reader: Show missing file UI
        Reader->>Reader: Show "Locate file" button
    else File found
        Main->>Fs: Open file stream
        Fs-->>Main: Readable stream
        
        Main-->>Bridge: { ok: true, stream, format, ... }
        Bridge-->>Reader: ArrayBuffer or stream
        
        Reader->>Reader: ensureTab(bookId)
        Reader->>Renderer: Load book (epub.js or other)
        Renderer->>Renderer: Parse format
        Renderer-->>Reader: Book loaded
        
        Reader->>Bridge: overlayApi.getSessionState(bookId)
        Bridge->>Main: overlay:getSessionState IPC
        
        Main->>Db: SELECT reading_state_json FROM books WHERE id = ?
        Db-->>Main: session state
        
        Main-->>Bridge: { lastReadLocation, lastReadAt, prefs }
        Bridge-->>Reader: Session state
        
        Reader->>Renderer: Restore location
        Reader->>Reader: Apply reading prefs
        Reader-->>User: Show book at saved location
        
        User->>Reader: Read book, interact
    end
    
    User->>Reader: Click close / switch
    Reader->>Reader: flushSession()
    Reader->>Bridge: overlayApi.saveSessionState(bookId, state)
    Bridge->>Main: overlay:saveSessionState IPC
    
    Main->>Db: UPDATE books SET reading_state_json = ? WHERE id = ?
    Db-->>Main: OK
    
    Main-->>Bridge: OK
    Reader->>Reader: Navigate away
```

### UC-04: Tạo Highlight & Note

```mermaid
sequenceDiagram
    participant User as User
    participant Canvas as Reading<br/>Canvas
    participant Reader as Reader<br/>Logic
    participant Popup as Highlight<br/>Popup
    participant Bridge as Bridge<br/>(overlayApi)
    participant Main as Electron Main
    participant Db as SQLite

    User->>Canvas: Select text
    Canvas->>Reader: Handle text selection
    Reader->>Popup: Show color picker
    
    User->>Popup: Choose color
    
    alt Highlight only
        User->>Popup: Click "Highlight"
        Popup->>Reader: Create highlight
        Reader->>Reader: Generate location (CFI for EPUB)
    else Add note
        User->>Popup: Click "Add note"
        Popup->>Reader: Switch to note input
        User->>Reader: Type note text
    end
    
    Reader->>Reader: Create HighlightDto
    Reader->>Bridge: overlayApi.saveHighlight(bookId, highlight)
    Bridge->>Main: overlay:saveHighlight IPC
    
    Main->>Db: INSERT INTO notes (book_id, location, note_json, ...)
    Db-->>Main: note.id
    
    Main-->>Bridge: { id, createdAt }
    Bridge-->>Reader: Saved highlight
    
    Reader->>Canvas: Render highlight on text
    Reader->>Reader: Update highlights list (sidebar)
    
    User->>Canvas: Hover over highlighted text
    Canvas->>Reader: Show HighlightContextMenu
    
    User->>Reader: Click "Edit" or "Delete"
    
    alt Edit
        Reader->>Popup: Show edit dialog
        User->>Popup: Change color or note
        Popup->>Bridge: overlayApi.saveHighlight(bookId, updated)
        Bridge->>Main: overlay:saveHighlight IPC
        Main->>Db: UPDATE notes SET note_json = ? WHERE id = ?
    else Delete
        Reader->>Reader: Show TrashConfirmDialog
        User->>Reader: Confirm delete
        Reader->>Bridge: overlayApi.deleteHighlight(bookId, highlightId)
        Bridge->>Main: overlay:deleteHighlight IPC
        Main->>Db: DELETE FROM notes WHERE id = ?
    end
    
    Db-->>Main: OK
    Main-->>Bridge: OK
    Bridge-->>Reader: Deleted
    Reader->>Canvas: Remove highlight from render
```

### UC-05: Quản lý Library (Metadata & Collections)

```mermaid
sequenceDiagram
    participant User as User
    participant Lib as SCR-01<br/>Library
    participant Dialog as Edit<br/>Metadata<br/>Dialog
    participant Menu as Book<br/>Menu
    participant Bridge as Bridge<br/>(libraryApi)
    participant Main as Electron Main
    participant Db as SQLite

    User->>Lib: Right-click book or click menu
    Lib->>Menu: Show BookItemMenu
    
    User->>Menu: Click "Edit metadata"
    Menu->>Dialog: Open EditBookMetadataDialog
    
    Dialog->>Dialog: Load current metadata
    User->>Dialog: Edit fields (title, author, genres, description)
    User->>Dialog: Click "Save"
    
    Dialog->>Bridge: libraryApi.updateMetadata(bookId, values)
    Bridge->>Main: library:updateMetadata IPC
    
    Main->>Db: UPDATE books SET title = ?, author_names = ?, ... WHERE id = ?
    Db-->>Main: OK
    
    Main-->>Bridge: OK
    Bridge-->>Dialog: OK
    Dialog->>Lib: Close dialog
    
    Lib->>Lib: Refresh book display
    Lib->>Lib: Update shelf items
    
    alt Toggle favorite
        User->>Menu: Click "Add to favorites"
        Menu->>Bridge: libraryApi.setFavorite(bookId, true)
        Bridge->>Main: library:setFavorite IPC
        Main->>Db: UPDATE books SET is_favorite = ? WHERE id = ?
        Db-->>Bridge: OK
    else Mark as completed
        User->>Menu: Click "Mark as completed"
        Menu->>Bridge: libraryApi.markAsCompleted(bookId)
        Bridge->>Main: library:markAsCompleted IPC
        Main->>Db: UPDATE books SET reading_status = 'completed' WHERE id = ?
        Db-->>Bridge: OK
    else Add to collection
        User->>Menu: Click "Add to collection"
        Menu->>Dialog: Show collection picker
        User->>Dialog: Select collection
        Dialog->>Bridge: libraryApi.addBookToCollection(bookId, collectionId)
        Bridge->>Main: library:addBookToCollection IPC
        Main->>Db: INSERT INTO collection_books (collection_id, book_id)
        Db-->>Bridge: OK
    end
    
    Bridge-->>Lib: Refresh
    Lib->>Lib: Update shelf counts & displays
```

### UC-06: Kết nối Cloud Sources

```mermaid
sequenceDiagram
    participant User as User
    participant Lib as SCR-01<br/>Library
    participant Cloud as Cloud<br/>Sources<br/>Hub
    participant Bridge as Bridge<br/>(cloudApi)
    participant Main as Electron Main
    participant OAuth as OAuth<br/>Provider<br/>(Google, etc.)
    participant Vault as Token<br/>Vault

    User->>Lib: Navigate to "Linked libraries"
    Lib->>Cloud: Open CloudSourcesHub
    
    User->>Cloud: Click "Connect Google Drive"
    Cloud->>Bridge: cloudApi.connect('google_drive')
    Bridge->>Main: cloud:connect IPC
    
    Main->>OAuth: Open OAuth login in native browser
    OAuth-->>User: Prompt for authorization
    
    User->>OAuth: Authorize app
    OAuth-->>Main: OAuth code / token
    
    Main->>Main: Handle OAuth redirect
    Main->>Vault: Store access token (token-vault)
    
    Main-->>Bridge: { provider: 'google_drive', accessToken: '...' }
    Bridge-->>Cloud: Connected
    
    Cloud->>Cloud: Update UI (show "Connected" status)
    
    alt Download & import from cloud
        User->>Cloud: Click "Download" on a catalog entry
        Cloud->>Bridge: cloudApi.downloadAndImport(provider, entry)
        Bridge->>Main: cloud:downloadAndImport IPC

        Main->>Db: findByProviderAndExternalId
        alt Already downloaded from this provider
            Main-->>Bridge: { errorCode: 'duplicate', bookId }
            Bridge-->>Lib: ImportConflictDialog (giống File/URL)
        else
            Main->>Vault: getValidAccessToken()
            Note over Main,Vault: không có token → not_connected → Toast [Connect]
            Main->>OAuth: provider download API (with token)
            loop each chunk
                Main-->>Cloud: cloud:downloadProgress (ring + bytes, nút Cancel)
            end
            Note over Main: User Cancel (cloud:cancelDownload) → cancelled · không có byte trong 30s → timeout
            Main->>Main: importDownloadedFile(temp) — cùng pipeline với UC-02 sau khi tải
            Main-->>Bridge: { ok | errorCode }
            Bridge-->>Cloud: Toast success [Open] · network/timeout/save_failed → Toast [Retry]
        end
    else Disconnect
        User->>Cloud: Click "Disconnect"
        Cloud->>Bridge: cloudApi.disconnect('google_drive')
        Bridge->>Main: cloud:disconnect IPC
        
        Main->>Vault: Delete token
        Main-->>Bridge: OK
    end
```

### UC-07: Tìm kiếm trong Sách

```mermaid
sequenceDiagram
    participant User as User
    participant Reader as SCR-03<br/>Reader
    participant Panel as Search<br/>Panel
    participant Bridge as Bridge<br/>(searchApi)
    participant Main as Electron Main
    participant Index as Book<br/>Indexer
    participant Db as SQLite<br/>(FTS5)

    User->>Reader: Click search icon
    Reader->>Panel: Open ReaderSearchPanel
    
    User->>Panel: Type search query
    Panel->>Reader: onChange(query)
    Reader->>Bridge: requestReaderSearch(query)
    Bridge->>Bridge: Debounce 300ms
    
    Bridge->>Bridge: Check if book is indexed
    Bridge->>Main: bookIndex:ensure IPC
    Main->>Index: Ensure book chunks exist
    
    alt Not indexed yet
        Index->>Db: Check if book chunks exist
        Db-->>Index: No chunks
        Index->>Main: Start background chunking
        Main->>Reader: bookIndex:status = 'indexing'
        Reader->>Panel: Show "Indexing book..."
        
        Index->>Index: Split book into chunks
        Index->>Db: INSERT chunks into FTS table
        
        Index->>Main: Indexing complete
        Main->>Reader: bookIndex:status = 'complete'
    else Already indexed
        Main->>Db: Chunks exist
    end
    
    Bridge->>Main: search:searchBook(bookId, query)
    Main->>Db: SELECT * FROM fts_chunks WHERE ... MATCH ?
    Db-->>Main: FTS results (rank, snippet, positions)
    
    Main->>Main: Format results (chapter label, location, snippet)
    Main-->>Bridge: { matches: [...], total }
    
    Bridge-->>Panel: Results
    Panel->>Panel: Render matches
    
    User->>Panel: Click result
    Panel->>Reader: Navigate to location
    Reader->>Reader: Update session location
    Reader->>Reader: Highlight search match
```

### UC-08: Dịch Văn bản

```mermaid
sequenceDiagram
    participant User as User
    participant Canvas as Reading<br/>Canvas
    participant Translator as Translation<br/>Popover
    participant Bridge as Bridge<br/>(translationApi)
    participant Main as Electron Main
    participant Worker as Translation<br/>Worker
    participant Download as Model<br/>Cache

    User->>Canvas: Select text to translate
    Canvas->>Translator: Show TranslationPopover
    
    User->>Translator: Choose target language
    Translator->>Bridge: translationApi.translate(text, targetLang)
    Bridge->>Main: translation:translate IPC + requestId
    
    Main->>Download: Check if model exists
    Download-->>Main: Model path or missing
    
    alt Model not cached
        Download->>Download: Download model
        Download->>Main: Model loaded
        Main->>Translator: translation:progress { status: 'downloading', percent }
        Translator->>Translator: Show download progress
    else Model cached
        Main->>Worker: Load model from cache
    end
    
    Main->>Worker: Spawn worker with text + model
    Worker->>Worker: Initialize translation engine
    Worker->>Worker: Translate text
    Worker-->>Main: Translated text
    
    Main->>Main: Cache result (optional)
    Main-->>Bridge: { translated, detectedLanguage }
    
    Bridge-->>Translator: Translated text
    Translator->>Translator: Show translation
    
    User->>Translator: Close or select next text
    
    alt Cancel pending request
        User->>Translator: Click X before translation finishes
        Translator->>Bridge: translationApi.cancel(requestId)
        Bridge->>Main: translation:cancel IPC
        Main->>Worker: Terminate worker
    end
```

---

## 5. Component Hierarchy

### LibraryScreen
```
LibraryScreen
├── [view === 'hub'] LibraryHub
│   ├── LibrarySidebar (status filters + Favorites)
│   └── Browse column
│       ├── LibraryTopBar (search + Add file / Import URL)
│       ├── BootErrorBanner (if bootError)
│       ├── LibraryEmptyState (if no books)
│       ├── ContinueReading (All books, no search)
│       ├── LibraryBrowseToolbar (title · count · Sort · Grid/Table)
│       ├── LibraryBookGrid → ShelfRailCard x N      (layout = grid)
│       └── LibraryBookTable + LibraryBookDetailPanel (layout = table)
├── [view === 'collections'] CollectionsHub
├── [view === 'collection'] ShelfDetailView → ShelfRailCard / ShelfDetailItem
├── [view === 'cloud-sources'] CloudSourcesHub
│
├── Dialogs
│   ├── LibraryBookInfoDialog
│   ├── EditBookMetadataDialog
│   ├── ConfirmBookActionDialog
│   ├── BookItemMenu (context menu)
│   ├── NewCollectionDialog
│   ├── CollectionsHub (sidebar)
│   ├── CloudSourcesHub (sidebar)
│   ├── ImportProgressDialog
│   ├── ImportConflictDialog
│   ├── ImportUrlDialog
│   └── ImportToast

└── (Behind scenes)
    └── useLibraryScreen (main logic)
        ├── useLibraryBooks (fetch & manage books)
        ├── useLibraryImport (import logic)
        ├── useCollections (collections logic)
        ├── useLibraryView (view state)
        ├── useCloudSources (cloud integrations)
        ├── useShelfOrder (reorder shelves)
        └── useSectionOrder (reorder sections)
```

### ReaderScreen
```
ReaderScreen
└── ReaderShell (layout container)
    ├── ReaderTopbar
    │   ├── Title
    │   ├── Tools menu
    │   └── More menu
    │
    ├── Content area
    │   ├── SidebarEdgeRail (left, collapsible)
    │   │   └── [activeTab]
    │   │       ├── TocSidebar (chapters)
    │   │       ├── NotesPanel (highlights/notes/bookmarks)
    │   │       └── BookmarksPanel
    │   │
    │   └── ReaderZoomViewport
    │       └── ReadingCanvas
    │           └── EpubRenderer (or PDF/Text renderer)
    │               └── [Document content]
    │
    ├── ReaderFooter
    │   ├── Location indicator
    │   ├── Reading time estimate
    │   └── Jump to location button
    │
    ├── Floating Panels (when active)
    │   ├── ReaderSearchPanel
    │   ├── WordCountPanel
    │   ├── ReadAloudMenu
    │   ├── TranslationPopover
    │   ├── SnapshotOverlay
    │   ├── AaSettingsPanel
    │   └── SignInfoPanel
    │
    ├── Dialogs
    │   ├── BookInfoDialog
    │   ├── TrashConfirmDialog
    │   ├── HighlightColorPicker
    │   ├── HighlightEditPopup
    │   ├── NoteTextboxPopup
    │   └── HighlightContextMenu
    │
    └── (Behind scenes)
        └── useReaderScreen (session wiring)
            ├── useReaderBookOpen (load book)
            ├── useReaderSessionBridge (sync session state)
            ├── useReaderHighlights (manage highlights)
            ├── useReaderSearch (FTS search)
            ├── useWordCount (word stats)
            ├── useReadAloud (TTS)
            ├── useReaderTranslation (translation)
            ├── useSnapshotTool (screenshot)
            ├── useBookIndexing (ensure indexed)
            ├── useReaderZoomControls (zoom)
            ├── useReaderChromeUi (chrome state)
            ├── useReaderNavigation (location updates)
            ├── useImmersiveReading (immersive mode)
            └── useGlobalReadingPrefs (reading preferences)
```

---

## 6. State Management

### Global State (Zustand stores)

```typescript
// App chrome state
useAppNav() → {
  currentNav: AppStubNavId
  registerLibraryNav: () => void
  // ...
}

useOpenReading() → {
  openBookId: string | null
  openBook: (bookId) => void
  ensureTab: (bookId) => void
  updateBookTitle: (bookId, title) => void
}

useAppTitle() → {
  documentTitle: string
  documentSubtitle: string
  setDocumentTitle: (title) => void
  setDocumentSubtitle: (subtitle) => void
  // ... search-related
}

// Reading preferences (per-app global)
useGlobalReadingPrefs() → {
  prefs: GlobalReadingPrefs
  setPrefs: (prefs) => void
}

// Immersive reading state
useImmersiveReading() → {
  immersive: boolean
  fullscreen: boolean
  toggleFullscreen: () => void
  exitFullscreen: () => void
}
```

### Local Screen State (useState)

```typescript
// Library
- searchQuery, setSearchQuery
- bookInfoId, setBookInfoId
- editMetadataId, setEditMetadataId
- bookMenu, setBookMenu
- pendingRemoval, setPendingRemoval
- toast, clearToast
- progress, conflict, urlDialog (import state — zustand `useLibraryImportStore`)
- view, activeShelf, activeCollection
- viewMode, setViewMode
- collections, newCollectionOpen, editingCollection
- filterConfig, hideEmptyShelves

// Reader
- readerSearchQuery, setReaderSearchQuery
- highlights, bookmarks (from useReaderHighlights)
- sessionState (from useReaderSessionBridge)
- zoomLevel (from useReaderZoomControls)
- highlightTool, annotationTool (active tool)
- sidebarOpen, activeSidebarTab
```

### Async Hooks (data fetching)

```typescript
// Library
useLibraryBooks() → {
  books: LibraryBook[]
  isLoading: boolean
  error: Error | null
  refetch: () => void
}

useCollections() → {
  collections: CollectionSummaryDto[]
  isLoading: boolean
  error: Error | null
}

// Reader
useReaderBookOpen(bookId) → {
  book: Book | null
  content: ArrayBuffer | null
  isLoading: boolean
  error: Error | null
}

useReaderSessionBridge(bookId) → {
  sessionState: ReadingSessionState | null
  saveSessionState: (state) => Promise<void>
}

useReaderHighlights(bookId) → {
  highlights: HighlightDto[]
  bookmarks: BookmarkDto[]
  saveHighlight: (h) => Promise<void>
  deleteHighlight: (id) => Promise<void>
}

useReaderSearch(bookId) → {
  searchQuery: string
  setSearchQuery: (q) => void
  results: SearchResult[]
  isLoading: boolean
  requestSearch: (q) => void
}
```

### IPC Bridges (typed API wrappers)

```typescript
// src/bridge/library.ts
libraryApi = {
  listBooks: () => Promise<BookSummaryDto[]>
  getBook: (id) => Promise<BookSummaryDto | null>
  openBookContent: (id) => Promise<OpenBookContentResult>
  markAsReading: (id) => Promise<void>
  markAsCompleted: (id) => Promise<void>
  setFavorite: (id, isFavorite) => Promise<void>
  updateMetadata: (id, values) => Promise<void>
  showInFolder: (id) => Promise<void>
  copyFilePath: (id) => Promise<void>
  removeBook: (id) => Promise<void>
  deleteBookFile: (id) => Promise<void>
  relinkBook: (id) => Promise<RelinkBookResult>
  checkSignature: (id) => Promise<CheckSignatureResult>
  listCollections: () => Promise<CollectionSummaryDto[]>
  createCollection: (values) => Promise<CollectionSummaryDto>
  updateCollection: (id, values) => Promise<void>
  deleteCollection: (id) => Promise<void>
  addBookToCollection: (bookId, collectionId) => Promise<void>
  removeBookFromCollection: (bookId, collectionId) => Promise<void>
}

// src/bridge/import.ts
importApi = {
  fromFile: () => Promise<ImportResult>          // Main owns the native dialog
  fromUrl: (url) => Promise<ImportResult>
  cancel: () => Promise<OkResult>                 // abort in-flight URL download
  onProgress: (handler) => () => void             // import:progress subscription
}

// src/bridge/overlay.ts
overlayApi = {
  getSessionState: (bookId) => Promise<ReadingSessionState>
  saveSessionState: (bookId, state) => Promise<void>
  listBookmarks: (bookId) => Promise<BookmarkDto[]>
  saveBookmark: (bookId, bookmark) => Promise<void>
  deleteBookmark: (bookId, bookmarkId) => Promise<void>
  listHighlights: (bookId) => Promise<HighlightDto[]>
  saveHighlight: (bookId, highlight) => Promise<void>
  deleteHighlight: (bookId, highlightId) => Promise<void>
}

// src/bridge/search.ts
searchApi = {
  searchBook: (bookId, query) => Promise<SearchResult>
}

// src/bridge/translation.ts
translationApi = {
  translate: (text, targetLang) => Promise<{ translated: string }>
  cancel: (requestId) => void
}

// src/bridge/app.ts
appApi = {
  ping: () => Promise<void>
  getAppInfo: () => Promise<AppInfo>
  getGoogleOAuthConfig: () => Promise<OAuthConfig>
  setChromeTheme: (theme) => Promise<void>
  getFullscreen: () => Promise<boolean>
  setFullscreen: (fullscreen) => Promise<void>
  toggleFullscreen: () => Promise<boolean>
  captureSnapshot: (region) => Promise<void>
  on: (channel, listener) => UnsubscribeFn
}

// src/bridge/cloud.ts
cloudApi = {
  connect: (provider) => Promise<{ provider, accessToken }>
  disconnect: (provider) => Promise<void>
  getAccessToken: (provider) => Promise<string>
  downloadAndImport: (provider, entry) => Promise<CloudDownloadResult>
  cancelDownload: (externalId) => Promise<OkResult>
  onDownloadProgress: (handler) => () => void
}
```

---

## 7. Data Flow Diagrams

### Data Flow: Book Import (File)

```
User clicks "Add file"
    ↓
importApi.fromFile()                      (no path from renderer)
    ↓ (IPC)
Main: native file dialog ── cancel ──→ { errorCode: 'cancelled' } → silent
    ↓ picked
import:progress { stage: 'importing' } → ImportProgressDialog
    ↓
[1] Validate extension            → unsupported_format
[2] Reject path inside userData   → inside_app_data
[3] Hash file (SHA-256)           → missing_file / access_denied
[4] Check duplicate in DB         → duplicate → ImportConflictDialog
[5] Parse metadata                → corrupted
[6] Verify signature              (non-fatal: stored as "not checked")
[7] INSERT book                   → save_failed
    ↓
{ ok: true, bookId } → refresh Library → Toast success [Open]
```

### Data Flow: Reading Session (Save)

```
User closes reader / app closes
    ↓
ReaderScreen: flushSession()
    ↓
useReaderSessionBridge.saveSessionState(state)
    ↓
overlayApi.saveSessionState(bookId, state)
    ↓ (IPC)
Main process: overlay:saveSessionState handler
    ↓
[1] Validate bookId
[2] Merge session state into books.reading_state_json
[3] UPDATE books SET reading_state_json = ? WHERE id = ?
    ↓
SQLite: JSON update committed
    ↓
overlayApi response (OK)
    ↓
Session saved ✓
```

### Data Flow: Highlight Search & Render

```
User selects text
    ↓
Canvas: handleTextSelection()
    ↓
Show HighlightColorPicker
    ↓
User chooses color & clicks "Highlight"
    ↓
overlayApi.saveHighlight(bookId, highlight)
    ↓ (IPC)
Main process: overlay:saveHighlight handler
    ↓
[1] Validate highlight data
[2] Generate highlight ID (UUID)
[3] INSERT INTO notes (book_id, note_json, location, ...)
    ↓
SQLite: Note inserted
    ↓
overlayApi response { id, createdAt }
    ↓
useReaderHighlights: Add to highlights list
    ↓
Canvas: Render highlight via renderer API
    ↓
User sees highlighted text ✓
```

---

## 8. Navigation & Routing

### App Router Structure

```typescript
// src/App.tsx (root router)
<BrowserRouter>
  <Routes>
    <Route path="/" element={<SplashScreen />} />
    
    <Route path="/library" element={<LibraryLayout />}>
      <Route index element={<LibraryScreen />} />
      <Route path="shelf/:shelfId" element={<LibraryScreen />} />
      <Route path="collection/:collectionId" element={<LibraryScreen />} />
    </Route>
    
    <Route path="/reader/:bookId" element={<ReaderLayout />}>
      <Route index element={<ReaderScreen />} />
    </Route>
    
    <Route path="/settings" element={<SettingsScreen />} />
  </Routes>
</BrowserRouter>
```

### Navigation Helpers

```typescript
// useAppNav() — main nav state
const { currentNav, registerLibraryNav } = useAppNav()

// useOpenReading() — book reader nav
const { openBook } = useOpenReading()
openBook(bookId) // navigate to /reader/:bookId

// useNavigate() — React Router
const navigate = useNavigate()
navigate('/library', { state: { openNav: 'collections' } })
navigate('/reader/book-id-123')
```

---

## 9. Error Handling & Edge Cases

### Import Errors

Mã lỗi là `ImportErrorCode` (`electron/ipc/api-types.ts`, đồng bộ với book-reader-sdk). Nguyên tắc:
**Dialog** chỉ khi cần user quyết định · **Inline** khi user phải sửa input của chính họ (URL) ·
**Toast** cho kết quả cuối · **Retry** chỉ cho lỗi tạm thời.

| Trạng thái / `errorCode` | Nguồn | UI | Retry | Hành động user | Sau đó |
|---|---|---|---|---|---|
| Success (`ok: true`) | File · URL · Cloud | Toast success + **[Open]** | — | Open / bỏ qua | Reader `/reader/:bookId` hoặc ở lại Library (đã refresh) |
| `duplicate` | File · URL · Cloud (SHA-256 hoặc cùng provider+externalId) | `ImportConflictDialog` | — | Open existing / Discard | Reader hoặc Idle |
| `unsupported_format` | File · URL · Cloud | Toast error | — | — | Idle |
| `corrupted` (parse/metadata lỗi) | File · URL · Cloud | Toast error | — | — | Idle; bản copy app-owned (URL/Cloud) đã xoá |
| `access_denied` (EACCES/EPERM) | File | Toast error | — | Chọn file khác | Idle |
| `missing_file` (ENOENT) | File | Toast error | — | — | Idle |
| `inside_app_data` | File | Toast error | — | Chọn file ngoài thư mục data của app | Idle |
| `network` | URL | Inline trong `ImportUrlDialog` (giữ URL) | **Retry** | Retry / sửa URL / Cancel | Downloading |
| `network` | Cloud | Toast error + **[Retry]** | **Retry** | Retry | Downloading |
| `timeout` (không nhận byte trong 30s) | URL · Cloud | như `network` | **Retry** | Retry | Downloading |
| `http_status` | URL | Inline + Retry | **Retry** | Retry / sửa URL | Downloading |
| `scheme` · `too_large` · `not_direct_file` | URL | Inline (giữ URL) | — | Sửa URL / Cancel | UrlInput |
| `save_failed` (copy sandbox / ghi DB) | URL · Cloud | Toast error + **[Retry]** | **Retry** | Retry | Downloading |
| `save_failed` | File | Toast error | — | Thử lại thủ công | Idle |
| `not_connected` | Cloud | Toast error + **[Connect]** | — | Connect | OAuth flow |
| `cancelled` — đóng picker / dialog URL | File · URL | Không hiện gì | — | — | Idle |
| `cancelled` — huỷ khi đang tải | URL · Cloud | Toast info "Download cancelled." | — | — | Idle (temp đã xoá) |
| Signature check lỗi | File · URL · Cloud | **Không chặn import**, không báo lúc import | — | — | Success; Reader hiện "chưa kiểm tra" và kiểm tra lại khi mở |

Ghi chú:
- Progress overlay chỉ hiện **sau khi** đã chọn file (Main gửi `import:progress`) — không bao giờ che native picker.
- Chỉ có Cancel trong giai đoạn **downloading**; giai đoạn importing ngắn và không huỷ được.
- Cloud SDK không hỗ trợ abort: khi huỷ/timeout, Main trả kết quả ngay và dọn temp khi lượt tải nền kết thúc.

### Import state machine

```
Idle
 ├─ Add file ──▶ Picking ──cancel──▶ Idle (silent)
 │                  └─ picked ─▶ Importing
 ├─ Import URL ─▶ UrlInput ──cancel──▶ Idle
 │                  └─ submit ─▶ Downloading ──Cancel──▶ Idle + toast info
 │                                 ├─ network | timeout | http_status ─▶ UrlInput[error, Retry]
 │                                 ├─ scheme | too_large | not_direct_file ─▶ UrlInput[error]
 │                                 └─ downloaded ─▶ Importing
 └─ Cloud Download ─▶ (not_connected ─▶ Idle + toast[Connect])
                      └─ Downloading ──Cancel──▶ Idle + toast info
                            ├─ network | timeout ─▶ Idle + toast[Retry]
                            └─ downloaded ─▶ Importing

Importing  (format → access → dedup → metadata → signature (non-fatal) → persist)
 ├─ ok                                  ─▶ Success   ─▶ toast[Open] ─▶ Idle | Reader
 ├─ duplicate                           ─▶ Duplicate ─▶ ConflictDialog ─▶ Open: Reader | Discard: Idle
 ├─ unsupported_format | corrupted      ─▶ Failed    ─▶ toast ─▶ Idle
 ├─ access_denied | missing_file | inside_app_data ─▶ Failed ─▶ toast ─▶ Idle
 └─ save_failed                         ─▶ Failed    ─▶ toast[Retry] (URL/Cloud) ─▶ Downloading | Idle
```

### Reader Errors

| Error | User Flow |
|-------|-----------|
| `missing-file` | ReaderOpenStatus: "File not found. [Locate file] button" |
| `path-denied` | ReaderOpenStatus: "No permission to read file" |
| `format-error` | Toast: "Failed to open book" |
| `signature-invalid` | SignInfoPanel: "Book signature is invalid" |

### Session Management

```typescript
// Flush session on app close
app.on('before-quit', () => {
  ipcMain.emit('app:requestFlushSession')
  // Wait for renderer to flush or timeout
  // Then save session state to DB
  // Then exit
})

// Handle window close
mainWindow.on('close', (e) => {
  e.preventDefault()
  ipcMain.emit('app:requestFlushSession')
  // After flush, app.quit()
})
```

---

## 10. Accessibility & Keyboard Shortcuts

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Search in book | Ctrl+F |
| Translate | Ctrl+T |
| Fullscreen | F11 |
| Immersive mode | Esc |
| Highlight | Ctrl+H |
| Search library | Ctrl+L |
| Open settings | Ctrl+, |
| Next page | Page Down / Right |
| Prev page | Page Up / Left |

### ARIA & Semantic HTML

- All dialogs have `role="dialog"` and `aria-labelledby`
- Buttons have descriptive labels
- Forms have associated `<label>`
- Icons have `aria-label`
- Modals trap focus

---

## 11. Performance Considerations

### Virtualization
- **Library shelves:** Virtualize shelf items (hundreds of books)
- **Notes panel:** Virtualize notes list (can be large)

### Code Splitting
- Reader screen code-split from Library
- Settings screen code-split
- Format renderers loaded on-demand

### Optimization
- Memoize shelf components (expensive sorting)
- Lazy-load book covers (intersection observer)
- Debounce search queries (300ms)
- Batch SQLite queries (e.g., listBooks)

---

**End of document**
