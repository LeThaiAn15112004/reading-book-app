# Multi-chapter audiobook import (ZIP) — audit and plan

Status: **plan only, not implemented.** Revision 4 (final review) — incorporates the product decisions (§0) and D8–D11; §10 is resolved; see §10 for the readiness statement. Follows
`audiobook_zip_import_preview.md`. Statements about current behaviour were checked against the source.

## 0. Product decisions (binding)

| # | Decision | Where it lands |
|---|---|---|
| D1 | **Stage A + B ship together.** They may be built and tested as separate internal steps; no user-facing build may import a multi-chapter book that plays only chapter 0. | §6 (gate), §5 |
| D2 | Keep the *remove record* vs *delete managed files* distinction; never leave an unreachable chapter folder; do not silently change an existing action's meaning. | §4 |
| D3 | Try to read each track's duration at import; `duration_seconds` may be NULL; a missing duration never rejects a playable track; the virtual timeline must not claim an inaccurate total/percent. | §2, §5.4 |
| D4 | Embedded chapters inside individual files are **ignored** for ZIP multi-track books (documented limitation); single-file audiobook chapter behaviour is unchanged. | §5.5, §9 |
| D5 | Mixed supported formats in one book; each track validated independently; parent `books.file_format` is not the format of every chapter. | §2, §5.1 |
| D6 | Title = ZIP file name without extension; author from the first selected track; explicit cover choice, else the established cover detection/fallback; later tracks never overwrite parent metadata; metadata editing unchanged. | §3.4 |
| D7 | Parent hash = deterministic hash of the ordered track hashes; same tracks in the same order from different ZIPs ⇒ duplicate; different selection/order ⇒ different hash; single-file duplicate behaviour not weakened. | §3.3 |
| D8 | **One selected track ⇒ the existing single-file audio import path**, unchanged (metadata, duplicate detection, storage, playback). Never a one-track multi-chapter book. A cover chosen in the preview is **not** applied in this case, and the preview says so before confirmation. | §3.2 |
| D9 | **One destructive "Remove audiobook…"** for multi-chapter books: deletes the app-managed chapter folder, chapter rows and cover; never touches the user's ZIP; folder deletion failure ⇒ record kept + failure reported. Single-file remove/delete unchanged. | §4 |
| D10 | **Minimum playback restore is part of A+B**: persist/restore current `trackId` + position-in-track. No new Notes behaviour, no new percentage logic, no progress-system refactor. | §5.6 |
| D11 | **Release gate**: the ZIP import entry stays unavailable until import and multi-track playback both pass verification; use the existing `features` mechanism. | §6 |

## 1. Current architecture (exact code paths)

**ZIP → preview (done).** `ImportMenu` "Audiobook ZIP" → `zipImportStore.start()` → `zipImport:pick`
(`electron/ipc/zip-import.ipc.ts`; native dialog, path never from the renderer) → `ZipImportService.inspect`
(`electron/zip-import/zip-import-service.ts`) → `readZipDirectory` (`zip-reader.ts`: central directory only, limits, path safety)
→ `probeAudioFile` per audio entry (`adapters/audio.adapter.ts`, `duration: false`) → `ZipImportPreview` (ids `e<index>`).
Main keeps an in-memory session `{ zipPath, fileSize, mtimeMs, directory, preview }` (30 min TTL, max 4).

**Preview → import boundary (done, stubbed at the end).** `zipImport:confirm` → `ZipImportService.confirm`: session →
`validateZipSelection` → re-stat ZIP → `readZipDirectory` again → per selected entry compare path / method / sizes / CRC /
local offset → `AudiobookImportRequest { archivePath, archiveName, chapters[] (playback order, each with its `ZipEntryRecord`),
cover, directory }` → `options.importer ?? unavailableAudiobookImporter` (returns `import_not_available`). This is the only function
to replace; the request already has everything extraction needs. `ZipImportErrorCodeDto` has **no `duplicate`** yet.

**Single-file import (reference).** `import.ipc.ts`: `importFromFile` → `rejectIfDuplicate` (`hashFile` → `findBySha256` →
`duplicateResult(existingId)`, message "This book is already in your local library. Open the existing copy?", rendered by
`ImportConflictDialog` via `useLibraryImport.handleCommonResult`) → `finishImport` → `getDocumentImporter(format)` → `persistImportedBook`
→ `SqliteLibraryStore.persistImportedBook` (one transaction: `books` + authors; genres + empty reading state are columns). URL/cloud
files go through `copyIntoBooksSandbox` (`{userData}/books/{uuid}/{basename}`, chmod 444).

**Schema (migrations 001–027).** `books`: `file_path NOT NULL`, `file_format` CHECK (epub, pdf, txt, md, docx, doc, mp3, m4a, m4b, aac, wav,
flac, ogg, opus), `sha256` **UNIQUE**, `cover_path`, `metadata_json`, `reading_state_json`. No chapter/track table, no multi-file
concept anywhere. 026/027 rebuilt `books` to widen the CHECK (runner: `foreign_keys` OFF, one transaction per migration, `migrate.ts`).
`AudioChapter` and `audioBookmarks` are time ranges *inside one file*.

**Path model.** `bookFileStorage` = `managed` iff inside `{userData}/books`. `checkRegisteredBookPath` accepts any absolute sandbox path for a
managed book (no extension check) and requires the format's extension for referenced paths. `resolveBookFile` adds realpath/stat/access.
`removeManagedBookDir` deletes `dirname(file)` only when `dirname(dirname(file)) == sandbox`.

**Playback.** `rb-audio://local/{bookId}` (`audio-protocol.ts`): `findById` → `isAudioFormat(book.format)` → `resolveBookFile` →
`createAudioStreamHandler` (206/416; MIME from `audioMimeForFormat(format)`). `audioPlayerStore.load`: `libraryApi.openBookContent`
preflight (empty buffer for audio after the path check), one `Audio`, `el.src = audioStreamUrl(bookId)`, restore via `resolveRestorePosition`,
`ended` only stops (no auto-advance), embedded chapters via `audio:getChapters` → `normalizeChapters`, prev/next via
`previousChapterTarget`/`nextChapterTarget`, scope via `timelineView` (returns **null while the duration is unknown** — a safe pattern to reuse).

