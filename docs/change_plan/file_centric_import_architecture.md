# File-Centric Import Architecture

> **Status:** implemented in the desktop app (`source/apps/reading-book-desktop`). No SQL migration.
> **Related:** SDS changelog 1.24 · SRS changelog 1.7 (UC-01, UC-02 E1, BR-01, BR-06, **BR-09**, FR-01, FR-13, **FR-15**) ·
> `docs/software/schema.dbml` (`books.file_path`) · `CLAUDE.md` ("Reference-based library").
>
> This document describes what the code does today. Anything not implemented is listed under
> [Future work](#15-future-work) or [Verification → not covered](#16-verification).

## 1. Overview

Until now every import copied the picked file into `{userData}/books/{uuid}/<name>`, so a user with a
large library ended up with two physical copies of every book and the copy was the only thing the app
could open. The library is now **file-centric**:

- A book picked **from the user's own filesystem** is *referenced in place*. `books.file_path` is the
  user's original absolute path. The app never copies, writes, moves or deletes that file (or its folder).
- A book fetched over **URL** or from a **cloud provider** has no lasting file on the user's disk, so the
  app downloads it and keeps the downloaded copy in **app-owned storage**. That copy stays available offline.
- Every book — whatever its source — is one row in SQLite, identified by `books.id` and its content hash
  `books.sha256`, never by its path.

The consequence of referencing is that a book's file can disappear (moved, renamed, deleted). The row and
all data keyed by `books.id` must survive that, and the user must be able to point the book at the file's
new location ([Missing files](#9-missing-files)).

## 2. Architecture

```
                 Add Book
                    │
          ┌─────────┼─────────┐
          │         │         │
       Local       URL       Cloud
          │         │         │
          ▼         ▼         ▼
       Reference  Download  Download
          │         │         │
          │         └────┬────┘
          │              │
          │         App-owned
          │           storage
          │              │
          └──────┬───────┘
                 ▼
              SQLite
```

Code map (all under `source/apps/reading-book-desktop/electron/`):

| Concern | File |
|---|---|
| Local + URL import handlers, shared finish/cleanup logic | `ipc/import.ipc.ts` |
| Cloud download-and-import | `ipc/cloud.ipc.ts` (`downloadAndImport`) |
| Path classification / validation / resolution / guarded delete | `files/sandbox.ts` |
| "Locate file" (relink) | `files/relink-book.ts`, `ipc/library.ipc.ts` (`library:relinkBook`) |
| Bytes for the reader | `files/open-book-content.ts` |
| Temp download (https only) | `adapters/http-url-fetcher.ts` |
| Covers | `adapters/epub.adapter.ts`, `files/cover-protocol.ts`, `files/sandbox.ts` |

## 3. Storage ownership

| Import source | `books.file_path` points to | Owner | Kind (derived) |
|---|---|---|---|
| Local | the file the user picked (e.g. `C:\Books\book.epub`) | **User** | `referenced` |
| URL | downloaded copy in `{userData}/books/{uuid}/<name>` | **App** | `managed` |
| Cloud | downloaded copy in `{userData}/books/{uuid}/<name>` | **App** | `managed` |
| Imported before this change | copy in `{userData}/books/{uuid}/<name>` | **App** | `managed` |

`books.file_path` is *not* assumed to be under `{userData}/books`; only `managed` books are.

## 4. `books.file_path` semantics

`books.file_path` always means **"the file the reader should open."** Who owns that file depends on how the
book was imported (table above).

The kind is **derived from the path, not stored**:

```ts
// electron/files/sandbox.ts
bookFileStorage(filePath) => isPathInsideSandbox(filePath) ? 'managed' : 'referenced'
```

No `storage_kind` column was added. It would only duplicate what the path already says, and it would need a
backfill for existing rows. The derivation is sound because the two ways a `referenced` path is created both
refuse anything inside `{userData}`: local import (`isPathInsideUserData` check in `import:fromFile`) and
relink (`relinkBookToFile`). So a `referenced` book can never resolve into the sandbox, and a `managed` one
is always something the app itself created.

Trade-off: if `userData` ever moved, old `managed` rows would classify as `referenced` — the safe direction
(the app then refuses to delete them). `source_url`, `source_provider`, `external_id` describe *provenance*
and are unrelated to ownership; they are preserved exactly as before.

The kind is exposed to the UI as `BookSummaryDto.fileStorage: 'managed' | 'referenced'`.

## 5. Local import flow

Handler: `import:fromFile` in `ipc/import.ipc.ts`.

1. Main opens the native open-file dialog. **The path comes from the dialog, never from the renderer.**
2. `path.resolve()` the choice; `assertSupportedExtension()` (epub, pdf, txt, md, docx, doc).
3. Refuse if the file is inside `{userData}` (`isPathInsideUserData`) — it would be mistaken for an app-owned
   copy and could later be deleted as one.
4. `rejectIfDuplicate()` — stream SHA-256 of the **original** file, `findBySha256`. A hit returns
   `errorCode: 'duplicate'` with the existing `bookId`. Nothing has been written at this point.
5. `finishImportByReference()` → `finishImport(path, options, ownsFile = false)`:
   - `extractMetadata()` runs the format's `DocumentImporter` on the original file, read-only. For EPUB the
     cover is extracted to `{userData}/covers/{uuid}.<ext>` — never next to the book.
   - `persistImportedBook()` inserts the row with `file_path` = the original absolute path.
6. On failure, only the extracted cover is removed. Because `ownsFile` is `false`, the user's file is never
   deleted. If two identical files race and the loser hits `UNIQUE(sha256)`, it is reported as a duplicate.

The file is hashed twice (once for the duplicate check, once inside the importer's `buildImportResult`).
That predates this change and was left alone.

## 6. URL import flow

Handler: `import:fromUrl` in `ipc/import.ipc.ts`.

1. Validate the string; `assertSupportedUrlPathExtension()`.
2. `httpUrlFetcher.fetch()` — https only, 60 s timeout, 100 MB cap, ≤ 5 redirects — into a temp file.
3. `assertSupportedExtension(tempPath)`.
4. `rejectIfDuplicate(tempPath)` (SHA-256 of the download).
5. `copyIntoBooksSandbox(tempPath)` → `{userData}/books/{uuid}/<name>`, mode `0o444`. This is a copy; the
   temp file is removed afterwards.
6. `finishImportAfterCopy(dest, { sourceUrl })` → `finishImport(dest, options, ownsFile = true)`: extract
   metadata, insert the row with `file_path` = the app-owned copy and `source_url` preserved.
7. Cleanup: if metadata extraction or the insert fails, `removeManagedBookDir(dest)` deletes the app-owned
   copy (SQLite cannot roll back a file copy) and the cover is removed. The `finally` block always removes
   the temp download — on success, duplicate, or error.

## 7. Cloud import flow

Handler: `cloud:downloadAndImport` → `downloadAndImport()` in `ipc/cloud.ipc.ts`.

1. Request validation: provider must be known; `entry.externalId` and `entry.title` must be strings.
2. If a book with the same `(source_provider, external_id)` already exists, return it.
3. Get a valid access token from the token vault (Main does the download; refresh tokens never leave the vault).
4. `entry.formatHint` must be a supported extension (also keeps arbitrary text out of the temp file name).
5. `mkdtemp(os.tmpdir()/reading-book-cloud-*)`; `kit.downloadToFile()` into it.
6. `assertSupportedExtension` → `rejectIfDuplicate` → `copyIntoBooksSandbox` →
   `finishImportAfterCopy(dest, { sourceProvider, externalId })`. Same cleanup rules as URL.
7. `finally` removes the temp directory.

**Removed:** the old `entry.localPath` branch (sample / folder-scan entries) that copied a
renderer-supplied local path into the library. Main no longer reads any path from the renderer here, and
`localPath` was dropped from `CloudCatalogEntryDto`. Nothing in the desktop renderer set it.

## 8. Existing book compatibility

No migration runs and no file is touched. Books imported before this change already have
`file_path = {userData}/books/{uuid}/<name>`:

- `bookFileStorage()` classifies them `managed`, so they open, keep their read-only copy, and keep the
  "Delete file…" action exactly as before.
- Their covers may live next to the copy (`{userData}/books/{uuid}/cover.*`). `assertCoverPathAllowed()`
  accepts covers under `{userData}/covers` **or** the sandbox, so those keep rendering.
- The app does **not** try to guess the original location of an old import, and does not convert old books
  to references.

## 9. Missing files

Detection (`files/sandbox.ts` → `resolveBookFile()`), used by `library:openBookContent`, book chunking and
the metadata backfill. It returns one of:

| Code | Meaning |
|---|---|
| `path_denied` | relative / device path, extension doesn't match the book's format, or a symlink retargeting to another type |
| `missing_file` | `ENOENT` / `ENOTDIR`, or not a regular file |
| `read_failed` | exists but unreadable |

When the file is gone:

- **Nothing is deleted.** The `books` row, `books.id`, annotations, bookmarks, notes, reading state,
  collections, tags, `book_chunks` and their FTS rows are untouched. Search and word count read
  `book_chunks` from SQLite, not the file, so they keep working; only *creating* chunks needs the file.
  The backfill skips unreadable files instead of failing at boot.
- **Reader:** opening the book shows the "could not open" panel. When the code is `missing_file` it offers
  **Locate file…** (`ReaderOpenStatus` → `useBookRelink` → `bookRelinkStore`).
- **Locate file** (`library:relinkBook`, implemented — not future work): Main opens a native dialog
  filtered to the book's format; `relinkBookToFile()` then rejects a file inside `{userData}`, a wrong
  extension, an unreadable file, or one whose SHA-256 differs from `books.sha256`. On success it runs
  `LibraryStore.updateFilePath()` — which changes `file_path` and `updated_at` only. The reader then retries.
  `books.id` and everything keyed by it are unchanged, and because the hash is unchanged the derived
  chunks/FTS remain valid.

Not done: the Library grid does not mark books whose file is missing (see Future work).

## 10. Delete semantics

| Action | `referenced` (user-owned file) | `managed` (app-owned copy) |
|---|---|---|
| **Remove from library** (`library:removeBook`) | Row + cascaded data + extracted cover removed. **User's file and folder untouched.** | Same. The app-owned copy is **kept** (unchanged behaviour). |
| **Delete file…** (`library:deleteBookFile`) | Not offered in the UI (`BookItemMenu` shows it only for `managed`). Main also refuses: returns `ok: false`, deletes nothing. | Deletes `{userData}/books/{uuid}/`, the row + cascaded data, and the cover. |

`removeManagedBookDir()` is a second guard: it only deletes when the file is exactly
`{sandbox}/{uuid}/<file>`, so a referenced book's parent folder (e.g. `D:\Books`), the sandbox root, or a
deeper layout can never be removed even if a caller mistakenly asked. `removeCoverFile()` only deletes files
inside `{userData}/covers`. The confirm dialog in `LibraryScreen` says "Your original file will not be
touched." for referenced books.

## 11. Security

`assertPathAllowed()` (sandbox-only) was **not** removed. It still guards app-owned copies. Registered
external files go through a separate, stricter-by-format path check instead of being let through:

1. **The renderer never supplies a filesystem path.** Every `window.api` method takes a `bookId`, a URL
   string (fetched by Main, https only), a provider + plain-metadata DTO (no DTO in `api-types.ts` has a
   path field), search text, or numbers. The only path inputs are Main-side native dialogs
   (`import:fromFile`, `library:relinkBook`). Verified by reading `preload.ts` and `api-types.ts`.
2. **`checkRegisteredBookPath(filePath, format)`** — the stored path must be absolute, must not be a
   `\\?\` / `\\.\` device path, and, unless it is inside the sandbox, must carry the extension of the
   book's own format. A tampered row therefore cannot be used to read files of other types (`hosts`, `.ssh` keys, `.db` files, …).
3. **`resolveBookFile()`** — for referenced files, `realpath()` then re-check the extension on the target
   (a `.epub` symlink to a `.txt` is refused), then require a readable regular file.
4. **Bytes only across IPC.** `openBookContent` returns file bytes and codes, never a path. `showInFolder`
   and `copyFilePath` act in Main (shell / clipboard) and return only `ok`.
5. **Destructive operations are keyed by ownership**, twice (`bookFileStorage` in the handler,
   `removeManagedBookDir` in the helper).
6. **Cloud** takes no path from the renderer (see §7).
7. **Covers** are served by id via `rb-cover://`; `assertCoverPathAllowed()` limits them to
   `{userData}/covers` or the legacy sandbox location.

Residual risk (unchanged in kind): someone who can already write `reading-book.db` can point a row at any
file with the right extension for the book's format. That is outside the renderer boundary this design
protects.

## 12. SHA-256

- **Duplicate detection is unchanged and content-based.** The hash of the original file (local) or of the
  finished download (URL/cloud) is checked before anything is copied or written. The same content at a
  different path is a duplicate; paths are never compared.
- **Relink verification:** a replacement file is accepted only if its hash equals `books.sha256`. This is
  what stops an unrelated book from inheriting another book's annotations and progress.
- SHA-256 identifies and verifies content. **It is not a backup**: if the only copy of a referenced file is
  deleted, the hash cannot restore it.

## 13. Data ownership

| Data | Owner | Where |
|---|---|---|
| Source book file — Local | **User** | wherever the user keeps it (`books.file_path`) |
| Source book file — URL / cloud / pre-change imports | **App** | `{userData}/books/{uuid}/` |
| Cover images | **App** | `{userData}/covers/` (legacy: beside the managed copy) |
| Metadata, `source_*`, `external_id`, `sha256` | **App** | SQLite `books` |
| Annotations, bookmarks, notes, tags | **App** | SQLite `notes`, … keyed by `book_id` |
| Reading state / preferences per book | **App** | SQLite `books.reading_state_json` |
| Collections | **App** | SQLite `collections`, `collection_books` |
| Chunks + FTS index | **App** | SQLite `book_chunks`, FTS tables |

Only the first row changed hands. The book file is never mutated in either case; all reader-generated data
is overlay data keyed by `books.id`.

## 14. Migration / compatibility

- Non-destructive: **no SQL migration**, no file moved, renamed or deleted, no row rewritten.
- Old `managed` books keep their sandbox copy and keep working (§8).
- New local imports reference the original; new URL/cloud imports use app-owned downloads.
- `covers` for new imports are written to `{userData}/covers/` (created on demand); old covers are not moved.

## 15. Future work

- **Library-level "file missing" indicator.** Today a missing file is only discovered when the book is opened.
- **Bulk re-check / relink** (scan the library for missing files, or auto-suggest a match by hash in a
  chosen folder).
- **Orphaned managed copies:** "Remove from library" keeps the app-owned copy (existing behaviour), so
  removed URL/cloud books leave a copy on disk unless "Delete file…" was used. A cleanup/GC pass is not implemented.
- **Watch folders / "Drive folder synced on this machine"** (SDS Phase 3): still design-only. Whether such
  sources should be *referenced* (like Local) or *downloaded* (like Cloud) has not been decided in code;
  online-only placeholders from sync clients are the open question.
- **`docs/diagram/wf-02-import/wf-02.png`** is a rendered image and was not regenerated; its source
  `wf-02.puml` is updated. Re-render it with PlantUML.

## 16. Verification

Run on 2026-09-29 against the working tree.

| Check | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`, desktop app) | **Pass** (exit 0), also after the final edit |
| `eslint --max-warnings 0` on the files this feature touches | **Pass** — no output for the 21 files linted. Two other touched files (`files/metadata-filename.ts`, `src/hooks/reader/useReaderBookOpen.ts`) have lint errors that are identical at `HEAD` (1 and 5), so they are not caused by this change. |
| `npm run lint` (whole desktop app) | **Fails: 13 errors, 18 warnings**, all in files outside this feature (`http-url-fetcher.ts`, `metadata-filename.ts` regex, `google-loopback-server.ts`, `sqlite-library-store.ts`, `src/hooks/reader/useReaderBookOpen.ts` `any`s, Library shelf views, `useCloudSources.ts`, react-refresh warnings). Not fixed here. |
| Automated test suite | **None exists** in the repo (`CLAUDE.md`), so none was run. |
| Behaviour harness (throw-away script, **not** added to the repo) | **85 checks, 85 pass, 0 fail** |

The harness bundled the real Main-process modules (`import.ipc`, `library.ipc`, `open-book-content`,
`sandbox`, `relink-book`, SQLite store + all migrations) and ran them under Electron 39.8.10 in Node mode against
a temp `userData` and a real SQLite file. Only the `electron` module was replaced by a small mock (native
dialog answers a queue of picked paths; `ipcMain` records handlers). It covered:

- **Local:** `file_path` equals the original absolute path; nothing under `{userData}/books`; the source
  folder is byte-for-byte and mtime unchanged; cover lands in `{userData}/covers`; OPF title read; book
  opens; EPUB and TXT; dialog cancel; unsupported extension; file inside `userData` refused; two identical
  files imported concurrently → one row, both user files survive.
- **Duplicate:** same content at another path → `duplicate` with the existing id; no copy made.
- **URL:** with the network fetch stubbed to produce a temp file — app-owned read-only copy under
  `books/{uuid}/`, `source_url` kept, temp removed (success, duplicate), fetch error leaves nothing behind.
- **Cloud:** the exact call sequence of `downloadAndImport` after the download step —
  `rejectIfDuplicate → copyIntoBooksSandbox → finishImportAfterCopy` — `source_provider` / `external_id`
  stored and resolvable; persistence failure removes the orphan app-owned copy and keeps the original's.
- **Existing books:** a sandbox-imported row with a legacy cover beside it opens, classifies `managed`,
  serves its cover and can still be deleted with "Delete file".
- **Missing file:** after moving the file, open reports `missing_file`; row, id, notes, bookmark, chunk,
  collection membership, reading state and authors are unchanged; book still listed.
- **Relink:** wrong content → `hash_mismatch`; wrong format → `wrong_file`; cancel; candidate inside
  `userData` refused; unknown id; correct file at the new path → only `file_path` changes, id and all data
  intact, book opens again.
- **Delete:** referenced — "Delete file" refused, "Remove from library" leaves the user's file and folder
  untouched and cascades the data; managed — remove keeps the copy, "Delete file" removes it.
- **Security:** relative / `\\?\` / wrong-extension / traversal paths denied; a tampered row pointing at
  `win.ini` returns no bytes; `removeManagedBookDir` refuses a user file, a file in the sandbox root and a
  deeper layout; a `.epub` symlink to a `.txt` is refused.

**Not covered** (say so rather than assume): real GUI/dialog interaction and the Locate-file button
click-through in a running window; a real HTTPS download; real Google Drive / Dropbox / OneDrive downloads
(`downloadAndImport` itself needs OAuth kits — only the post-download sequence was exercised); PDF, MD,
DOCX and DOC import (they share the filename-fallback importer that the TXT case covered); a packaged build.

## 17. Files changed

Main process (`source/apps/reading-book-desktop/electron/`):

- `files/sandbox.ts` — `BookFileStorage`, `bookFileStorage`, `checkRegisteredBookPath`, `resolveBookFile`,
  `removeManagedBookDir`, covers helpers (`getCoversPath`, `assertCoverPathAllowed`, `removeCoverFile`),
  `isPathInsideUserData`; `assertPathAllowed` and `copyIntoBooksSandbox` kept (URL/cloud).
- `files/relink-book.ts` (new) — hash-verified relink.
- `files/open-book-content.ts`, `files/cover-protocol.ts`, `files/metadata-filename.ts` — use the new checks;
  `coverDirForBook` removed.
- `ipc/import.ipc.ts` — local import by reference; shared `finishImport` with `ownsFile`; URL cleanup.
- `ipc/cloud.ipc.ts` — dropped the `entry.localPath` branch; request + extension validation.
- `ipc/library.ipc.ts`, `ipc/channels.ts`, `ipc/api-types.ts`, `preload.ts` — `fileStorage`,
  `relinkBook`, `RelinkBookResult`, guarded delete, `localPath` removed from the cloud DTO.
- `adapters/epub.adapter.ts`, `adapters/importer-registry.ts` — covers go to an injected app-owned dir.
- `chunking/book-chunk-service.ts`, `persistence/backfill-library-metadata.ts` — read via `resolveBookFile`.

Renderer (`source/apps/reading-book-desktop/src/`):

- `bridge/library.ts`; `hooks/reader/useReaderBookOpen.ts`, `screens/Reader/logic/hooks/useReaderBookOpen.ts`
  (expose `openErrorCode`); `screens/Reader/logic/bookRelink/bookRelinkStore.ts` and
  `screens/Reader/logic/hooks/useBookRelink.ts` (new); `screens/Reader/components/chrome/ReaderOpenStatus.tsx`,
  `screens/Reader/ReaderScreen.tsx` (Locate file); `screens/Library/components/book/BookItemMenu.tsx`,
  `screens/Library/LibraryScreen.tsx` (delete affordances and wording).

The working tree also holds unrelated in-flight work (SDK extraction, migrations 020/021, search,
translation, read-aloud, snapshot). It is not part of this change.

Documentation: see the list in the final report; this file plus SDS 1.24, SRS 1.7, `schema.dbml`,
`sqlite-database.md`, `PROJECT_BRIEF.md`, `CLAUDE.md`, `docs/note/cau_truc_2_app.md`,
`docs/ke-hoach-trien-khai/{03,07,10}`, `docs/plan/04_Phase_MVP_Free_Core.md`, `docs/diagram/wf-02-import/wf-02.puml`.
