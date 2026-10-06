# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Local-first reading app ("reading-book-app"). MVP focus is the **desktop app** (Electron + Vite + React +
TypeScript); shared platform-agnostic logic lives in `book-reader-sdk`; a mobile app (Expo + React Native) exists only
as an early scaffold and is not yet built out.
Product/UX rationale lives in `docs/reading-habbit/`; the authoritative architecture and data-model spec is
`docs/software/SDS.md` (Vietnamese) — read it before making structural changes, since this file only summarizes it.
Feature write-ups live in `docs/change_plan/` and `docs/implementation_plan/`.

## Repository structure

```
source/                          # npm workspaces root (workspaces: apps/*, packages/*)
├── apps/
│   ├── book-reader-sdk/         # @reading-book/book-reader-sdk — platform-agnostic core (see its README.md)
│   │   ├── src/                 # domain, domain-ports, ports, services (use cases), stores, cfi, epub,
│   │   │                        #   annotations, persistence codecs, text, pagination, app-models…
│   │   ├── host-adapters/       # Node-side adapters outside the core (cloud providers, translation engine)
│   │   └── examples/ dist/      # sample hosts; built self-contained bundle
│   ├── reading-book-desktop/    # MVP app — Electron main/preload + React renderer
│   └── reading-book-mobile/     # Expo Router scaffold, not yet built out
└── packages/
    └── config/                  # @reading-book/config — formats, theme tokens, feature flags, OAuth config
```

There is **no** `packages/domain` or `packages/shared` any more — both were folded into `book-reader-sdk`.

Inside `reading-book-desktop`:

```
electron/            # Infrastructure — Main + Preload processes
├── main.ts / preload.ts
├── ipc/              # channel constants + per-feature handlers (registered in ipc/index.ts)
├── persistence/      # better-sqlite3 db + numbered .sql migrations + sqlite-*-store.ts
├── adapters/         # DocumentImporter implementations per file format + URL fetcher
├── files/            # book-path validation (managed/referenced), URL·cloud copy, relink, cover:// protocol
├── signature/        # PDF signature verification (status only)
├── background/       # System Tray + Run in Background prefs, isQuitting flag, close/hide decision, Start at Login
├── notifications/ reminders/  # Main-owned notification prefs; Reading Reminder worker (local time, SQLite)
├── prefs/            # atomic JSON prefs files under {userData} (Main-owned preferences)
├── chunking/ search/ # book text → FTS chunks; full-text search queries
├── storage/ updates/ # Settings → Storage (sizes, cleanup); update checks
├── translation/ wordcount/  # on-device translation worker + models; word-count stats
├── security/ oauth/  # token-vault.ts (cloud OAuth token storage); OAuth flow
└── config/ theme/    # OAuth config, native titlebar theming

src/                 # Presentation — Renderer (React)
├── bridge/           # thin typed wrappers around window.api (one per IPC feature)
├── screens/          # Library, Reader, Settings, Splash — each with components/ + logic/ (zustand stores, hooks)
├── hooks/            # app/ library/ reader/ — hooks + stores shared across screens
├── reader/           # renderers/ (per format), chrome/, interaction/, pageturn/, tts/
├── theme/            # app appearance (theme mode, accent, density, language) + applyTheme
├── components/, chrome/, styles/, utils/
```

## Commands

From the repo root (after `npm install` there once): `npm run dev` runs desktop + mobile together via `concurrently`;
`npm run dev:desktop` / `npm run dev:mobile` run one platform.

Desktop app (`cd source/apps/reading-book-desktop`):
- `npm run dev` — Vite + Electron dev server
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint (`--max-warnings 0`, fails on unused eslint-disable directives)
- `npm run build` — `tsc && vite build && electron-builder` (`npx vite build` alone checks the bundle without packaging)
- `npm run preview` — preview built renderer
- Spikes (standalone node scripts under `spikes/`, not part of the app build):
  `spike:epub:fixture`, `spike:epub:eval`, `spike:overlay:cfi`, `spike:session:roundtrip`, `spike:theme:contrast`,
  `spike:signature:status` (signature-status checks; fixtures via `spike:signature:fixtures`, needs `openssl`),
  `spike:settings:reset` (Reset App Settings checks against the real renderer stores),
  `spike:settings:notifications` (Enable Notifications toggle + permission flow),
  `spike:settings:background` (tray / close-to-hide / quit flag / login item, Main modules with a stubbed `electron`),
  `spike:settings:reminders` (Reading Reminder rules at UTC+7, SQLite on the real schema, minute-aligned worker)

SDK (`cd source/apps/book-reader-sdk`): `npm run typecheck`, `npm run build`, `npm run verify` (typecheck + build +
example-host typecheck + Node example run).

Mobile app (`cd source/apps/reading-book-mobile`): `npm run start`, `android`, `ios`, `web`, `lint`.

