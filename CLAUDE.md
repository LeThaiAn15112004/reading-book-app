# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Local-first reading app ("reading-book-app"). MVP focus is the **desktop app** (Electron + Vite + React +
TypeScript); a mobile app (Expo + React Native) exists only as an early scaffold and is not yet built out.
Product/UX rationale lives in `docs/reading-habbit/`; the authoritative architecture and data-model spec is
`docs/software/SDS.md` (Vietnamese) — read it before making structural changes, since this file only summarizes it.

## Repository structure

```
source/                          # npm workspaces root (workspaces: apps/*, packages/*)
├── apps/
│   ├── reading-book-desktop/    # MVP app — Electron main/preload + React renderer
│   └── reading-book-mobile/     # Expo Router scaffold, not yet wired to shared packages
└── packages/
    ├── domain/                  # Domain models + port interfaces (no I/O, no framework deps)
    ├── shared/                  # Domain helpers + application use cases (platform-agnostic)
    └── config/                  # Shared config (theme/formats/feature flags)
```

Inside `reading-book-desktop`:

```
electron/            # Infrastructure — Main + Preload processes
├── main.ts / preload.ts
├── ipc/              # channel constants + per-feature handlers (registered in ipc/index.ts)
├── persistence/      # better-sqlite3 db + numbered .sql migrations + sqlite-*-store.ts
├── adapters/          # DocumentImporter implementations per file format
├── files/             # book-path validation (managed/referenced), URL·cloud copy, relink, cover:// protocol
├── security/          # token-vault.ts (cloud OAuth token storage)
└── config/ theme/     # google-oauth-config.ts, native titlebar theming

src/                 # Presentation — Renderer (React)
├── bridge/            # thin typed wrappers around window.api (one per IPC feature)
├── screens/           # Library, Reader, Settings, Splash
├── reader/            # reader shell, renderers/ (per format), overlays/, annotations/, typewriter/
├── components/, chrome/, theme/, styles/, utils/
```

## Commands

Desktop app (`cd source/apps/reading-book-desktop`):
- `npm run dev` — Vite + Electron dev server
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint (`--max-warnings 0`, fails on unused eslint-disable directives)
- `npm run build` — `tsc && vite build && electron-builder`
- `npm run preview` — preview built renderer
- Spikes (standalone node scripts under `spikes/`, not part of the app build):
  `spike:epub:fixture`, `spike:epub:eval`, `spike:overlay:cfi`, `spike:session:roundtrip`, `spike:theme:contrast`,
  `spike:signature:status` (signature-status checks; fixtures via `spike:signature:fixtures`, needs `openssl`)

Mobile app (`cd source/apps/reading-book-mobile`): `npm run start`, `android`, `ios`, `web`, `lint`.

**There is no test runner configured anywhere in the repo** (no `*.test.*` files, no vitest/jest config, no `test`
script) — don't assume a test suite exists or try to run one.

## Architecture

The system is **Layered** (Presentation → Application → Domain → Infrastructure) with **Ports & Adapters** at the
format/AI/sync boundaries, running across Electron's Main/Preload/Renderer processes. Full rationale, layer diagrams,
and the ERD are in `docs/software/SDS.md` §2–3.

Dependency rule (enforced by convention, not tooling): `packages/domain` and `packages/shared` must never import
`electron`, `better-sqlite3`, or any format engine (`epubjs`, PDF libs, etc.) — those only exist inside
`apps/reading-book-desktop/electron/**` and `src/reader/renderers|overlays`. Screens/components never touch SQL or
`fs` directly; they call a use case or the IPC bridge.

| Layer | Where |
|---|---|
| Presentation | `apps/*/src/screens`, `components`, `reader/**` |
| Application (use cases) | `packages/shared/services/*` |
| Domain (models + ports) | `packages/domain/models/*`, `packages/domain/ports/*` |
| Infrastructure (desktop) | `apps/reading-book-desktop/electron/**` |

### IPC (Main ↔ Renderer)

The renderer never gets raw filesystem paths or talks to SQLite directly — everything crosses through
`window.api`, assembled in three places that must stay in sync:

1. `electron/ipc/channels.ts` — channel name constants grouped by feature (`AppChannels`, `LibraryChannels`,
   `ImportChannels`, `CloudChannels`, `OverlayChannels`). Preload may only invoke channels listed here.
2. `electron/ipc/<feature>.ipc.ts` — the Main-side handler, registered via `registerAllIpcHandlers()` in
   `electron/ipc/index.ts`.
3. `electron/preload.ts` — exposes the channel through `contextBridge`, typed by the `DesktopApi` interface in
   `electron/ipc/api-types.ts`.
4. `src/bridge/<feature>.ts` — thin typed wrapper the renderer actually imports (re-exported from `src/bridge/index.ts`).

DTOs in `api-types.ts` (suffixed `Dto`) are separate, structured-clone-safe plain objects — domain model instances
(`packages/domain/models`) never cross the IPC boundary directly.

### Document format adapters

Each supported format (epub, pdf, txt, md, docx, doc) is a `DocumentImporter` implementation in
`electron/adapters/<fmt>.adapter.ts`, registered by `DocumentFormat` enum key in
`electron/adapters/importer-registry.ts`. Adding a format means: new adapter file + registry entry, a matching
renderer under `src/reader/renderers/<fmt>/`, and registration in `packages/shared/readers` / `packages/config`.
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
`books.sha256` is a fingerprint, not a signature. See `docs/implementation_plan/book_signature_status.md`.

Core invariant: **the book file is never mutated.** All highlights/notes/bookmarks/session state are
written to separate SQLite "overlay" tables keyed by `bookId`.

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
  Full write-up: `docs/implementation_plan/file_centric_import_architecture.md`.

### Location model

A reading position is a polymorphic `Location` (CFI for EPUB, page-rect for PDF, text-offset for others), converted
via the `LocationCodec` port per format. Renderer/UI code for a given format is the only place allowed to know its
concrete location representation.

### Cloud sources

`electron/ipc/cloud.ipc.ts` handles OAuth-based linking for Google Drive / Dropbox / OneDrive
(`CloudProviderDto`). Tokens are stored via `electron/security/token-vault.ts`, never exposed to the renderer;
the renderer only receives short-lived access tokens, opaque `rb-cover://` cover URLs, and binary payloads
(`OpenBookContentResult`) — never real filesystem paths.

### Path aliases

`@reading-book/shared`, `@reading-book/domain`, `@reading-book/config` resolve to `../../packages/*` — defined in
both `tsconfig.json` (`compilerOptions.paths`) and `vite.config.ts` (`resolve.alias`, and duplicated for the
Electron main-process build). Keep both in sync when adding a new shared package.

### AI / external-library sync

Both are designed as ports (`AiProvider`, `ExternalLibraryConnector`, `SyncService` in `packages/domain/ports`) with
only `NoOp*` implementations currently wired — they are intentionally unimplemented stubs for a later phase, not
missing code.
