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
│   │   └── tests/ dist/         # vitest unit + integration tests; built self-contained bundle
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
  `spike:settings:reminders` (Reading Reminder rules at UTC+7, SQLite on the real schema, minute-aligned worker),
  `spike:reader:toolbar` (capability-driven Reader toolbar: per-surface tools, fold order, handler wiring),
  `spike:pdf:annotations` (PDF text annotations: real `overlay:*` IPC + SQLite store on the migrated schema),
  `spike:pdf:embedded` (embedded PDF annotation import: real pdf.js scan → SQLite ledger),
  `spike:pdf:live` (live sync: watcher on real temp files, `/NM` reader, sync service, SQLite),
  `spike:pdf:export` (incremental writer + export flow, pdf.js read-back), `spike:pdf:two-way` (two-way coordinator on
  real files), `spike:pdf:compat-kit -- <dir> [--samples <dir>]` (manual cross-reader test kit, incl. `attachments/` for file attachments),
  `spike:txt:main` (TXT reader, Main side: codec, edited copy, `txt:*` IPC, SQLite incl. migration 025, on real temp files),
  `spike:txt:store` (the real renderer TXT store against the real Main service: save loop, failures, switching books),
  `spike:audio:main` (audiobook MP3, Main side: importer, `rb-audio` stream handler Range/416/path checks, 512 MB streaming, progress),
  `spike:pdf:attachments` (PDF embedded attachments: real pdf.js on generated PDFs, Main service on temp files, the real renderer store; OS opener / save dialog mocked; incl. `rm-<uuid>` ids),
  `spike:pdf:attachment-memory` (file attachments: M0 memory matrix in a worker with the app's heap limit + SC-004 / SC-005 timings; `-- --quick`, `-- --sc`),
  `spike:pdf:attachment-write` (file attachments, Main side on real temp files: attach, size refusals, unwritable PDFs, injected ENOSPC / EIO / EPERM, verify failure, file changed meanwhile, move / delete, live sync, hostile PDFs; picker stubbed),
  `spike:pdf:attachment-store` (the real renderer `pageAttachmentsStore` + `pdfHighlightsStore` against the real Main operations: create, cancel, refusals, signed PDF, move + undo / redo, delete, book switch),
  `spike:audio:store` (the real renderer audio player store with a scriptable `Audio`),
  `spike:audio:zip` (audiobook ZIP import preview, Main side: bounded ZIP reader, path/size safety, inspect → confirm on synthetic ZIPs),
  `spike:audio:zip-import` (the real ZIP import stage: extract/validate/hash/place + one SQLite transaction, duplicates, one-track path, rollback, cancel, `.partial` sweep, remove audiobook),
  `spike:audio:zip-store` (the renderer ZIP import store: "Import" closes the dialog and runs a background job — spinner entry, progress, result panel, cancel, retry),
  `spike:audio:chapters` (`persistImportedAudiobook` / `listAudioChapters` atomicity on the migrated schema),
  `spike:pdf:shapes` (Shape tools: rows in the shared annotation table, written as standard Square/Circle/Line (+arrow end), real sync + files),
  `spike:pdf:shape-store` (the real renderer annotation / history / prefs stores for shapes against Main IPC + SQLite),
  `spike:pdf:graphics` (graphic objects inside a PDF — Square/Circle/Ink/Line/FreeText made by other readers: real scan, resize/colour/delete as one incremental update, read-back verified),
  `spike:audio:migration` (migration 026 on a populated DB with the real better-sqlite3 + FTS5; re-launches itself with the app's
  Electron binary in `ELECTRON_RUN_AS_NODE` mode — no window — because better-sqlite3 is built for Electron's ABI),
  `spike:transcription:main` (audiobook transcription, Main side on the migrated schema with fake decoder / speech / library: queue, watchdog, cancel / resume / recovery after a real process kill, search, export, speech-model removal),
  `spike:transcription:store` (the real renderer transcript store + the real audio player store against the real service),
  `spike:transcription:sidebar` (the text reader's sidebar is unchanged by the Transcript tab),
  `spike:transcription:ffmpeg` (the real bundled FFmpeg: every imported format decoded with the app argv, missing / changed / un-loadable binary; env vars in its header),
  `spike:transcription:smoke` (the real Whisper process and model: load offline, abort, kill, recovery; criterion 4 is a documented non-blocking limitation),
  `spike:annotations:main` (annotation import / export, Main side: the real export and import services on the real stores and migrated schema, stubbed dialog / file read / PDF scan — round trip per format, rollback, stale preview, target choice, different editions, readable copy),
  `spike:annotations:store` (the real renderer annotation-transfer store against the real Main services: preview → confirm, refusals, target choice, reload of the open book),
  `spike:annotations:perf` (SC-001 / SC-004 figures on the real better-sqlite3: re-launches itself with the app's Electron binary in `ELECTRON_RUN_AS_NODE` mode; fails when a figure is over its limit)

SDK (`cd source/apps/book-reader-sdk`): `npm run typecheck`, `npm test` (vitest, single file:
`npx vitest run tests/text/chunk-text.test.ts`), `npm run test:watch`, `npm run typecheck:tests`, `npm run build`,
`npm run verify` (typecheck + test typecheck + tests + build).

Mobile app (`cd source/apps/reading-book-mobile`): `npm run start`, `android`, `ios`, `web`, `lint`.

**CI** (`.github/workflows/ci.yml`, every push and PR, Ubuntu, `npm ci` in `source/`): SDK typecheck, test
typecheck, tests, build; desktop typecheck and lint. Keep all six green locally before pushing.

**E2E is manual-only.** Desktop E2E (`npm run e2e` / `e2e:only`, Playwright driving the built Electron app) runs on a
throw-away `userData` folder and, by default, in **hidden mode**: the window is rendered off-screen (Electron offscreen
rendering, `E2E_HIDDEN` in `electron/main.ts`) and never shown, so a run does not take over the desktop or steal focus.
Set `READMATE_E2E_SHOW=1` to watch it in a real window (`spike:e2e:launch` is always a visible window and grabs focus).
Nothing in `dev`, Vite/HMR, git hooks or CI runs it, and an agent must not run it after edits or as routine
verification — only when the user asks or the task is E2E itself. Default checks: `typecheck`, `lint`,
`e2e:typecheck` (compile only), SDK `npm test`, `npx vite build`. `.claude/settings.local.json` lists the E2E
commands under `permissions.ask` so they always prompt.

**Unit tests exist only in `book-reader-sdk`** (vitest, `node` environment, files under `tests/**/*.test.ts`
mirroring `src/`, importing from `../../src/...`; `tests/integration/reader-flow.test.ts` drives the public API
end-to-end on `createInMemoryStorage()` — update it when the SDK API changes). The desktop and mobile apps have no test runner — their checks are
the standalone spike scripts above.

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

Each supported format (epub, pdf, txt, md) is a `DocumentImporter` implementation in
`electron/adapters/<fmt>.adapter.ts` (TXT's importer is still the filename stub; its text is read by `electron/txt/`), registered by `DocumentFormat` enum key in
`electron/adapters/importer-registry.ts`. Adding a format means: new adapter file + registry entry, a matching
renderer under `src/reader/renderers/<fmt>/`, and a `SUPPORTED_FORMATS` entry in `packages/config/formats.ts`.
Domain/port code only ever deals with `DocumentImporter` / `DocumentRenderer` / `Location` — never format specifics.

### Persistence & the read-only/overlay invariant

`better-sqlite3`, schema versioned as numbered SQL files in `electron/persistence/migrations/` (currently
001–030: books, genres, comments, collections, reading sessions, notes/annotations, reading status, cloud
provenance, FTS chunks, signature status, embedded PDF annotation ledger, two-way sync base/conflict + write-back,
TXT edited-copy revisions, `books.file_format` accepts `mp3` and the other audio formats, `book_audio_chapters` for multi-chapter audiobooks, `audio_transcripts` + passages + FTS and the last job's scope), run through `migrate.ts`. `sqlite-library-store.ts` and
`sqlite-overlay-store.ts` implement the domain's `LibraryStore`/`CollectionStore`/`OverlayStore` ports.

**Signature status (verification only):** `books.metadata_json.signatureStatus` (`unsigned|valid|invalid|unsupported`;
absent = not checked) is the single source of truth — the app detects whether a book is signed, it never signs.
PDF signatures are verified in `electron/signature/`; EPUB and other formats report `unsupported`. A cached result
is reused only while the file's current SHA-256 equals `signatureCheckedSha256`. Annotations are not signatures and
`books.sha256` is a fingerprint, not a signature. See `docs/change_plan/book_signature_status.md`.

**PDF text annotations** (highlight/underline/strikethrough/note) are `notes` rows like EPUB highlights: a
`page-rect` locator (1-based page, `chapterIndex` = 0-based page, like PDF bookmarks) plus
`note_json.pdfAnnotation` (0-based `pageIndex`, rects normalized 0–1 to the displayed page box). Only
`book-reader-sdk/src/app-models/pdf-highlight.ts` converts page ↔ pageIndex; Main re-validates the payload. The
SDK `persistence/sql-notes.ts` JSON layout differs from Main's and is not compatible yet. See
`docs/implementation_plan/pdf_text_annotations.md`.

**Embedded PDF annotations** (Foxit/Acrobat markup + sticky notes inside the file) are synced into ordinary `notes`
rows through the `pdf_embedded_annotations` ledger (migration 023) — on open and live while the PDF is open:
`overlay:watchPdfEmbeddedAnnotations` starts a per-window session in Main (`electron/pdf-sync/`: `StableFileWatcher`
on the file's folder + stat poll, debounce + stability check, `%%EOF`/SHA-256 guards, one long-lived pdf.js scan
worker — a worker per scan crashed Electron Main) and results come back as `overlay:pdfEmbeddedAnnotationsChanged`.
Identity is `/NM` (read from raw PDF objects by `pdf-raw-objects.ts`; PDF.js doesn't expose it), else subtype + page
+ rounded geometry. Deletions only after a `complete` scan; never touches app-made rows; app edits win. Logic lives
in `book-reader-sdk/src/app-models/pdf-embedded-annotations.ts`. See `docs/implementation_plan/pdf_embedded_annotation_import.md`
and `pdf_embedded_annotation_live_sync.md`.

**Writing annotations into PDFs** — `electron/pdf-sync/pdf-incremental-writer.ts` appends ONE incremental update
(original bytes untouched; encrypted / unparseable trailers refused) and every write is read back with pdf.js.
Export (More → "Export PDF with annotations…", `overlay:exportAnnotatedPdf`) writes a NEW file chosen in a Main-owned
save dialog. Two-way sync (`planTwoWaySync` in the SDK, run by the same per-window coordinator) is **always on —
there is no write-back switch**: annotations are written into the book's own file after a per-write check
(`pdf-write-eligibility.ts`: user-owned file, writable, not encrypted, not signed unless the user confirms, unchanged
since read); a file that fails it is never written and the data stays pending in SQLite. Three-way merge per field
from `base_json`, conflicts frozen in `conflict_json` until the user picks; `books.sha256` is kept in step with the
file. See `pdf_annotation_export.md`, `pdf_annotation_two_way_sync.md`, `pdf_annotation_reader_compatibility.md`.

**Shape tools** (rectangle / ellipse / line / arrow): first-class annotation rows — a new `HighlightStyleKind` in the same `notes` table, Notes list and
`pdfHighlightsStore` history; geometry in `pdfAnnotation.rects[0]` + `pdfAnnotation.shape`, opacity in `colorHex` (`#RRGGBBAA`). They reach the file through the
always-on two-way sync as standard `/Square` `/Circle` `/Line` (`readmate:<id>` `/NM`); shapes from other readers are NOT imported (they are graphic objects).
See `docs/implementation_plan/pdf_shape_tools.md`.

**Typewriter note** (PDF text box with rich text; `book-reader-sdk/src/typewriter/`, `electron/pdf-sync/typewriter-pdf.ts`, `src/reader/renderers/pdf/PdfTypewriter*.tsx`, `src/screens/Reader/logic/pdfTypewriter/`; spec `specs/005-typewriter-note/`, map in `docs/implementation_plan/pdf_typewriter.md`): another `HighlightStyleKind` (`typewriter`) in the same `notes` table, Notes list and `pdfHighlightsStore` history — **no migration, no new IPC channel**. Plain text is `notes.note` (untrimmed, NFC, ≤ 10 000 chars), the box `pdfAnnotation.rects[0]`, the rich text `pdfAnnotation.typewriter` (`base` + sparse `runs` + paragraph `align`, offsets into the text). `layoutTypewriter` (SDK) is the single layout used by the page, the editor and the PDF appearance stream; the editor is a model-authoritative `contenteditable` (edits intercepted in `beforeinput`, IME applied on `compositionend`). It reaches the file through the always-on two-way sync as a `/FreeText` (`readmate:<id>` `/NM`) whose appearance stream is drawn in subset-embedded Noto fonts from `assets/fonts/typewriter/` (in-repo TrueType reader `pdf-font-embed.ts`, no package; the folder is listed in `electron-builder.json5` `files`). The file contributes only text and box back; the rich-text document is app-authoritative and a different text in the file is a conflict. A note that cannot be drawn (`unsupported_characters` / `font_unavailable` / `does_not_fit`) or a file that cannot be written (`file_not_writable`) stays in the app marked "Not in the file" with the reason and never blocks other annotations of the same write. UI: right-sidebar `typewriter` panel (right-click the tool = defaults of NEW notes in `readmate.pdfTypewriterPrefs.v1`; right-click a note = that note). Spikes: `spike:pdf:typewriter`, `spike:pdf:typewriter-store`, `spike:pdf:typewriter-font`, `spike:pdf:typewriter-perf`; E2E `pdf-typewriter*.spec.ts`.

**TXT reader** (`src/reader/renderers/txt/`, state in `screens/Reader/logic/txtDocument/`): an editable plain-text surface
— a `<textarea>` over a same-metrics backdrop that paints annotation marks. Offsets are UTF-16 indices into the canonical
text (BOM stripped, `\n` line breaks; `book-reader-sdk/src/txt/`). TXT markup is a `notes` row with
`note_json.txtAnnotation = { startOffset, endOffset }` + the quote in `locatorExtended.text`; an edit that touches an
annotation's text removes it, one entirely before moves it, one entirely after leaves it
(`planAnnotationEdit`). The user's file is only ever read: edits are saved as an app-owned UTF-8 copy
`{userData}/txt-edits/{bookId}/r{revision}.txt` + one `txt_documents` row, and `txt:commit` writes text revision and
annotation rows in ONE transaction (`SqliteTxtStore.commit`); TXT rows are never written through `overlay:saveHighlight`.
Reading position is a `text-offset` `Location` in `reading_state_json`. Text above `TXT_EDIT_MAX_CHARS` opens read-only.
See `docs/implementation_plan/txt_reader.md`.

**Audiobooks (MP3 only)** (`electron/audio/`, `electron/adapters/mp3.adapter.ts`, `src/screens/AudioBook/`, SDK `src/audio/`): an `mp3`
book is imported like any referenced file (tags/cover via `music-metadata`), is never read through `library:openBookContent`
(it returns an empty buffer after the path check, which doubles as the player's preflight) and never enters chunking / FTS / word
count / cover generation. `/reader/:bookId` is dispatched by `src/screens/ReaderRoute.tsx` (format → `AudioBookScreen` or the
unchanged `ReaderScreen`). The `<audio>` element streams from `rb-audio://local/{bookId}`; `createAudioStreamHandler` answers
single `Range` requests with `206` + `Content-Range` (`416` past EOF) from an `fs.createReadStream` — a plain `200` makes Chromium's
seeking fail, and `net.fetch(file://)` does not produce proper `206`s, so do not "simplify" it. Listening progress is seconds in
`reading_state_json.audioProgress` (merge-patched by `overlay:saveAudioProgress`, audio books only; `percent` mirrors it), never a
`Location`. The player has ONE canonical position (`currentTime`); the Book / Chapter scope only changes how the timeline is derived from it (SDK `timelineView` / `absoluteFromScoped`). Chapters are read from the file itself (ID3 `CHAP`/`CTOC` via `audio:getChapters`) and validated against the real duration (`normalizeChapters`: all-or-nothing); none → no chapters, never a guess. Audio **Notes** (the UI word; storage keeps the key `audioBookmarks`, channels `audio:*Bookmarks`) are a marked position in seconds + optional text + chapter ref, not the EPUB/PDF bookmark model; ONE list in `audioPlayerStore.notes` feeds both the sidebar and the timeline markers, and every entry point opens the same `AudioNoteMenu` via `audioNoteMenuStore`. The chapters panel is on the LEFT (resizable, slide-over below 960 px). Other audio formats (M4A, M4B, AAC, WAV, FLAC, OGG, Opus) are imported by the same `audio.adapter.ts` (container AND codec checked, not just the extension; migration 027) and streamed with an app-owned MIME, and SDK `audioPlaybackStatus` marks each `verified` only after a real encoder-made file played, paused, resumed and seeked in the app's Chromium (hidden-window probe; `READMATE_AUDIO_PACK=<dir> npm run spike:audio:main` imports and streams real files too). AIFF/`.aif` is recognised but refused at import (the bundled Chromium cannot decode it; no transcoding). ZIP-of-MP3 is NOT supported; see `docs/implementation_plan/audiobook_implementation_plan.md`. `music-metadata` is `external` in `vite.config.ts`: bundled, its CommonJS deps make the Main bundle throw at load (the app would not start).

**Audiobook ZIP import (multi-chapter; behind `features.audiobookZipImportEnabled`, off until the player supports multi-track playback)** (`electron/zip-import/`, `electron/ipc/zip-import.ipc.ts`, `src/components/import/AudiobookZipImportDialog.tsx`, SDK `src/audio/audio-zip-import.ts`): Import → "Audiobook ZIP" picks a `.zip` in a Main-owned dialog (the ordinary "Add file" dialog also offers `.zip` while the flag is on: `import:fromFile` holds the picked path in Main via `picked-zip.ts` and answers `audiobook_zip`, and the renderer then calls `zipImport:inspectPicked`); `ZipImportService` reads only the central directory (own bounded reader, no `jszip`: limits in `ZIP_IMPORT_LIMITS`, unsafe/duplicate paths reject the archive), probes each audio entry with the importer's own `probeAudioFile`, and returns a preview (tree, natural-ordered tracks, ranked covers) addressed by entry ids — the renderer never sees a path. `zipImport:confirm` (pressing Import closes the preview dialog at once; the import runs as a background `job` in `zipImportStore` — the "Audiobook ZIP" entry shows a spinner + count, `AudiobookZipJobPanel` shows progress / Cancel, then the list of imported audio files with "Open audiobook"; the rest of the app stays usable) re-validates the selection and the archive, then calls `ZipAudiobookImporter`; `createZipAudiobookImporter` (`zip-audiobook-importer.ts`) then imports: ONE selected track goes through the ordinary single-file `importDownloadedFile` (the preview cover is not applied); two or more become one `books` row (title = ZIP name; `file_path` = chapter 0, `file_format` = chapter 0's format as a routing marker only; `sha256` = hash of the ordered track hashes) plus ordered `book_audio_chapters` rows, files flat in `{books}/{uuid}/{position}-{id8}.{ext}`, written under a `.partial` marker and committed in one transaction. Multi-chapter books are removed with `library:removeAudiobook` (folder, rows, cover; `removeBook`/`deleteBookFile` refuse them). `audioProgressPatch` with a `trackId` deletes `percent`/`durationSeconds`/`chapterId` with explicit `null`s (merge-patch keeps omitted keys). Multi-track playback (Stage B1; the flag stays off until B2 also passes the release gate): `rb-audio://local/{bookId}/{trackId}` streams one chapter (MIME and extension from the CHAPTER's format, `audio-lookup.ts`), `audio:getTracks` lists id/title/duration only, and the player store (`audioPlayerStore.ts`) plays one track at a time on a NEW `Audio` element per track (listeners of the retired element are removed and every handler drops events whose element is no longer current), with `switching` separate from the screen-level `status` (which stays `ready`). Progress is `trackId` + the position inside the track; Main refuses a multi-track progress save without its own `trackId` and a single-file one with a `trackId`. **Notes for multi-track books** (`specs/001-multi-track-audiobook-notes`) reuse the same `audioBookmarks` array and `audio:*Bookmarks` channels with one extra field, `trackId`, and `positionSeconds` = seconds inside that track: `SqliteAudioStore` accepts a multi-track save only if EVERY Note names a track of THAT book and the raw list has at most 500 entries (refused whole otherwise; single-file keeps its silent truncation and refuses a `trackId`), reads partition the raw array before the cap, and stored entries with a missing/foreign `trackId` are never returned but are carried over on every save (partitioned before sanitizing); a failed read makes Notes unavailable in the store (never an empty list that a save could write back). In the player store a Note jump to another track reopens it on the exact second (clamp only, not `resolveRestorePosition`) and, if the target cannot be played, falls back to the origin track paused via `pendingJump` (bound to the `trackSwitch` token; every other `openTrack` clears it, the target's `loadedmetadata` clears it, no second fallback). The multi-track Notes tab groups Notes by track (`specs/002-notes-grouped-by-track`): SDK `groupNotesByTrack` gives one row per track that has Notes (a closed row renders only its header, an open one the usual `NoteCard`s); which rows are open lives in `audioNoteGroupsStore` (session-only, outside React so closing the sidebar keeps it, cleared when the player's `bookId` changes; the playing track's row is opened once the first time the tab is shown; adding a Note opens its row through `audioPlayerStore.lastAddedNote`; a track change never opens or closes a row). Single-file Notes stay a flat list. Auto-advance, previous/next track and sleep end-of-track are built; percent / totals for multi books are not (Stage C). See `audiobook_multi_track_playback_b.md`. See `docs/implementation_plan/audiobook_zip_import_preview.md` and `audiobook_multi_chapter_import.md`.

**Audiobook transcription** (`electron/transcription/`, `electron/ipc/transcription.ipc.ts`, `src/screens/AudioBook/` Transcript tab, SDK `src/transcription/`; spec `specs/004-audiobook-transcription/`, map in `docs/implementation_plan/audiobook_transcription.md`): speech-to-text of an audiobook **on the device only** — audio is never sent anywhere; the only download is a speech model, after an explicit button press, pinned by commit + SHA-256 (`transcription-models.ts`) and re-hashed on load. Audio is decoded by **our own LGPL FFmpeg spawned with an argv array and hash-checked — never `ffmpeg-static`, never a system `ffmpeg`** (win32-x64 built + bundled via electron-builder `extraResources` → `{resources}/ffmpeg/win32-x64/`, hash in `electron/transcription/ffmpeg-artifacts.json`, `afterPack` re-checks it; macOS/Linux not built → decoder unavailable; see `docs/implementation_plan/ffmpeg_packaging.md`). Whisper runs in a **separate OS process** (`speech-process-host.ts`), never a worker thread (terminating a thread inside ONNX Runtime crashes the app), with a watchdog (a request can never hang; a user cancel always ends `ABORTED`). **Per-window commit**: each 30 s window writes its passages and its covered interval in ONE transaction (`commitWindow`), so cancel / failure / quit / crash keep finished text and a transcript is `complete` only when the requested scope is covered; `recoverInterrupted()` runs at startup before the IPC handlers (job → `partial`/`failed` + `INTERRUPTED`, never restarted by itself; **Resume** = `start` again, covered intervals skipped, stored `scope_json`). The Transcript panel is a **read-only consumer of the player store**: the active passage is derived from `audioPlayerStore` and "play from here" is its `goToPosition` (same path as a Note jump). The renderer never gets a path (export's save dialog and file write are Main's). Removing a book cancels its transcription first (`cancelTranscriptionOfBook`); Settings → Storage lists and removes downloaded speech models (refused while a transcription runs). Checks: `spike:transcription:main|store|sidebar|smoke` (smoke criterion 4, host heartbeat ≤ 500 ms, is a documented non-blocking limitation under CPU saturation, research R13).

**Audiobook transcription (spec 004; behind `features.audiobookTranscriptionEnabled`, default `false` until the own-build FFmpeg is integrated)**: OFF hides the Transcribe entry and Transcript tab in `AudioBookScreen` and makes Main's `transcription:start` / `transcription:downloadModel` answer `FEATURE_DISABLED` before validation, any model download or any job (service option `isEnabled`, wired in `transcription-runtime.ts`); the decoder is also probed before any download (`DECODE_FAILED`). Release gate: `book-reader-sdk/tests/config/audiobook-transcription-gate.test.ts`. See `docs/implementation_plan/audiobook_transcription.md`.

**Annotation import / export** (EPUB, PDF, TXT, Markdown — never audiobooks; SDK `src/annotation-transfer/`, `electron/annotation-transfer/` + `electron/ipc/annotation-transfer.ipc.ts`, renderer `src/screens/Reader/logic/annotationTransferStore.ts` + `annotationReload.ts`, `src/components/annotation-transfer/ImportPreviewDialog.tsx`; spec `specs/006-annotation-import-export/`, map in `docs/implementation_plan/annotation_import_export.md`): moves a book's annotations as data, by hand, through a Main-owned dialog — external sync / cloud / other apps' formats are NOT part of it, and the book file is never written by it (for a PDF the always-on two-way sync may append the imported annotations afterwards, as it does for any app-made one). Two files: the restorable `<title>.readmate-notes.json` (UTF-8 JSON, `fileVersion` 1, header = book title / author / format / `books.sha256` / PDF `pageCount` / TXT `contentSha256`; each annotation is the stored `note_json` projected verbatim: `type`, `locator`, `selectionText`, `note`, `colorHex`, `pdfAnnotation` / `txtAnnotation` / `mdAnnotation`, `origin` app|file and, for annotations read from a PDF, the sync-ledger `sourceKeys`) and the readable `<title>.md` (quotes and comments by chapter / page / section; not importable — the importer decides by CONTENT, not by extension). No migration, no new table. **Import** = `annotationTransfer:pickFile` (Main opens the dialog, parses, identifies the file's book by `sha256` then title + author + format, resolves the target's book file — missing → `file_unavailable` — and plans: add / already there / not placed; a PDF target is also scanned so annotations another reader put in the file are not duplicated) → optional `setTarget` (REQUIRED when the file belongs to another book than the one the import started from, or to none in the library: `requiresChoice`, `confirm` answers `target_not_confirmed` until the user chooses) → `confirm`: ONE **synchronous** `BEGIN IMMEDIATE` … `COMMIT` over the shared better-sqlite3 connection (no `await` inside: another handler's writes would land in it and be rolled back with it) that first re-validates the preview (book fingerprint, TXT revision / content hash, the set of existing content keys; any change → rollback + `stale_preview`) and then calls `SqliteOverlayStore.writeHighlight` per annotation — never `SqliteTxtStore.commit` (it opens its own transaction and cannot nest) and never `overlay:saveHighlight` / `txt:commit`. Duplicates are recognised by a CONTENT key (`contentKeyOf`: type + location + quote + comment + geometry rounded to 4 decimals), never by SQLite ids; a source id is reused only when no row anywhere has it (`writeHighlight` upserts by id across books). Placement (`decidePlacement`): identical bytes → stored locations; a PDF that is the same document (same title / author, page counts known on both sides and equal) → by page and rectangle, never searched; a TXT that is not the text it was made on → each annotation re-anchored by its quote (`anchorByQuote`: exactly once, or singled out by its stored before / after text); Markdown and EPUB of another edition, and everything else → reported "not placed", never guessed. `modified` time cannot be restored (`writeHighlight` stamps now), `created` is. After a committed import the Reader reloads the open book (`createAnnotationReloader`: `loadHighlights` of the EPUB / PDF / Markdown stores; TXT flushes its save loop, then `load`), never after a rollback. Export reads SQLite only (works when the book file moved) and writes with `writeFileSafely`. Entry points: Reader More menu, Library book menu, Library top bar ("Import annotations file…", with a same-format book picker). EPUB readable-copy headings are `Chapter N` (no TOC-title reader exists in SDK or Main). Checks: SDK `tests/annotation-transfer/*`, `spike:annotations:main|store|perf`.

**PDF attachments** (Attachment sidebar tab, PDF only — capability `attachments`): files embedded in the PDF (`/EmbeddedFiles`
and page `FileAttachment` annotations) are listed lazily (`attachments:list`) and opened by double-click → confirmation →
`attachments:open`. The renderer sends only `bookId` + `attachmentId`; Main re-reads the PDF, finds the attachment in those
bytes (scan worker, kinds `attachments-list` / `attachment-extract`), enforces 100 MB on the extracted data, applies the SDK
policy (`book-reader-sdk/src/attachments/`: sanitised names, prohibited / extension-less / disguised executables are
blocked) and opens a Main-owned temp copy with `shell.openPath` — never a shell command. Blocked files offer a separate
`attachments:saveAs`. Attachments are not imported into the Library; internal opening is not built. See
`docs/implementation_plan/pdf_attachments.md`.

**PDF file attachments (create / move / delete)** (File Attachment tool, PDF only — capability `fileAttachments`; spec `specs/007-pdf-file-attachment/`, map in `docs/implementation_plan/pdf_file_attachment.md`): a click on a page with the tool → `attachments:create { bookId, pageIndex, point }`; Main checks the PDF can be written BEFORE opening its own picker (unwritable → refused, no picker; signed → the existing signed-PDF confirmation, then the same request again), stages the picked file in `{userData}/attachment-staging/` (`stageAttachmentSource`: size checked on `stat` before the file is read — 100 MB per file `ATTACHMENT_MAX_BYTES`, PDF + file ≤ `ATTACH_COMBINED_MAX_BYTES` 300 MB from the M0 memory gate; content hashed; a file that changes while read → `source_changed`), plans ONE incremental update in the scan worker (`planAttachmentAppend`: Flate EmbeddedFile with indirect `/Length` + `/Params`, Filespec `/F` + `/UF`, FileAttachment `/NM readmate:<rowId>` with its own paperclip appearance, page `/Annots`; never `/Names /EmbeddedFiles`) and streams it (`writeAttachmentUpdate`: original bytes → segments → deflate(staged) → xref) into a temp file beside the PDF that is read back by pdf.js (`attachment-verify`), the target re-checked unchanged, then renamed — the content is never held whole by the writer, and any failure leaves the PDF byte-identical. Only then is the `notes` row written (style kind `attachment`, `pdfAnnotation.attachment = { name, sizeBytes, sha256, modifiedAt? }`). `attachments:change { op: 'move' | 'delete' }` (`changePdfAttachment`, worker kind `attachment-change`): a move rewrites the annotation with the SAME object number keeping `/FS` (and `/Popup /IRT /RT /StructParent /OC`), a delete removes it from `/Annots` — the embedded bytes stay in the earlier revision, so the PDF never gets smaller (the delete dialog says so); then ONE transaction (`commitAttachmentChange`). Every file operation runs in the live sync's per-book slot (`runFileOperation`). Attachment rows are **file-authoritative** in the sync (moved / deleted in another reader → the row follows; never a two-way file op) and are refused by `overlay:saveHighlight` / `deleteHighlight` and by annotation import; the restorable annotations file leaves them out, the readable `.md` lists them (`📎 name (size), page n`), Export PDF keeps them (already in the copied bytes). Open / Save As of a Readmate-made one use the id `rm-<rowId>` (resolved by `/NM` in fresh bytes, stable across moves); other readers' page attachments arrive with each sync event as `pageAttachments` (open / save only) and Readmate draws every icon itself. Renderer: `pageAttachmentsStore` (selection, details / menu / open / blocked / delete / signed dialogs in `PageAttachmentDialogs.tsx`, drag-to-move with undo / redo — only a move is in the history —, the tool disabled with the reason when the PDF is known to be unwritable). No migration; the two new channels are `attachments:create` / `attachments:change`. Foxit / Acrobat compatibility is NOT claimed until `docs/implementation_plan/pdf_file_attachment_compat.md` has results. Checks: `spike:pdf:attachment-memory|write|store`, `spike:pdf:attachments`, `spike:pdf:export` (scenario 14), SDK `tests/attachments/*`.

Per-book reading state (position, percent, and that book's font/size/line-height/align/layout/margin overrides)
lives in `books.reading_state_json`, written via `overlay:saveSessionState`.

Core invariant: **the book file is never mutated** — except that Readmate appends annotation updates (incremental
updates, original bytes untouched) to a referenced PDF the user owns, automatically and without a switch (see above).
Every other format and every app-owned copy stays read-only. All highlights/notes/bookmarks/session state live in
separate SQLite "overlay" tables / columns keyed by `bookId`.

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