**There is no test runner configured anywhere in the repo** (no `*.test.*` files, no vitest/jest config, no `test`
script) — don't assume a test suite exists or try to run one. Checks are the standalone spike scripts above.

## Architecture

The system is **Layered** (Presentation → Application → Domain → Infrastructure) with **Ports & Adapters** at the
format/AI/sync boundaries, running across Electron's Main/Preload/Renderer processes. Full rationale, layer diagrams,
and the ERD are in `docs/software/SDS.md` §2–3.

Dependency rule: `book-reader-sdk/src` must never import `electron`, `better-sqlite3`, Node/DOM APIs, React or any
format engine (`epubjs`, PDF libs, etc.) — its tsconfig (`lib: ES2022`, `types: []`) makes a violation a compile
error. Those only exist inside `apps/reading-book-desktop/electron/**`, `src/reader/renderers`, and
`book-reader-sdk/host-adapters` (Node-side, imported by the desktop Main process). Screens/components never touch
SQL or `fs` directly; they call a use case or the IPC bridge.

| Layer | Where |
|---|---|
| Presentation | `apps/reading-book-desktop/src/screens`, `components`, `reader/**`, `hooks/**` |
| Application (use cases + stores) | `book-reader-sdk/src/services/*`, `book-reader-sdk/src/stores/*` |
| Domain (models + ports) | `book-reader-sdk/src/domain/*`, `src/domain-ports/*` (domain ports), `src/ports/*` (host I/O ports) |
| Infrastructure (desktop) | `apps/reading-book-desktop/electron/**`, `book-reader-sdk/host-adapters/**` |

### IPC (Main ↔ Renderer)

The renderer never gets raw filesystem paths or talks to SQLite directly — everything crosses through
`window.api`, assembled in four places that must stay in sync:

1. `electron/ipc/channels.ts` — channel name constants grouped by feature (`AppChannels`, `LibraryChannels`,
   `ImportChannels`, `CloudChannels`, `OverlayChannels`, `BookIndexChannels`, `SearchChannels`, `UpdateChannels`,
   `StorageChannels`, `TranslationChannels`, `WordCountChannels`, `NotificationChannels` (incl. reminders),
   `BackgroundChannels`). Preload may only invoke channels listed here.
2. `electron/ipc/<feature>.ipc.ts` — the Main-side handler, registered via `registerAllIpcHandlers()` in
   `electron/ipc/index.ts`.
3. `electron/preload.ts` — exposes the channel through `contextBridge`, typed by the `DesktopApi` interface in
   `electron/ipc/api-types.ts`.
4. `src/bridge/<feature>.ts` — thin typed wrapper the renderer actually imports (re-exported from `src/bridge/index.ts`).

DTOs in `api-types.ts` (suffixed `Dto`) are separate, structured-clone-safe plain objects — domain model instances
(`book-reader-sdk/src/domain`) never cross the IPC boundary directly.

### Document format adapters

Each supported format (epub, pdf, txt, md, docx, doc) is a `DocumentImporter` implementation in
`electron/adapters/<fmt>.adapter.ts`, registered by `DocumentFormat` enum key in
`electron/adapters/importer-registry.ts`. Adding a format means: new adapter file + registry entry, a matching
renderer under `src/reader/renderers/<fmt>/`, and a `SUPPORTED_FORMATS` entry in `packages/config/formats.ts`.
Domain/port code only ever deals with `DocumentImporter` / `DocumentRenderer` / `Location` — never format specifics.

### Persistence & the read-only/overlay invariant

`better-sqlite3`, schema versioned as numbered SQL files in `electron/persistence/migrations/` (currently
001–022: books, genres, comments, collections, reading sessions, notes/annotations, reading status, cloud
provenance, FTS chunks, signature status), run through `migrate.ts`. `sqlite-library-store.ts` and
`sqlite-overlay-store.ts` implement the domain's `LibraryStore`/`CollectionStore`/`OverlayStore` ports.

**Signature status (verification only):** `books.metadata_json.signatureStatus` (`unsigned|valid|invalid|unsupported`;
absent = not checked) is the single source of truth — the app detects whether a book is signed, it never signs.
PDF signatures are verified in `electron/signature/`; EPUB and other formats report `unsupported`. A cached result
is reused only while the file's current SHA-256 equals `signatureCheckedSha256`. Annotations are not signatures and
`books.sha256` is a fingerprint, not a signature. See `docs/change_plan/book_signature_status.md`.

