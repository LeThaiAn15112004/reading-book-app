# Research: Faster import that runs in the background (016)

Read from the code on 2026-11-21 (branch `016-faster-background-import`, base `7f99757`). Every "today" below names
the file it was read in.

## What the code does today

| Step | Desktop (Main unless said) | Phone (host + WebView bridge) |
|---|---|---|
| Pick | `import:fromFile` → `dialog.showOpenDialog({ properties: ['openFile'] })`, one file (`ipc/import.ipc.ts`) | `files.pick` → `DocumentPicker.getDocumentAsync({ multiple: false })` (`host/expo-host-fs.ts`) |
| Copy | none (referenced in place); URL / cloud: temp → `copyIntoBooksSandbox` | `files.stage`: JS loop `readBytesSync` → `writeBytes`, 1 full pass through JS (`host/file-service.ts`) |
| Fingerprint | `rejectIfDuplicate` → `hashFile` (pass 1), then the importer's `buildImportResult` → `hashFile` again (pass 2) (`adapters/filename-fallback-importer.ts`) | `files.hashStaged`: JS `Sha256` over the staged copy, 2nd full pass through JS |
| Details | EPUB: `fsp.readFile` whole + `JSZip.loadAsync` (pass 3) (`adapters/epub.adapter.ts`); PDF / TXT / MD: filename only | EPUB: `ctx.content.read(bookId)` = whole file into the WebView + `JSZip` (`bridge/import.ts`) |
| Signature | `verifyOnImport` → `resolveSignatureInfo` → `readFile` whole for PDF (pass 3 / 4), BEFORE the row is written (`signature/book-signature.ts`) | none |
| Save | `persistImportedBook` (one transaction) | `commitStaged` (move) + `persistImported` in the write queue |
| Cover | renderer `generateBookCover`: `openBookContent` = whole file over IPC (Main reads + hashes + copies it), pdf.js page 1 / JSZip again for EPUB; then `refreshLibrary()` reloads the whole list per cover (`screens/Library/logic/generateBookCover.ts`, `useLibraryScreen.ts`) | same renderer code; `openBookContent` = whole file from the local server |
| UI | `ImportProgressDialog` blocks the Library; `libraryImportStore.busy` refuses a second import | same; the bridge refuses a second import (`running`) |
| Open | `openBookContent`: `readFile` + SHA-256 + copy to an `ArrayBuffer`; `useBookIndexing` starts chunking at `contentStatus === 'ready'` (bytes handed over, first page NOT yet drawn) | same through the local server |

So a large PDF picked from disk is read **4 times** before it appears (hash, hash, signature) plus once more whole for
the cover; a large EPUB 3 times plus twice for the cover. On the phone every byte crosses the JS bridge twice
(copy, hash) and an EPUB a third time into the WebView.

## Decisions

### R1 — Timing (FR-001, FR-002, US1)

- **Decision**: one pure core module `source/core/src/perf/step-timing.ts` (`createStepTimer`, `StepTiming`
  `{ flow: 'import' | 'open', step, format, sizeBytes, ms, host }`, `formatTimingLine`). Turned on by
  `READMATE_TIMING=1` on Desktop (Main reads `process.env`; the renderer asks Main once through
  `app:getTimingEnabled`) and by `localStorage['readmate.devTiming'] = '1'` on the phone (development builds only).
  Desktop appends JSON lines to `{userData}/logs/timing.jsonl` (Main writes renderer lines it receives on
  `app:recordTiming`); the phone logs them with `console.info('[timing]', …)` (logcat) and keeps the last 500 in
  `window.__readmateTiming`.
- **Rationale**: no title / file name / path can enter the record — the type has no field for them (FR-001, US1
  AS4). Off = the timer is a no-op object, nothing is allocated or written (US1 AS3).
- **Alternatives**: Electron `contentTracing` (too heavy, records paths); a Settings switch (spec: developers only).

### R2 — Fingerprint once, Desktop (FR-003, FR-007)

