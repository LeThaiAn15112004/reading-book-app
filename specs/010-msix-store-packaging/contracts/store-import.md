# Contract: one-time import from the installer (direct) build

Runs in Main, Store build only (`process.windowsStore`), **before the first window and before `openDatabase()`**.
Pure rules: core `source/core/src/store-import/`. Host side: `source/app/platforms/electron/store-import/`.

## Roots

- Source (read only): `%APPDATA%\reading-book-desktop` (= `path.join(app.getPath('appData'), 'reading-book-desktop')`).
- Target: the Store build's `userData` = `path.join(app.getPath('appData'), 'Readmate Reader Store')`, set before
  anything else in `main.ts` (see packaged-runtime contract).

**The source is never opened by SQLite, never written, renamed or deleted.** Only `fs.stat`, `fs.readdir` and
read streams touch it.

## Allowlist

| Entry | Copied | Notes |
|---|---|---|
| `reading-book.db` | yes | byte copy; only when no `reading-book.db-wal` exists in the source |
| `books/` | yes | managed copies |
| `covers/` | yes | |
| `txt-edits/` | yes | TXT edited-copy revisions |
| `background-prefs.json`, `notification-prefs.json`, `reading-reminder-state.json` | yes, if present | Main prefs (`json-prefs-file.ts`); list confirmed by grep on 2026-11-08 (T052) |
| `Local Storage/` | yes | renderer preferences (Appearance, Library browse, reading defaults …) |
| `cloud-tokens` | **no** | per-app protected; linked accounts show "Sign in again" |
| `models/`, `transcription-models/` | no | re-downloadable |
| `attachment-tmp/`, `attachment-staging/`, `zip-import-tmp/` | no | temporary |
| anything else (Chromium caches, `Session Storage`, logs …) | no | |

## Dialogs (native, English, Main-owned)

| When | Message | Buttons → result |
|---|---|---|
| first offer | "Bring over your library from Readmate Reader (installer version)? Your books, annotations, reading positions and settings are copied. The installer version keeps its own copy, unchanged." | **Import** → copy · **Start empty** → marker `declined` |
| source has `-wal` | "Readmate Reader (installer version) is open, or did not close properly. Close it (or open and close it once), then try again." | **Try again** · **Later** (no marker) · **Start empty** (`declined`) |
| not enough space | "Not enough free space: <needed> needed, <free> free on <drive>." | **Try again** · **Later** · **Start empty** |
| newer schema | "The installer version's data comes from a newer Readmate Reader. Update this app from the Microsoft Store, then try again." | **OK** → no marker (asked again after an update) |
| failure (copy, integrity, count mismatch, leftover old path) | "Your library could not be brought over. Nothing was changed in the installer version. This app starts empty; you can try again from Settings → Advanced." | **OK** → no marker |
| done | "Your library was brought over: <n> books, <m> annotations. Cloud accounts need to be signed in again." | **OK** |

Progress window: frameless, static HTML, no preload; text "Copying <done> of <total> files (<size>)"; **Cancel** =
discard staging, no marker.

## Steps

1. `planImport(source)` → refuse `source_busy` / `no_space` or a list of entries to copy.
2. Copy each allowlisted entry into `{target}/store-import.partial/` (streams; `fs.cp` with `errorOnExist`, no
   symlink following).
3. Open the staged database read-write: `PRAGMA integrity_check` = `ok`; `isNewerSchema` false; run the normal
   migrations; in one transaction rewrite `books.file_path`, `books.normalized_path`, `books.cover_path` with
   `rewriteRoot`; then scan every TEXT column of every table — any value still inside the source root → refuse.
4. `verifyCounts` for `books`, `notes`, `collections`, `book_audio_chapters`, `txt_documents`,
   `audio_transcripts`; file count / bytes per copied folder equal to the source.
5. Close the staged database; rename each staged entry into the target root, **`reading-book.db` last** (commit
   point); write `store-import.json` `{ state: 'done', … }`; remove `store-import.partial/`.

**Recovery on launch**: no `reading-book.db` in the target → delete `store-import.partial/` and every allowlisted entry
in the target, then decide whether to offer (data-model §5).

## IPC (new group `StoreImportChannels`, four places + Mobile `unavailable.ts`)

| Channel | Request | Response | Notes |
|---|---|---|---|
| `storeImport:getStatus` | — | `StoreImportStatusDto` | direct build: always `{ available: false }` |
| `storeImport:schedule` | — | `{ ok: true } \| { ok: false, reason: 'not_available' }` | writes marker `pending`, then `app.relaunch()` + quit through the `isQuitting` path |

The renderer sends no path. Settings → Advanced shows the row "Bring over library from installer version" only when
`available` is true.