**Progress & Notes.** `reading_state_json.audioProgress { positionSeconds, durationSeconds?, playbackRate, scope?, chapterId?, updatedAt }` +
`percent` (= `audioProgressPercent(position, duration)`, omitted when duration unknown), written by `overlay:saveAudioProgress` (`json_patch`,
SQL-limited to the audio format list). Notes: `audioBookmarks[]` `{ positionSeconds, chapterId?, chapterOffsetSeconds? }`;
`resolveBookmarkTarget` prefers `chapter.start + offset`.

## 2. Data model (migration `028_book_audio_chapters.sql`)

`books` stays the parent; chapters need one new table (a plain `CREATE TABLE`, no `books` rebuild, no FK-off/rename risk). Register in
`MIGRATIONS` (`migrate.ts`, `?raw` import) like 026/027.

```sql
CREATE TABLE IF NOT EXISTS book_audio_chapters (
  id               TEXT    PRIMARY KEY NOT NULL,           -- UUID, stable for the life of the book (the future trackId)
  book_id          TEXT    NOT NULL,
  position         INTEGER NOT NULL CHECK (position >= 0), -- 0-based playback order
  title            TEXT    NOT NULL,                       -- tag title, else file stem
  file_name        TEXT    NOT NULL                        -- basename inside the book's folder; NOT a path
    CHECK (file_name <> '' AND instr(file_name, '/') = 0 AND instr(file_name, char(92)) = 0 AND file_name NOT IN ('.', '..')),
  source_path      TEXT    NOT NULL,                       -- archive-relative path; display/provenance only, never opened
  file_format      TEXT    NOT NULL
    CHECK (file_format IN ('mp3','m4a','m4b','aac','wav','flac','ogg','opus')),   -- D5: per chapter
  size_bytes       INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256           TEXT    NOT NULL,
  duration_seconds REAL    CHECK (duration_seconds IS NULL OR duration_seconds > 0),  -- D3: NULL = unknown
  FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE,
  UNIQUE (book_id, position),
  UNIQUE (book_id, file_name)
);
CREATE INDEX IF NOT EXISTS idx_book_audio_chapters_book ON book_audio_chapters (book_id, position);
```

- **A book is multi-chapter iff it has rows here** (single source of truth, no flag column). Existing books have none ⇒ every existing
  path is unchanged; older app builds ignore the table.
- **Parent row & D5.** `file_format` must satisfy the CHECK and the app routes by `isAudioFormat(book.format)` in `audio-protocol.ts`,
  `audio.ipc.ts`, `sqlite-audio-store.ts`, `saveAudioProgress` (SQL `IN (...)`), `ReaderRoute`. Adding a new parent value (`'audiobook'`) would
  need another `books` rebuild plus edits to `DocumentFormat`, `@reading-book/config` formats and ~6 `IN` lists — rejected as larger and riskier.
  **Decision:** parent `file_format` = format of chapter 0, used **only** as the "this is an audio book" routing marker; it is never used for MIME,
  validation or extension checks of any other chapter. Every consumer that touches bytes resolves the format from the chapter row (§5.2).
  *Residual risk R1:* code that reads `book.format` as "the file's format" must be audited per consumer (table in §4.1).
- **Parent `file_path`** = chapter 0's managed path. This keeps `removeManagedBookDir`, `checkRegisteredBookPath`, `resolveBookFile` and
  the openBookContent preflight valid with no change, but it means **`file_path` no longer identifies the whole book** — see §4.1.
- **Layout (no overwrite).** `{sandbox}/{bookUuid}/{position:04d}-{chapterId8}.{ext}`; absolute path = `dirname(books.file_path)/file_name`,
  never stored. Duplicate basenames from different archive folders cannot collide (position + id; `UNIQUE (book_id, file_name)`).
- **Cascade.** Deleting the book cascades chapter rows (`foreign_keys = ON` at runtime, `db.ts`).
- **`fileSizeBytes`** (in `metadata_json`) = sum of chapter sizes.

## 3. Import transaction

Replace `unavailableAudiobookImporter` with `createZipAudiobookImporter(deps)` (new Main file, Electron-free like the service; deps:
`booksRoot`, `coversDir`, `tmpRoot`, `probe`, `store`).

### 3.1 Steps
1. **Revalidate** — done by `confirm` (session, ZIP stat, directory re-read, entry fingerprints, selection). Add: sandbox writable and
   free space ≥ sum of declared sizes + margin, else fail before writing.
2. **Extract** each selected chapter in order, one at a time, into `{userData}/zip-import-tmp/<random>/` using `extractEntryToFile`
   (actual-byte guard, `wx`), hashing with SHA-256 while streaming (tee; no second read). Cover: `readEntryBytes` ≤ 10 MiB + `sniffImageMime`.
3. **Validate** each extracted file independently with `probeAudioFile(file, ownFormat)` (D5; the format comes from that entry's extension,
   the codec check is the existing rule) on the full file; read tags (title/artist/picture). Duration (D3): `parseFile(..., { duration: true })`;
   if it yields nothing/throws **after the validity check passed**, store NULL — never reject for that. Any validity failure aborts the whole
   import and names the track.
4. **Place**: `mkdir {sandbox}/{bookUuid}`, write `.partial` marker, `rename` tmp → final names (same volume ⇒ atomic; else copy+fsync+unlink), chmod 444.
   Cover → `{userData}/covers/{uuid}.{ext}`.
5. **Persist in ONE SQLite transaction** — new `SqliteLibraryStore.persistImportedAudiobook(book, authors, genres, chapters[])` (same pattern as
   `persistImportedBook`): `books` + authors + all chapter rows. UNIQUE violation on `sha256` ⇒ duplicate (§3.3).