- **Decision**: `importFromFile` hashes once (`hashFile` gets an optional `AbortSignal` and an `onProgress` for the
  percentage) and passes `{ sha256, fileSizeBytes }` to the importer: `DocumentImporter.import(filePath, { known })`
  (optional second argument — the core port gains an optional parameter, every caller still compiles);
  `buildImportResult` uses `known` instead of hashing. The duplicate check and the row use that one value. Before
  "Saving", `stat` is compared with the one taken before hashing (size + mtimeMs); a difference → `file_changed`
  ("The file changed or is no longer there"), nothing added (spec edge case).
- **Rationale**: removes pass 2 with no change to the row (same hash function, same bytes).
- **Alternatives**: hash inside the importer and dedup afterwards (would extract metadata / write a cover before
  knowing it is a duplicate).

### R3 — Signature check after saving (FR-005)

- **Decision**: `verifyOnImport` is no longer called before `persistImportedBook`. After the row is written Main
  calls `scheduleSignatureCheck(bookId)` (`signature/signature-queue.ts`, new): one check at a time, waits while a
  book is opening (R9), runs `checkBookSignature`, and writes only if the book still exists and its `sha256` is
  unchanged (`saveSignature` is skipped otherwise — "removed while checking" edge case). Failure / interruption writes
  nothing → "not checked yet". The queue is in memory: an unfinished check after a quit is simply redone the next
  time the signature is asked for (existing behaviour).
- **Rationale**: the book appears without the 3rd full read; the status values do not change.
- **Alternatives**: a persisted "to check" list (not needed: absent status already means "check on demand").

### R4 — EPUB unpacked once, ranged ZIP reader (FR-004, FR-004a)

- **Decision**: a pure core reader `source/core/src/zip/ranged-zip.ts`: `openRangedZip(source: RandomAccessSource,
  inflate: InflateRaw): Promise<ArchiveReader>` where `RandomAccessSource = { size: number; read(offset, length):
  Promise<Uint8Array> }`. It reads the End Of Central Directory (last ≤ 64 KiB + 22 B), the central directory, then
  only the entries asked for (local header + data), stored or deflate; ZIP64 EOCD supported; limits (entries ≤
  20 000, central directory ≤ 16 MiB, one entry ≤ 32 MiB) → `EPUB_MALFORMED`. It implements the existing
  `ArchiveReader` port, so the existing `readEpubImportMetadata` (core) runs on it unchanged.
  - Desktop: `RandomAccessSource` = `fs.promises.open` + `read`; `InflateRaw` = `zlib.inflateRawSync`. The EPUB
    adapter feeds its existing `parseContainerRootfile` / `parseOpf` / `extractCover` from this reader instead of
    `readFile` + `JSZip` — same parser, same output (FR-007; checked by `spike:import:parity`, R12).
  - Phone (WebView): source = HTTP `Range` requests to the local server (`206`, already supported, per-launch token);
    in Expo Go = `files.readChunk` (≤ 1 MiB / call, dev only); `InflateRaw` = `DecompressionStream('deflate-raw')`.
    The cover is read in the same pass (`includeCover: true`) and written with the existing `files.writeCover`.
- **Rationale**: the user's decision (clarification 2026-11-21): no step holds or ships the whole file; the
  existing `ArchiveReader` port means one reader for both hosts and no new dependency.
- **Alternatives**: keep `JSZip` (needs the whole buffer); `fflate` (new package, still whole-buffer for the simple
  API); `zip-import/zip-reader.ts` (Desktop-only, Node `fs`).

### R5 — Phone copy and fingerprint by path (FR-003, clarification 2026-11-21)

- **Decision**: `files.stage` uses `new File(pickedUri).copy(new File(staging))` (native, async — Expo SDK 58,
  installed `expo-file-system@58.0.13`, `NativeFileSystem.types.ts` `copy()`), then `files.hashStaged` uses
  `await stagedFile.digest('SHA-256')` (native, lowercase hex). No byte crosses the JS bridge. Percentage during the
  copy: the host polls the staging file's `size` every 250 ms and emits `copying` progress; `digest` has no progress
  → the step is shown without a percentage ("Checking for duplicates", indeterminate bar). Cancel during the native
  copy: flagged, honoured as soon as `copy()` resolves (staging removed, `CANCELLED`). Android `content://` sources
  are copied by the same call; if `copy()` refuses one (`InvalidPermissionException` — the Expo Go case noted in
  `expo-host-fs.ts`), the host falls back to today's chunked loop for that file only (counted in timing as
  `copy-fallback`).