Per-book reading state (position, percent, and that book's font/size/line-height/align/layout/margin overrides)
lives in `books.reading_state_json`, written via `overlay:saveSessionState`.

Core invariant: **the book file is never mutated.** All highlights/notes/bookmarks/session state are
written to separate SQLite "overlay" tables / columns keyed by `bookId`.

**Reference-based library:** a book picked from the user's filesystem is *not* copied — `books.file_path` is the
user's own absolute path (`referenced`). Only URL/cloud downloads (no lasting file on disk) and books imported
before this change live as app-owned copies under `{userData}/books/{uuid}/` (`managed`). The kind is derived from
the path (`bookFileStorage` in `electron/files/sandbox.ts`), not stored. Rules that follow:
- Never delete a referenced book's file or its folder; `removeManagedBookDir` refuses anything that isn't
  `{sandbox}/{uuid}/file`. "Delete file" is only offered for `managed` books.
- Read book files through `resolveBookFile` (validates path + format extension, follows symlinks, distinguishes
  `missing_file` from `path_denied`); never write next to a book file. Covers go to `{userData}/covers/`.
- A moved file is recoverable: `library:relinkBook` opens a native dialog in Main and re-attaches the book only if
  the file's SHA-256 equals `books.sha256`. The renderer only ever passes a `bookId`, never a path.
- Import sources: local file → reference in place (hash → duplicate check → metadata → persist, never copied);
  URL / cloud → temp download → hash → duplicate check → `copyIntoBooksSandbox` → metadata → persist → temp removed.
  Full write-up: `docs/change_plan/file_centric_import_architecture.md`.

### App preferences (renderer localStorage)

Application-level preferences are **not** in SQLite (migration 005 dropped `app_settings`) and do not cross IPC:
each renderer zustand store owns its own `localStorage` key and defaults — e.g. Appearance
(`src/theme/appAppearance.ts`, `DEFAULT_APP_APPEARANCE`), Library sort/layout
(`screens/Library/logic/libraryBrowseStore.ts`, `DEFAULT_LIBRARY_BROWSE_PREFS`), global reading defaults
(`readmate.globalReadingPrefs.v1`, `DEFAULT_GLOBAL_READING_PREFS` in the SDK). Settings → Advanced → Reset App
Settings calls each store's `reset()` via `screens/Settings/logic/resetAppSettings.ts`; a new resettable group adds a
line to `APP_SETTINGS_RESETTERS` (resetters may be async). See `docs/implementation_plan/reset_app_settings.md`.

Exceptions owned by **Main** (JSON files under `{userData}` via `electron/prefs/json-prefs-file.ts`; the renderer
stores only mirror them over IPC): **Background / System Tray** (`background-prefs.json`, defaults in
`electron/background/background-prefs.ts`) because the tray and the window's close button need them before / without
the renderer; **Notifications + Reading Reminders** (`notification-prefs.json`, `DEFAULT_NOTIFICATION_PREFS` in
`electron/notifications/notification-prefs.ts`) because the reminder worker runs in Main; **Start at Login** is the OS
login item itself. Reminder rules use LOCAL time only and query SQLite through the shared connection; see
`docs/implementation_plan/reading_reminders_start_at_login.md`. Every quit path must go through the `isQuitting` flag (`electron/background/background-mode.ts`, raised by
`before-quit`, `quitApp()` and OS shutdown hooks); the close handler in `main.ts` follows `decideWindowClose()` and
always flushes the reading session before closing *or* hiding. See `docs/implementation_plan/background_system_tray.md`.

### Location model

A reading position is a polymorphic `Location` (CFI for EPUB, page-rect for PDF, text-offset for others), converted
via the `LocationCodec` port per format. Renderer/UI code for a given format is the only place allowed to know its
concrete location representation.

### Cloud sources

`electron/ipc/cloud.ipc.ts` handles OAuth-based linking for Google Drive / Dropbox / OneDrive
(`CloudProviderDto`), using the provider clients in `book-reader-sdk/host-adapters/services/*`. Tokens are stored
via `electron/security/token-vault.ts`, never exposed to the renderer; the renderer only receives short-lived access
tokens, opaque `rb-cover://` cover URLs, and binary payloads (`OpenBookContentResult`) — never real filesystem paths.

### Path aliases

`@reading-book/config` → `../../packages/config` and `@reading-book/book-reader-sdk` → `../book-reader-sdk/src/index.ts`
(the desktop consumes SDK source, not `dist/`) — defined in both `tsconfig.json` (`compilerOptions.paths`) and
`vite.config.ts` (`resolve.alias`, duplicated for the Electron main-process build). Keep both in sync. The mobile
app maps the SDK in its `tsconfig.json`, but its `babel.config.js` still aliases the removed `@reading-book/shared`.

### AI port

`AiProvider` is a port in `book-reader-sdk/src/domain-ports`; only `NoOpAiProvider` exists — an intentionally
unimplemented stub for a later phase, not missing code. (`ExternalLibraryConnector` also ships a
`NoOpExternalLibraryConnector` default; real cloud access goes through the host adapters above.)