6. **Finish**: remove the `.partial` marker, remove tmp dir (always, `finally`), discard the session.
7. **Rollback**: failure after step 4 ⇒ `removeManagedBookDir` on the new folder + `removeCoverFile`; DB transaction already rolled back.
8. **Cancellation**: `zipImport:cancelImport` via `beginCancellable('zip-import')` (`import-cancel.ts`); the `AbortSignal` goes into
   `extractEntryToFile`; checked between steps; not cancellable after the DB commit (same rule as URL import). Progress events `n of N`
   (new `zipImport:progress`, like `import:progress`).
9. **Orphan cleanup**: startup sweep removes only `{sandbox}/{uuid}` folders that still contain `.partial` (crash between 4 and 5). It never
   deletes a folder without the marker. (Pre-existing, out of scope: a managed single-file book removed via "Remove from library" leaves its file — see §4.)

The user's ZIP is only opened read-only. Nothing is concatenated or transcoded. ZIP limits (entries, sizes, depth, path safety, symlinks, encrypted)
stay enforced by the existing reader.

### 3.2 Single track selected (D8)
`confirm` handles `chapters.length === 1` **before** the multi-chapter importer: it extracts that one track to the tmp dir and then calls the *existing*
`importDownloadedFile(tempPath, {})` (`import.ipc.ts`): `assertSupportedExtension` → `rejectIfDuplicate` (plain file SHA-256) → `copyIntoBooksSandbox`
(`{sandbox}/{uuid}/{basename}`) → `finishImport` (`probeAudioFile` + tags/cover through `audio.adapter.ts`, `persistImportedBook`). Result: an ordinary
managed single-file book — same title/author/cover conventions, same duplicate message (`duplicate` + existing `bookId`), same playback. Differences from the
multi path, stated explicitly: title comes from the track's own tags/file name (the single-file convention), **not** the ZIP name; a cover selected in the ZIP preview
is **not applied** (accepted limitation: the existing single-file importer has no cover override and it is **not** extended for this case — the book gets the track's embedded
picture or the generated fallback, exactly as a standalone file would).

**The preview must say so before the user confirms** (renderer-only, no IPC change). Pure helper in SDK `audio-zip-import.ts`: `importModeForSelection(selection): 'none' | 'single-file' | 'multi-chapter'`
(0 / 1 / ≥2 selected tracks) and `singleFileImportNotes(selection)` returning the notice strings. `AudiobookZipImportDialog` evaluates it from the *live* selection (the user can tick/untick tracks), so the notice
appears and disappears as the count crosses 1:
- under the Cover section, when mode is `single-file` and a cover is selected: *"With one track this is imported as a single audio file. The cover selected here won't be used; the track's own cover (or a generated one) is used instead."* (the cover picker stays visible but is marked inactive);
- under the chapter list, when mode is `single-file`: *"The title comes from the track's own tags or file name, not from the ZIP name."*;
- confirm button label: "Import audiobook" (mode `single-file`) vs "Import N chapters" (mode `multi-chapter`).
Both notices are `role="note"` text, shown before the confirm button is reachable (same panel), not a post-import toast. Tests: SDK vitest on the helpers (0/1/2 tracks, with/without cover, toggling) — the dialog itself has no component runner, so
its three conditionals are kept trivial (`importModeForSelection` + the two strings) and are checked in the manual release checklist (§8). No chapter row is ever written for one track. `importDownloadedFile` needs the tmp file named with
the track's real extension (`<tmp>/<basename>`); the tmp dir is removed in `finally` (`importDownloadedFile` does not own `tempPath`).

### 3.3 Duplicate detection (D7) — current behaviour inspected
Today duplicates are `books.sha256` equality (`rejectIfDuplicate` before copying; also a late UNIQUE-constraint catch in `finishImport`),
reported as `{ ok:false, errorCode:'duplicate', bookId }` and shown by `ImportConflictDialog` ("Open existing copy"). For ZIP books:
`parentSha = SHA-256("readmate-audiobook-v1\n" + chapterSha256[0] + "\n" + … )` over the ordered selected tracks. The prefix guarantees it can
never equal a real file hash, so single-file duplicate logic is untouched. Consequences, to be documented in UI copy and tests: same tracks,
same order, from **different ZIPs** ⇒ duplicate; a different subset or order ⇒ new book; a ZIP track is not a duplicate of an identically-hashed
standalone mp3 (different hash domain). The importer computes the parent hash after extraction (hashes are free from the stream), checks
`findBySha256` **before** placing files into the sandbox (cheap: tmp only), and keeps the UNIQUE catch as the race backstop. Add `'duplicate'`
(+ `bookId`) to `ZipImportErrorCodeDto`/`ZipImportFailureDto` and route it through `ImportConflictDialog` (`showConflict`) from
`zipImportStore` instead of a plain error. Message reused as is.

### 3.4 Metadata defaults (D6)
Title = ZIP file name minus extension (`path.parse(name).name`). Author(s)/genres = first selected track's tags only (existing convention: `common.artists`
/ `artist`, `genre`, as `audio.adapter.ts`). Description = first track's album, as today. Cover: the user's explicit choice (a candidate id) →
else the preview's default candidate → else first track's embedded picture → else the existing no-cover fallback (generated cover,
`library:setGeneratedCover`). "No cover" chosen explicitly ⇒ the fallback, not a tag picture (user said none). Later tracks' tags are used only for
their own `title` column. Editing metadata goes through the existing `library:updateMetadata` unchanged.

## 4. Deletion semantics (D2) — inspected

**Existing UI/behaviour** (`BookItemMenu.tsx`, `LibraryScreen.tsx`, `library.ipc.ts`):
- "Remove from library" → `library:removeBook`: `deleteCascade` + cover + TXT data; **file kept**. Dialog text: *"Your original file will not be
  touched."* (referenced) or *"Its imported file will be kept."* (managed).
- "Delete file…" (only `fileStorage === 'managed'`, red/destructive) → `library:deleteBookFile`: `removeManagedBookDir` + `deleteCascade` + cover.
  Dialog: *"…and its imported file will be permanently deleted. This cannot be undone."*
- Pre-existing fact: a managed single-file book removed with "Remove" leaves `{sandbox}/{uuid}/file` on disk with no UI path back to it
  (no relink to the sandbox is allowed — `relinkBookToFile` refuses paths inside userData). Accepted today for one file; not changed here.