- **Rationale**: SC-009 (−30 %): the two JS passes are the phone's main cost; native digest is the "one read of the
  copy by path in parts" the spec asks for.
- **Alternatives**: hash while copying in JS (still every byte through JS); `expo-crypto` (needs bytes in JS).
- **Risk**: `copy()` / `digest()` throughput not measured yet → story 1 measures both before story 2 is closed.

### R6 — Where the queue lives (FR-008–FR-011a, FR-018)

- **Decision**: the queue is **renderer state** shared by both hosts: pure state machine in core
  `source/core/src/app-models/import-queue.ts` (jobs, transitions, batch summary, placeholders, persistence
  snapshot), driven by one zustand store `source/app/hooks/library/importQueueStore.ts` with a runner that executes
  one job at a time through host operations (`importApi.runJob` etc., contracts). Main / the phone host only ever run
  ONE job when asked and report progress tagged with its `jobId`. The store lives at module level, so leaving the
  Library keeps it (like `zipImportStore`).
- **Rationale**: one implementation of queue, placeholders, summary and UI for Desktop and phone (FR-018); hosts stay
  thin; on Desktop a hidden window keeps its renderer, so Run in Background keeps the queue running (FR-013a).
- **Alternatives**: queue in Main (would need a second implementation for the phone and a new event stream for every
  state change).

### R7 — Multi-file pick without giving paths to the renderer (FR-011a)

- **Decision**: Desktop `import:pickFiles` opens the dialog with `['openFile', 'multiSelections']`; Main keeps the
  paths in `ipc/picked-files.ts` (`Map<pickId, path>`, entries expire after 30 min or when used) and returns
  `{ items: PickedItemDto[] (≤ 50), notAdded: number }` with `pickId`, display name, size, `kind: 'book' | 'zip' |
  'unsupported'`. Phone `files.pick` gets `multiple: true` and returns the same shape (pick ids map to the picked
  URIs in the host). A ZIP among several items → `kind: 'zip'`, the renderer leaves it out of the batch and shows
  "Pick an audiobook ZIP on its own to see its preview" (FR-014); a single ZIP keeps today's `audiobook_zip` route.
- **Rationale**: same rule as `picked-zip.ts` today (the renderer never learns a path).

### R8 — Placeholders and list updates (FR-006, FR-010)

- **Decision**: placeholders are derived (`placeholdersOf(queue)`) — never library rows. The Library hub renders
  them as the first items of the "All books" view (Grid and List; phone Grid / List too), not in Collections, filter
  chips other than All, or search results; they have no menu, are not focusable as books, and are announced as
  "Importing {name}". The book list moves from `useLibraryBooks`' local state to a zustand `libraryBooksStore`
  (project preference) with `upsertBook(dto)` / `patchBook(id, patch)` so a finished import inserts one book and a
  generated cover patches one entry — no whole-list reload (FR-006).
- **Alternatives**: a temporary row in SQLite (spec Assumption: no "half" book in the library).

### R9 — Nothing competes with the first page (FR-015, US4)

- **Decision**: a renderer `readerOpeningStore` (`opening: bookId | null`, set when the Reader starts loading,
  cleared when the renderer reports its first page drawn — EPUB `rendered` of the first section, PDF first page
  `render` resolved, TXT / MD first paint — or after 10 s). `useBookIndexing` waits for "first page drawn" instead of
  `contentStatus === 'ready'`; cover generation and the import runner wait between steps while `opening` is set (at
  most 10 s). Main is told through `app:setReaderOpening(bookId | null)` so the signature queue (R3) and the chunk
  service also wait; a missing "clear" is bounded by the same 10 s.
- **Rationale**: US4 / SC-005 — the read of a background import cannot be paused mid-file, so the gate is between
  steps and the import's own read is throttled by yielding (Desktop stream `highWaterMark` 1 MiB + `setImmediate`
  between chunks while `opening`).

### R10 — Cover without the whole book (FR-006)

- **Decision**: new `library:getCoverSource(bookId)` returns `{ kind: 'text', text }` (≤ 4 000 chars: TXT / MD read
  from the first 64 KiB, EPUB first spine document with text through the ranged reader of R4) or `{ kind: 'pdf',
  size }`. For a PDF the renderer runs pdf.js with a `PDFDataRangeTransport` whose ranges come from
  `library:readBookRange({ bookId, offset, length ≤ 1 MiB })` (path validated by `resolveBookFile`, renderer never
  gets a path), `disableAutoFetch: true`, `disableStream: true` → only the xref and page 1 objects are read. Phone:
  `getCoverSource` in the bridge (host reads ranges by path), PDF ranges by local-server `Range`. After
  `setGeneratedCover` (now returns `{ ok, coverUrl }`) the store patches that one book (R8).
- **Alternatives**: render covers in Main (no canvas in Main); a `rb-book://` Range protocol (new privileged scheme
  + CSP change for one use).

### R11 — Quit while importing (FR-013, FR-013a, FR-013b)

- **Decision (Desktop)**: the renderer reports the queue size on `import:reportActivity({ running, waiting })`;
  `background/quit-guard.ts` (new, pure `decideQuit({ pending, confirmed, shuttingDown })`) is consulted in
  `before-quit` and in the window `close` handler when closing means quitting (`shouldHideOnClose()` false). With
  pending imports: `event.preventDefault()`, a Main-owned `dialog.showMessageBox` ("{count} imports are still running
  or waiting. Quit and cancel them?" — Quit / Cancel, `tMain`), Quit → `import:cancelAll` event to the renderer,
  wait ≤ 3 s for the running job's cleanup, then `quitApp()`. OS shutdown (`query-session-end` / `session-end`)
  never asks. Startup: `sweepImportLeftovers()` before the IPC handlers removes `{userData}/books/{uuid}` folders
  without a row and `covers/*` files no row references (same rule as `removeManagedBookDir`, never outside the
  sandbox) and URL / cloud temp folders `reading-book-*` older than 1 h.
- **Decision (phone)**: `importQueueStore` persists its snapshot (R6, data-model) through the bridge
  `importQueue.save/load` → host JSON file `import-queue.json` in `Paths.document` (no bytes). On launch: the host's
  existing staging sweep runs first, then the store loads the snapshot: `running` → `interrupted`, each `waiting`
  file is checked (`files.checkPick` → `new File(uri).exists` / open-read) → still readable: stays waiting and runs;
  not readable → `interrupted` with "Try again" (opens the picker).

### R12 — Proving FR-007 / SC-002 / SC-006 without a Desktop test runner

- **Decision**: new spikes (standalone, like the others): `spike:import:parity` (import the sample set with the old
  and the new pipeline into two temp DBs, compare rows field by field incl. cover bytes hash), `spike:import:timing`
  (before / after table from `timing.jsonl`), `spike:import:cleanup` (20 cancels / failures / kill mid-import →
  0 rows, 0 sandbox copies, 0 covers, sources' SHA-256 unchanged — SC-006), `spike:import:queue` (the real
  `importQueueStore` with a scriptable `importApi`: order, cancel waiting / running, Saving not cancellable, batch
  summary, ZIP job, interrupted resume). Core vitest: `ranged-zip`, `import-queue`, `step-timing`. Mobile vitest:
  `file-service` stage / hash with a fake `HostFs` (copy + digest), bridge import with ranged EPUB.

### R13 — Measured targets (SC-002, SC-009, clarification 2026-11-21)

- Story 1 runs first and writes `specs/016-faster-background-import/timing-baseline.md` (sample files named by format
  and size only, machine / device named). The 40 % / 30 % targets may be lowered once, under SC-002 / SC-009, before
  story 2 starts.