**Problem for multi-chapter books.** All chapter files are app-owned (always `managed`; the user's original is the untouched ZIP). "Remove (keep
files)" would leave N unreachable files + folder, which D2 forbids, and "Delete file…" would be the *only* way to free them — the two actions cannot
both be meaningful. The UI therefore *cannot* express the keep/delete distinction safely for this book type.

**Decided behaviour (D9):**
- For a multi-chapter book the menu shows **one** destructive action, "Remove audiobook…", replacing both entries (`BookItemMenu.tsx`: `isMultiChapter` hides "Remove from
  library" and "Delete file…"; `LibraryScreen.tsx`/`useLibraryScreen.ts` add a third `pendingRemoval` kind `'remove-audiobook'`). Confirmation text, destructive button:
  *"“Title” and its N imported chapter files will be permanently deleted from Readmate. Your original ZIP is not touched. This cannot be undone."*
  Backend: new channel `library:removeAudiobook` (not a reinterpretation of `removeBook`/`deleteBookFile`). Order: re-load the book and require chapter rows → `removeManagedBookDir`
  (refuses anything but `{sandbox}/{uuid}/{file}`; uses chapter 0's path) → **only if it returned true** `deleteCascade` (chapter rows cascade) → `removeCoverFile`. If folder
  removal throws or refuses ⇒ `{ ok:false, errorMessage }`, the record and rows stay (nothing orphaned, user can retry) and the UI toast reports the failure. The ZIP is never
  opened for writing or deleted by this path (it is not referenced anywhere after import).
  Defense in depth: `removeBook` and `deleteBookFile` **refuse** (`ok:false`) when the book has chapter rows, so no other entry point can leave the folder behind; for every
  single-file book both handlers are byte-for-byte unchanged.
- Single-file books (referenced and managed): **no change** to labels, dialogs or backend.
- Needs `chapterCount` (or `kind: 'multi'`) on `BookDto` so the renderer can switch the menu/dialog; `fileStorage` stays `managed`.
- Single-file books (referenced and managed): labels, dialogs and backend unchanged.

### 4.1 Audit of every `books.file_path` / `book.format` consumer (chapter 0 ≠ the whole book)

| Consumer | Today | Needed for multi-chapter |
|---|---|---|
| `rb-audio` protocol (`audio-protocol.ts`) | book id → path → MIME from `book.format` | per-chapter URL; path = folder + `file_name`; MIME from chapter format (§5.2) |
| `library:openBookContent` / `open-book-content.ts` | audio ⇒ path check, empty buffer | unchanged (checks chapter 0 only — acceptable as preflight, **but** the player must also verify every chapter it opens; a missing chapter N must surface a per-track error) |
| `audio:getChapters` | reads tags of `file_path` | multi: return no embedded chapters (D4); new `audio:getTracks` |
| `library:showInFolder` | `shell.showItemInFolder(file_path)` | shows chapter 0 selected inside the folder — acceptable (the folder *is* the book); label "Open file location" stays |
| `library:copyFilePath` | copies chapter 0 path | **misleading**: for multi books copy the **folder** path (`dirname`), not a file |
| `library:relinkBook` / `relink-book.ts` | single file sha256 == `books.sha256` | **must be disabled** for multi books (parent sha is not a file hash; managed books can't be relinked anyway — guard explicitly and hide "Locate file") |
| `removeBook` / `deleteBookFile` | §4 | §4 |
| `getStorageUsage` (`storage-service.ts`) | `directorySize(sandbox)` | automatic — all chapters live under the sandbox |
| `BookDto.fileName`/`fileSizeBytes` (`library.ipc.ts` `toBookDto`) | `basename(filePath)`, metadata size | multi: `fileName` = the audiobook title/folder label not chapter 0's file name; size = sum (already in metadata) |
| Library Info dialog | shows `fileName`, format | show "N chapters", formats summary, not "mp3" for a mixed book |
| `verifyOnImport` / signature | non-PDF ⇒ `unsupported` | skip for audio (no change) |
| chunking / FTS / word count | `isChunkableFormat` excludes audio | unchanged |
| `library:setGeneratedCover`, cover protocol | by book id | unchanged |
| **Continue Reading** (`pickContinueReadingBooks`) | requires `status === 'reading'` **and** a `lastReadLocation` label; `saveAudioProgress` never writes `lastReadLocation` | **finding:** *no audiobook (single-file either) appears in Continue Reading today.* Out of scope; multi-chapter inherits the same behaviour. Do not assume otherwise. Stage C may decide to feed it; `percent` must stay omitted while unknown (§5.4). |
| `markAsReading` | by id | unchanged |
| Collections, favorites | by id | unchanged |

## 5. Player integration (Stage B; compatibility model for Stage C)

### 5.1 Principles
- One virtual timeline for display; **one file at a time in the `<audio>` element**. Tracks map onto the existing `AudioChapter` shape
  (`id = chapterId`, `title`, `startSeconds`, `endSeconds`) so the chapters panel, prev/next, Notes chapter refs and `timelineView` are reused.
- Single-file books take the exact existing path (no rows ⇒ branch not taken). This is enforced by one predicate, `isMultiTrack = tracks.length > 0`.
- Format is per track (D5): the stream handler, MIME and probe use the chapter's own `file_format`.

### 5.2 Source resolution
`rb-audio://local/{bookId}/{chapterId}`; `parseAudioRequestUrl` accepts an optional second path segment (still rejects `/`, `\`, NUL, other hosts;
`chapterId` must match a UUID pattern). `AudioFileLookup(bookId, chapterId?)`: book → `isAudioFormat` → rows → chapter row →
`path.join(dirname(book.file_path), row.file_name)` → containment check (`path.relative` not starting with `..`, inside the book's own folder,
which itself is inside the sandbox) → `fs.realpath` + regular file → `{ path, format: row.file_format }`. Book-only URL keeps meaning
"the book's file" (single-file) and for a multi book resolves chapter 0 (back-compat for the preflight). Never accept a path from the renderer.

### 5.3 Navigation, auto-advance, restore
- New `audio:getTracks(bookId)` → `{ id, title, durationSeconds | null }[]` in order (no paths).
- Player store: `tracks`, `trackIndex`. `goToTrack(i, offset?)` = pause → bump `generation` (existing stale-load guard) → `el.src = streamUrl(book, track)`
  → on `loadedmetadata` seek to `offset` → resume if it was playing. `previousChapter`/`nextChapter` in multi mode move between tracks
  (previous: restart the track if > ~3 s in, as `previousChapterTarget` does within a chapter). **Auto-advance:** `ended` in multi mode loads track i+1 and
  plays; last track ⇒ existing ended behaviour. Sleep "end of chapter" = end of the current track. A track whose file is missing/unplayable shows
  the existing `media_error` UI for that track without losing the book (user can skip).
- Any selected track is directly playable from the chapters panel (`goToTrack`).
- Single-file books: none of this code runs.

### 5.4 Unknown durations (D3)
Total duration is claimed only if **every** track has a known duration (stored, or learned from the element after it first loads and then
written back with `UPDATE … SET duration_seconds` guarded by `IS NULL`). Otherwise: `timelineView` receives `null` for the total (it already returns
`null`), Book scope is unavailable (UI falls back to Chapter/track scope), no total time or remaining time is shown, and `percent` is **deleted** on every
multi-book save (explicit `null` in the merge-patch, §5.6 — omission would leave a stale value). In this release Book scope and totals stay unavailable for multi books even when all durations are known (Stage C). Per-track scope always works (the element knows the current file's duration).
Partial knowledge never produces a "sum of the known ones" total.

### 5.5 Embedded chapters (D4)
Ignored for multi-track books: `audio:getChapters` returns `{ ok:true, chapters: [] }` for them and the track list is the only chapter list.
Documented limitation: an M4B with its own chapter markers imported via ZIP loses them as navigation points (the audio is intact). Single-file
books keep `getChapters`/`normalizeChapters` exactly as today.

### 5.6 Minimum restore: `trackId` + position in track (D10)

**Current flow (inspected).**
- *Save:* `audioPlayerStore.persist()` (throttled by `shouldPersistProgress`; forced on pause, seek, rate change, ended, flush-on-close via `registerSessionFlushHandler`) builds
  `{ bookId, positionSeconds: el.currentTime, playbackRate, scope, durationSeconds?, chapterId? }` → `overlayApi.saveAudioProgress` → `overlay:saveAudioProgress` (`overlay.ipc.ts`) →
  `sanitizeAudioProgressInput` (SDK `audio-progress.ts`; a **whitelist** — unknown keys such as `trackId` are silently dropped) → `SqliteOverlayStore.saveAudioProgress` →
  `json_patch(reading_state_json, audioProgressPatch(input))` on `books` rows `WHERE file_format IN ('mp3','m4a',…)`.
- *Restore:* `audioPlayerStore.load` → `overlayApi.getAudioProgress` → `SqliteOverlayStore.getAudioProgress` → `parseAudioProgress` (also a whitelist) → `AudioProgressDto` (`api-types.ts`) →
  on `loadedmetadata`: `resolveRestorePosition(progress.positionSeconds, el.duration)` then `el.currentTime = start`.

**Where the new data lives.** `reading_state_json.audioProgress.trackId` (a `book_audio_chapters.id`) and the existing `audioProgress.positionSeconds`, which **for a book that has `trackId` means seconds within that track**,
written by the same `persist()` call in the same single `json_patch`, so track and position cannot be saved out of step.

**JSON merge semantics — inspected, and a correction to Revision 3.** `json_patch` is RFC 7396 *merge-patch*, applied recursively: a key **absent** from the patch keeps its stored value; only `null` deletes it.
Verified with SQLite's `json_patch` on a stored state `{"percent":42,"audioProgress":{"positionSeconds":100,"durationSeconds":3600,"scope":"book","chapterId":"c1",…},"audioBookmarks":[…]}`:
patch `{audioProgress:{positionSeconds:5,playbackRate:1,trackId:"t1",updatedAt:"b"}}` ⇒ **`percent:42`, `durationSeconds:3600` and `chapterId:"c1"` all survive** (they would be read as book-level progress / a total duration);
patch with explicit nulls `{percent:null, audioProgress:{…, durationSeconds:null, chapterId:null}}` ⇒ those three keys are removed and `audioBookmarks`, `lastReadLocation` etc. are untouched. Therefore "omit `percent`/`durationSeconds`
when `trackId` is present" (Revision 3) is **insufficient**; it must **delete**. (The same omission semantics already exist for single-file books — a stale `percent` can persist when the duration becomes unknown — and are deliberately left alone: single-file output must stay byte-identical.)

**Smallest safe patch behaviour (`audioProgressPatch`).** Only when `input.trackId` is a non-empty string:
- `audioProgress.trackId = input.trackId`;
- `audioProgress.durationSeconds = null` and `audioProgress.chapterId = null` (merge-patch deletes), **regardless of what the input carried** (a track's own duration must never be stored as the book's, and embedded-chapter ids are ignored for multi books, D4);
- top-level `percent = null` (deletes any stale value; **no percentage is computed**, `audioProgressPercent` is not called on this branch);
- everything else (`positionSeconds`, `playbackRate`, `scope`, `updatedAt`) as today.
When `trackId` is absent the function returns exactly what it returns today (golden fixture in the vitest suite). The renderer additionally does not send `durationSeconds`/`chapterId` for multi books, but Main's patch does not rely on that.

**Changes (all minimal):**
1. SDK `audio-progress.ts`: `AudioProgress.trackId?`, `AudioProgressInput.trackId?: string` (≤ 100 chars, same rule as `chapterId`), `sanitizeAudioProgressInput`, `parseAudioProgress` (round-trips `trackId`), `audioProgressPatch` as above.
2. `api-types.ts`: `AudioProgressDto.trackId?`, `SaveAudioProgressInput.trackId?` (preload passes objects through; no channel change).
3. `sqlite-overlay-store.ts` `saveAudioProgress` — **data-layer guard so a track-relative position can never be stored for the wrong shape of book:** look up whether the book has chapter rows (`SELECT 1 FROM book_audio_chapters WHERE book_id = ? LIMIT 1`):
   multi book ⇒ the input **must** carry a `trackId` that exists for *that* book (`… WHERE id = ? AND book_id = ?`), else return `false`; single-file book ⇒ a `trackId` is rejected (`false`). The existing `file_format IN (…)` guard stays valid (the parent's format is an audio format, §2).
   `getAudioProgress` returns what is stored (the player validates, below).
4. Player (`audioPlayerStore.ts`): `persist()` adds `trackId` from the store **only when `tracks.length > 0`**, never sends `chapterId`/`durationSeconds` then, and does nothing while `status !== 'ready'` (so a switch in flight cannot save). Restore in `load` after `audio:getTracks`:
   `index = tracks.findIndex(t => t.id === progress?.trackId)`; **found** ⇒ initial src = that track and the position restored with `resolveRestorePosition(progress.positionSeconds, el.duration)` on that track's `loadedmetadata`;
   **not found, `trackId` absent, or `trackId` not a string** ⇒ track 0 at position 0 and `progress.positionSeconds` is **discarded** (never applied). A multi book only ever applies a position together with a matching `trackId`; a single-file book never reads `trackId`.

**Backward compatibility (single-file).** `tracks` is empty ⇒ `persist()` sends no `trackId`; `sanitizeAudioProgressInput`/`audioProgressPatch`/`parseAudioProgress` outputs are unchanged for inputs without `trackId` (golden tests on today's outputs);
`saveAudioProgress` for a single-file book with no `trackId` takes the old path (the extra look-up returns "no chapter rows"); old rows have no `trackId` and are read as before; the restore branch for single-file books is the existing code, untouched. Merge-patch keeps `audioBookmarks`, typography and unknown keys. Downgrade: an older build cannot open the
chapter table; it would play chapter 0 with a track-relative position (documented, acceptable; no `books` schema was changed).

**IPC DTOs / SQL guards / generation logic.** DTOs: the two `trackId?` fields (no new channel). SQL: the new multi/single guard in `saveAudioProgress` (above); the format `IN (…)` guards unchanged.
Generation: `load()`'s `generation` already protects restoring *into* a track (same call). **Switching while loaded** (`goToTrack`, prev/next, auto-advance) needs a per-switch token `trackSwitch` (incremented synchronously, captured by the `loadedmetadata` handler so a late event from the previous file cannot seek the new one) and
`status: 'loading'` + the new `trackIndex` set in the same synchronous block as the `src` change, with the forced `pause` save issued **before** `src` changes. Edge rule kept from single-file: a saved position within `RESTART_NEAR_END_SECONDS` of a track's end restarts *that track* at 0.

**Stage C limitations — explicit, enforced, and verified (D10).** Until Stage C, multi-track audiobooks have **Notes disabled and hidden** and **no book-level percentage**:
- *Notes UI hidden for multi books* (`tracks.length > 0`): `AudioControls.tsx` (add-note button, ~line 114), `AudioSidebar.tsx` (notes list / add control, ~lines 144–168; the sidebar shows the Chapters/Tracks section only), `AudioNoteMenu.tsx` is reachable only from those two and from `AudioTimeline.tsx`
  markers (`notes` is empty for multi books so no markers render). `audioPlayerStore.addNote` returns `null` and `goToNote` is a no-op when `tracks.length > 0`; `load` skips `audio:getBookmarks` for multi books (`notes: []`).
- *Notes enforced in Main* (UI is not the only barrier): `SqliteAudioStore.saveBookmarks` adds `AND NOT EXISTS (SELECT 1 FROM book_audio_chapters WHERE book_id = books.id)` ⇒ `false` for multi books; `getBookmarks` returns `[]` for them. Single-file books: unchanged queries' behaviour (the extra predicate is true for them).
- *No book-level percentage*: `percent` is deleted on every multi save (above) and never written; `toBookDto`/`summaryFromState` therefore yield no `progressPercent` for multi books (and Continue Reading already needs `lastReadLocation`, which audio never writes); the player shows no total, remaining time or Book scope for multi books (§5.4 — Book scope is unavailable until Stage C).
- *Single-file audiobooks unchanged:* Notes (add/edit/delete/go-to, timeline markers, `audio:*Bookmarks`), `audioProgress`, `percent`, Book/Chapter scope behave exactly as today; covered by regression tests in §8.

**Out of scope (Stage C):** Notes for multi books, any book-level `percent`/remaining-time logic, Book-scope timeline from summed durations, Continue Reading integration, refactors of `audio-progress.ts`/`audioPlayerStore.ts` beyond what is listed.

## 6. Staging and release gate (D1, D11)

- **A (schema + import)**, **B (playback + navigation + minimum restore)** are separate internal steps/commits but **one release**. Stage C (Notes in multi books, percent/remaining time, Continue Reading) is a later, separate stage.
- **Gate mechanism — existing, inspected.** `source/packages/config/features.ts` already defines `FeatureFlags` / `defaultFeatures` / `features` (build-time constants, SDS §2.11). The desktop does not read it today, so no runtime toggle
  system exists or is added: add **one** field, `audiobookZipImportEnabled: false`, to that interface and object (mobile's compile is unaffected; no other flag changes). Read it in exactly two places:
  (1) `ImportMenu.tsx` renders the "Audiobook ZIP" button/menu item only when `features.audiobookZipImportEnabled`; (2) `registerZipImportIpc()` registers the `zipImport:*` handlers only when it is true (renderer cannot bypass the UI gate through
  `window.api`; the preload keeps the typed surface, calls simply have no handler). The flag is flipped to `true` in the **last** commit of the release, after the verification checklist in §8 passes; before that the already-shipped preview stays unreachable.
- **Order inside the release:** A1 → A2 → B1 → B2 (incl. minimum restore) → gate review → flip the flag. At no commit is an importer reachable that yields a book the player cannot fully play.

## 7. File-by-file scope

**A — new:** `persistence/migrations/028_book_audio_chapters.sql`; `electron/zip-import/zip-audiobook-importer.ts`; SDK `src/audio/audio-book-layout.ts` (chapter file names, parent hash, `tracksToChapters`) + `tests/audio/audio-book-layout.test.ts`;
`spikes/audio/run-audio-zip-import.mjs` (+ npm script).
**A — changed:** `persistence/migrate.ts`; `sqlite-library-store.ts` (`persistImportedAudiobook`, `listAudioChapters`, chapter-count in listings); `ipc/zip-import.ipc.ts` (importer, N=1 → `importDownloadedFile` hand-off, `cancelImport`, progress, flag-gated registration);
`ipc/import.ipc.ts` (export what the hand-off needs — `importDownloadedFile` is already exported); `ipc/channels.ts`, `api-types.ts` (`duplicate`, `BookDto.chapterCount`, `removeAudiobook`), `preload.ts`; `bridge/zipImport.ts`, `bridge/library.ts`;
`hooks/library/zipImportStore.ts` (importing phase, duplicate → `showConflict`, library refresh); `components/import/AudiobookZipImportDialog.tsx` (single-file notices + button label via SDK `importModeForSelection`/`singleFileImportNotes`); SDK `audio-zip-import.ts` (the two helpers); `ipc/library.ipc.ts` (`toBookDto`, `copyFilePath` → folder, relink guard, new `removeAudiobook`, `removeBook`/`deleteBookFile` refuse multi books);
`BookItemMenu.tsx`, `LibraryScreen.tsx`, `useLibraryScreen.ts` (single "Remove audiobook…"); Library Info dialog (chapter count); `packages/config/features.ts` (+ flag); `ImportMenu.tsx` (flag); `spikes/audio/run-audio-migration.mjs`; `CLAUDE.md`.
**B — changed:** `audio/audio-protocol.ts`, `audio/audio-stream-handler.ts` (optional chapter segment); `ipc/audio.ipc.ts` (`getTracks`, empty `getChapters` for multi); `channels/api-types/preload/bridge/audio.ts`; `audioPlayerStore.ts` (tracks, `goToTrack`, advance, restore, `trackSwitch` token);
`AudioSidebar.tsx`/`AudioControls.tsx` (track list, prev/next, **Notes hidden for multi**); `AudioTimeline.tsx` (no change expected — `notes` is empty; verify only); `sqlite-audio-store.ts` (multi-book guards for `getBookmarks`/`saveBookmarks`); `sqlite-overlay-store.ts` (`saveAudioProgress` multi/single `trackId` guard); SDK `audio-progress.ts` (`trackId`, null-deleting patch) and `audio-book-layout.ts`; `run-audio-main.mjs`, `run-audio-store.mjs`.
**Not in this release (Stage C):** Notes for multi books, `percent`/duration totals, Continue Reading, Book-scope timeline.
**Untouched:** EPUB/PDF/TXT/MD, single-file audio import and progress behaviour, ZIP reader and preview, chunking.

## 8. Tests and verification

- SDK vitest (`cd source/apps/book-reader-sdk && npm run verify`):
  - layout: chapter file names (duplicate basenames never collide), parent hash (order / subset / prefix; never equals a file hash), `tracksToChapters`.
  - zip preview helpers: `importModeForSelection` (0 / 1 / 2 tracks; toggling), `singleFileImportNotes` (cover selected / not; multi ⇒ no notes).
  - **progress patch — regression suite for JSON merge semantics** (pure + a real SQLite round trip in the spike): (a) golden fixture: today's `audioProgressPatch` output for inputs without `trackId` is unchanged (with/without duration, scope, `chapterId`, `null` chapterId);
    (b) **a stored state that already has `percent: 42` and `audioProgress.durationSeconds: 3600` (and `chapterId`, `scope: 'book'`) patched with a `trackId` input — even one that carries `durationSeconds`/`chapterId` — ends with `percent`, `durationSeconds`, `chapterId` removed, `trackId`/`positionSeconds`/`playbackRate`/`updatedAt` updated, and `audioBookmarks`, `lastReadLocation`, typography intact**;
    (c) saving a track again keeps them absent; (d) `percent` is never *computed* on the `trackId` branch; (e) `sanitizeAudioProgressInput` keeps a valid `trackId`, drops empty/over-long/non-string, tolerates it with legacy fields; (f) `parseAudioProgress` round-trips `trackId` and parses legacy rows without it identically.
- `spike:audio:zip-import` (real SQLite on the migrated schema, real files): import order; duplicate basenames; **mixed formats**; per-track validation failure ⇒ complete rollback; NULL duration accepted; cancel mid-way; same tracks from a *different* ZIP ⇒ duplicate; different order/subset ⇒ new book;
  **one selected track ⇒ ordinary single-file book** (no chapter rows, plain sha256, duplicate of an existing identical file detected, `copyIntoBooksSandbox` layout, **ZIP-preview cover ignored — the book's cover is the track's own/generated**); single-file duplicate behaviour unchanged; ZIP byte-identical after import and after remove; `.partial` sweep;
  **remove audiobook:** folder + rows + cover gone, ZIP untouched, simulated `removeManagedBookDir` failure ⇒ `ok:false` and record + rows kept, `removeBook`/`deleteBookFile` refuse a multi book and behave as before for single-file books.
- `spike:audio:migration`: 028 on a populated DB (026/027-era rows intact, cascade works). It also re-runs the **merge-patch checks against the real better-sqlite3 build** (the headless Node check above used SQLite's `json_patch` through `node:sqlite`; the app's engine must be confirmed in its own ABI).
- `spike:audio:main`: per-chapter Range/206/416, mixed MIME, traversal/forged `chapterId`, symlinked chapter file, book-only URL back-compat; **progress IPC:** `overlay:saveAudioProgress`/`getAudioProgress` carry `trackId`; **write guards** — multi book without `trackId` ⇒ `ok:false`, with a `trackId` of another book or unknown ⇒ `ok:false`; single-file book with a `trackId` ⇒ `ok:false`; single-file book without ⇒ `ok:true` and unchanged JSON;
  **Notes guards** — `audio:saveBookmarks` ⇒ `ok:false` and `getBookmarks` ⇒ `[]` for a multi book; **single-file Notes round trip unchanged** (save/get/replace, other keys intact).
- `spike:audio:store` (scriptable `Audio`): advance on `ended`, last track stops, goTo/prev/next; **restore: saved `trackId` + position resumes in that track; missing / non-string / unknown `trackId` ⇒ track 0 at 0 and the saved position is never applied (assert `currentTime === 0` and that no seek to the old position happened)**;
  **stale-switch guard** (late `loadedmetadata` of the old track does not seek the new one; no save mixes old `trackId` with new `currentTime`); missing track file ⇒ per-track error; **multi book: `addNote()` returns null, `goToNote` no-op, `notes` empty, no `getBookmarks` call, no `percent`/`durationSeconds` in the saved payload**; **single-file: existing store tests unchanged** (notes, progress payload shape, chapters).
- Desktop: `npm run typecheck`, `npm run lint`, `npx vite build`. No E2E window is launched.
- **Release checklist (gate for flipping the flag):** all of the above green; single-file regression pass (import mp3, play, seek, resume, chapters, add/edit/delete a note, delete); manual import of one real multi-track ZIP (the 68-track LibriVox archive used in review) played across a track boundary, restored after restart, **Notes controls absent, no percent in the Library**;
  manual one-track ZIP with a cover selected ⇒ the preview notice is visible before "Import audiobook", and the imported book uses the track/generated cover. These are the only non-headless steps, run by a person.

## 9. Risks, assumptions, limitations

- **R1** parent `file_format` is only a routing marker (D5): every byte-level consumer must use the chapter row; covered by the §4.1 audit and the main spike.
- **R2** `file_path` = chapter 0 keeps old helpers working but is easy to misuse (copy path, relink, fileName); §4.1 lists each fix.
- **R3** crash between placing files and the DB commit ⇒ `.partial` sweep; Windows rename can fail on antivirus locks ⇒ bounded retry.
- **R4** Disk: tmp + final briefly (same-volume rename avoids a second copy); long imports ⇒ progress and cancel are required.
- **R10** `json_patch` omission keeps stale keys (verified, §5.6): any future writer that sets a multi-book field by *omission* reintroduces a stale `percent`/`durationSeconds`; mitigated by the null-deleting patch, the regression suite and the Main write guard.
- **R5** Without durations (D3) there is no total/percent; accepted: in this release a multi book shows no percent in the Library and Book scope is unavailable. Stage C can fill it in.
- **R6** Existing managed single-file "Remove from library" orphan behaviour is left as is (documented, out of scope).
- **R7** Track switching is the riskiest player change (stale events, save mixing old `trackId` with new time): mitigated by the `trackSwitch` token, `status: 'loading'` during a switch and dedicated store-spike cases.
- **R8** Multi books in this release have **no Notes** (hidden in the UI *and* refused in Main) and no percent — a visible capability gap versus single-file audiobooks until Stage C; the release notes must say so. Accepted (D10, review). `audioBookmarks` JSON of single-file books is untouched.
- **R9** A track-relative `positionSeconds` next to a missing/unknown `trackId` is meaningless: the writer refuses it (Main guard), the reader discards it (player) — two independent barriers (§5.6). Downgrading to an older build plays chapter 0 only.
- **R11** One-track ZIP ignores the cover chosen in the preview (accepted limitation, D8): the preview warns before confirmation; the existing single-file importer is intentionally not extended.
- Limitations: embedded chapters ignored in ZIP books (D4); Continue Reading does not list audiobooks (pre-existing); one-track ZIPs use the single-file title/cover rules (§3.2); no transcoding; no nested ZIPs.
- Assumptions: same-volume rename; `foreign_keys = ON` at runtime; ZIP limits from the preview phase unchanged.

## 10. Decisions and readiness

1. One selected track → existing single-file import path; the preview cover is **not** applied, the limitation is accepted and shown in the preview before confirmation; no importer change (D8, §3.2). **Resolved.**
2. Multi-book deletion → one destructive "Remove audiobook…" (D9, §4). **Resolved.**
3. Minimum restore (`trackId` + position in track) in A+B; Stage C items listed and enforced as limitations (D10, §5.6). **Resolved.**
4. Release gate → existing `features` constants, one new field (D11, §6). **Resolved.**
5. Q-a (one-track cover) → accepted. Q-b (no Notes / no Library percent for multi books in the first release) → accepted and enforced in UI + Main. Q-c (`removeBook`/`deleteBookFile` refuse multi books) → accepted. **Resolved.**

**Corrections made in this revision:** the Revision-3 plan to *omit* `percent`/`durationSeconds` was wrong under merge-patch semantics (stale values survive); the patch now deletes them with explicit `null`s (§5.6). A data-layer guard was added so a track-relative position is stored only together with a valid `trackId` of that book.

**Remaining blockers: none.** Verification still to be done *during* implementation (not blockers): re-run the merge-patch regression against the real better-sqlite3 build (migration spike); confirm Windows rename/antivirus retry behaviour (R3); manual release checklist (§8).
**The plan is ready for implementation**, starting with A1.

## 11. Recommended sequence (explicit boundaries)

1. Approve this revision. 2. **A1** migration 028 + store (`persistImportedAudiobook`, `listAudioChapters`) + SDK layout/hash/progress fields + vitest + migration spike. 3. **A2** importer + N=1 hand-off + IPC (cancel/progress/duplicate) + delete semantics (`removeAudiobook`, guards) + Library DTO/menu changes + import spike;
the entry point is still flag-hidden. 4. **B1** protocol/URL + `getTracks` + `trackId` save/restore plumbing (SDK/DTO/store) + main spike. 5. **B2** player store/UI (switching, prev/next, auto-advance, restore) + store spike. 6. **Gate**: full §8 verification incl. single-file regression and the manual multi-track check, then flip
`audiobookZipImportEnabled` in the final commit. 7. **Stage C** later: Notes for multi books, percent/remaining time, Book scope, Continue Reading.

