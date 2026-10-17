# PDF embedded annotations — live sync from external apps (phase 1)

Date: 2026-10-17. Builds on `pdf_embedded_annotation_import.md` (import on open, ledger, migration 023).

Goal: Foxit / Acrobat changes the annotations of the PDF that is open in Readmate. Within a few
seconds of that app finishing its save, Readmate updates SQLite and the reader, without closing or
reopening the book. The change can be an add, an edit, a move, a resize or a delete.

This is still one-way and read-only. The book file is never written ("the book file is never
mutated" is unchanged). There is no PDF writer, no write-back and no EPUB change.

## 1. Audit of the starting point (verified in code)

- **Scan:** `PdfRenderer` scanned once per loaded document, in the renderer, through the
  `pdfEmbeddedAnnotations.ts` `useEffect` on `doc`. The renderer sent the items over
  `overlay:syncPdfEmbeddedAnnotations`. Nothing ran after open.
- **Identity:** the key was `pdf1:<subtype>:<page>:<geometry hash>#n`. PDF.js 5.4.624
  `getAnnotations()` exposes no `/NM` (checked in `pdf.worker.mjs`: `Annotation` never stores it).
  A move or resize was therefore a new key: a new row, while the old row stayed.
- **Deletions:** never applied (`planEmbeddedAnnotationSync` never deleted).
- **File access:** Main reads book bytes only through `resolveBookFile`, which validates the path,
  the extension, symlinks and regular-file status. The renderer never sees a path.
- **Workers:** Main already runs PDF.js (legacy build) in worker threads
  (`chunking/book-chunk.worker.ts`, a separate entry in `vite.config.ts`).

## 2. Design

### Where things run

| Concern | Place | Why |
|---|---|---|
| Watching the open book's file | **Main** | Only Main knows the path; it reuses `resolveBookFile` |
| Reading the bytes and hashing them | Main | Same |
| Scanning: PDF.js annotations plus `/NM` | **Main worker thread** (`pdf-annotation-scan.worker.ts`) | `/NM` needs the raw PDF objects, which PDF.js doesn't expose. The parse stays off the Main event loop, and the PDF never crosses IPC. |
| Sync against the ledger | Main, one SQLite transaction | unchanged store code, extended |
| Updating the reader | Renderer, from a push event | no reload of the document |

The open-time scan moves from the renderer to the same Main path, so open and change use **one
identity source** (with `/NM`). The PDF is now parsed twice: once by the renderer to display it, and
once by the worker for annotations. That is the price of `/NM` without sending bytes over IPC. The
renderer scan module and the `overlay:syncPdfEmbeddedAnnotations` channel are removed.

### Watcher (`electron/pdf-sync/stable-file-watcher.ts`)

There is exactly one watched file per renderer (`webContents`): the PDF open in its reader.

- **Watch:** `fs.watch` on the file's **directory**, filtered to the file name (case-insensitive on
  Windows). This catches in-place writes and also a save that writes a temp file and renames it
  over the book (new inode). A watch on the file itself loses track after such a replace.
- **Safety net:** a `stat` poll every 2 s, because `fs.watch` events are not reliable on every OS
  (Node docs).
- **Debounce:** every event or poll hit (re)starts a 250 ms debounce. Then a **stability check**:
  `stat` → wait 400 ms → `stat` again, and size, mtime and inode must be equal. Otherwise the check
  is retried (up to 30 s). ENOENT means the save is in progress, so the watcher waits and never
  reports a deletion.
- **Signature dedupe:** a stable signature equal to the last one delivered is dropped. That covers
  duplicate events, events for neighbors in the same folder, and reads by the app itself.
- **Dispose:** closes the directory watch, clears the timers and ignores late callbacks.

### Sync service (`electron/pdf-sync/pdf-annotation-sync-service.ts`)

- **Channels:**
  - `overlay:watchPdfEmbeddedAnnotations(bookId)` disposes the previous watch of that window,
    starts one for this book, and immediately runs the **open** sync.
  - `overlay:unwatchPdfEmbeddedAnnotations(bookId)` stops it. `webContents` `destroyed` and app
    quit dispose watches too.
- **Serialization:** one sync at a time per watch. A change during a sync sets `dirty`, and exactly
  one more sync follows.
- **Steps of a sync:**
  1. `resolveBookFile` (path guard).
  2. `stat`, read the bytes, `stat` again. A different signature means the file was written during
     the read, so retry later.
  3. Same SHA-256 as the last successful sync → done. Content-identical saves and touches are no-ops.
  4. The file must end with `%%EOF` (in its last 2 KiB). Otherwise it is written partially or
     truncated: retry later and **never** scan it.
  5. Worker scan (§3), then the store sync (§4), in one transaction.
  6. Remember the SHA-256 **only after commit**. A failed transaction or scan keeps the old SHA, so
     the next change, or a retry, runs again.
  7. Push `overlay:pdfEmbeddedAnnotationsChanged`
     `{ bookId, reason, inserted, updated, deletedIds, hiddenObjectIds?, timing }`.
- **Canvas hiding:** `hiddenObjectIds` is sent **only** for the open sync, and only when the bytes
  scanned equal the bytes `library:openBookContent` served for this book. Their SHA-256 is recorded
  there. After a later change the renderer still displays the old document, whose object numbers may
  mean other annotations, so nothing is hidden by number then. Old appearances were hidden at open;
  new annotations are not in the old document at all.

### Identity (SDK `embeddedAnnotationIdentities`)

- **With `/NM`:** the key is `nm1:<pageIndex>:<hash(NM)>#n`. `/NM` is unique per page (PDF 32000
  §12.5.2); `#n` covers copied annotations that share one. Subtype and geometry are not in the key,
  so a **move, resize, recolor, comment edit or type change** in another app updates the same row.
- **Without `/NM`:** the key is `pdf1:…` as before (anchor = subtype, page, rounded geometry). A
  move or resize is then a delete plus an insert, which is now applied as such (§4).
- **Upgrade of existing ledger rows:** an item that now has an `nm1` key but matches an old `pdf1`
  ledger row is **re-keyed** to `nm1` in the same transaction. Its row and its history stay.

### Reading `/NM` (`electron/pdf-sync/pdf-raw-objects.ts`)

PDF.js gives each annotation's object reference (`12R`). The reader locates that object in the
bytes:

- It takes the **last** `12 0 obj … endobj`, since an incremental save appends newer versions.
- If there is none, it looks in FlateDecode **object streams** (`/Type /ObjStm`).
- It reads `/NM` as a literal or hex string, including the UTF-16BE BOM.

Anything it can't resolve, such as other filters or encryption, means "no `/NM`", and the geometry
key is used.

## 3. Scan result

The worker returns `{ items, complete }`. `complete` is true only when the document loaded, every
page's annotations were read without error, and the 5000-item cap was not hit.

## 4. Sync rules (`planEmbeddedAnnotationSync`, extended)

| Situation | Action |
|---|---|
| New key | insert row and ledger entry |
| Known key, file version unchanged | nothing |
| Known key, file changed, row untouched in the app | update the row (geometry included, so a move or resize applies) |
| Known key, file changed, row edited in the app | nothing (the app wins, unchanged rule) |
| Known key, row deleted in the app | nothing (the tombstone stays) |
| **Ledger entry not in a `complete` scan**, row untouched in the app | **delete** the row and its ledger entry |
| Ledger entry not in a `complete` scan, row edited in the app | keep the row and the ledger entry (no data loss) |
| Ledger entry not in a `complete` scan, row already deleted in the app | drop the tombstone |
| Scan **not** complete | inserts and updates only, **no deletions** |

A deletion that removes everything is allowed. The user may really have deleted all annotations in
Foxit. It only runs after the guards: stable signature, unchanged during read, `%%EOF`, document
loaded, every page read.

## 5. Renderer

- `PdfRenderer` loses the scan and gains `hiddenEmbeddedAnnotationIds`, which it applies
  declaratively. Each id is set `noView` in `annotationStorage` once per document; rendered pages
  re-render.
- `useReaderPdfHighlights` subscribes to `overlay:pdfEmbeddedAnnotationsChanged` and calls watch for
  the open PDF. Cleanup, on book change or unmount, unsubscribes and unwatches.
- `pdfHighlightsStore.applyEmbeddedSync` merges inserted and updated rows by id and removes deleted
  ones, closing their menu and focus.

## 6. Implementation notes (as built)

- **Scan worker lifecycle (found in E2E):** the first version spawned one pdf.js worker per scan,
  and terminated it, or let it exit. That crashed the **Electron Main process with 0xC0000005
  (access violation)** in about 3 of 4 runs, at the first scan after open. The diagnosis was done
  with env switches, since removed:
  - With `fs.watch` disabled, it still crashed.
  - With no `transferList`, it still crashed.
  - With no `terminate()`, it still crashed.
  - With the scan run in-process, it passed 4/4.

  The fix is **one long-lived scan worker** (`scanInWorker` / `ensureScanWorker` in
  `overlay.ipc.ts`). Requests carry ids and the bytes are transferred. The worker is `unref()`'d,
  restarted only after a hang (60 s timeout) or a crash, and stopped at app quit. The result was 8/8
  green runs afterwards. The plain-Node spikes never showed the crash, so it is specific to Electron.
- **Retry:** a failed scan or transaction is retried up to 3 times, 1.5 s apart, without needing a
  new file event. The SHA-256 only advances after a commit.
- **Old channel removed:** `overlay:syncPdfEmbeddedAnnotations`, and the renderer scan module
  `pdfEmbeddedAnnotations.ts`, are gone. The renderer no longer sends annotation data to Main.

## 7. Files (phase 1)

SDK:
- `app-models/pdf-embedded-annotations.ts`: `nm`, `embeddedAnnotationIdentities`, re-key,
  deletions (`complete`), tombstone cleanup.
- `app-models/index.ts`.
- `tests/app-models/pdf-embedded-annotations.test.ts`: 11 new tests, 39 in total.

Desktop:
- `electron/pdf-sync/`, all new:
  - `stable-file-watcher.ts`
  - `pdf-annotation-sync-service.ts`
  - `pdf-annotation-scan.ts`
  - `pdf-annotation-scan.worker.ts`
  - `pdf-raw-objects.ts`
- `electron/ipc/overlay.ipc.ts`: watch / unwatch handlers, the scan worker, the service wiring.
- `electron/ipc/channels.ts`, `api-types.ts`, `preload.ts`, `src/bridge/overlay.ts`.
- `electron/files/open-book-content.ts`: SHA-256 of the served bytes.
- `electron/persistence/sqlite-overlay-store.ts`: `options.complete`, re-keys, deletions.
- `electron/chunking/pdf-text.ts`: `loadPdfjs` exported.
- `electron/main.ts`: dispose on quit.
- `vite.config.ts`: worker entry.
- `src/reader/renderers/pdf/PdfRenderer.tsx`: `hiddenEmbeddedAnnotationIds`; the scan is removed
  and `pdfEmbeddedAnnotations.ts` is deleted.
- `src/screens/Reader/logic/pdfHighlights/pdfHighlightsStore.ts`, `logic/hooks/useReaderPdfHighlights.ts`,
  `ReaderScreen.tsx`.
- `e2e/support/build-annotated-pdf.mjs`: `objectStreams`, `appendIncrementalUpdate`.
- `e2e/specs/pdf-embedded-live.spec.ts`: new.
- `spikes/pdf-annotations/run-pdf-embedded-live.mjs`: new.
- `spikes/pdf-annotations/run-pdf-embedded-annotations.mjs`: uses Main's scan.
- `spikes/pdf-annotations/register-alias.mjs`: `.js` → `.ts`.
- `package.json`: `spike:pdf:live`.

There is no migration in phase 1. The ledger from 023 is enough: `/NM` keys and the old anchor keys
share `source_key`.

## 8. Test results (2026-10-17, Windows 11, automated)

| Check | Result |
|---|---|
| SDK `npm run verify` | ✅ 10 files, 135 tests |
| Desktop typecheck, lint, e2e:typecheck | ✅ |
| `spike:pdf:live` (watcher, `/NM` reader, live service on real temp files and SQLite) | ✅ 18/18, 9 consecutive green runs. One earlier run failed on a too-tight wait in the retry check, which now waits on SQLite state. |
| `spike:pdf:embedded`, `spike:pdf:annotations`, `spike:signature:status`, `spike:reader:toolbar`, `spike:pdf:search`, `spike:settings:reset`, `spike:settings:reminders`, `spike:session:roundtrip`, `spike:overlay:cfi` | ✅ |
| E2E `pdf-embedded-live.spec.ts` | ✅ 8/8 consecutive runs after the worker fix |
| Full E2E suite (`vite build` + `playwright test`) | ✅ 24/25. The 25th, `pdf-embedded-annotations.spec.ts`, asserted the old rule ("removed from the file, kept in the app"); with the new rule it is now expected to be deleted. The expectation was updated and the spec passes 2/2 |

**Measured latency** is the time from the file being written to the reader's DOM showing the
change, with the app's real timings (250 ms debounce, 400 ms stability). It was measured over 8 E2E
runs:

| Step | Latency |
|---|---|
| add (full rewrite) | 0.73–1.43 s |
| recolor (incremental) | 0.73–0.80 s |
| move + resize | 0.73–1.35 s |
| delete (rename save) | 0.73–0.77 s |

In the spike harness, with 60 / 120 ms timings, it is 0.25–0.47 s.

### Answer: does Readmate update without reopening?

| Change in another app | Automated (simulated saves) | Real Foxit / Acrobat |
|---|---|---|
| Add | ✅ spike + E2E | not tested |
| Recolor / comment edit | ✅ spike + E2E (incremental save) | not tested |
| Move / resize, annotation **with `/NM`** | ✅ same row (spike + E2E) | not tested |
| Move / resize, **without `/NM`** | ✅ delete + insert (spike) | not tested |
| Delete one / delete all | ✅ spike + E2E (rename save) | not tested |
| Save in bursts / truncated first / half-written | ✅ never scanned, never deletes (spike) | not tested |
| Replace via temp + rename (new inode) | ✅ watcher + E2E | not tested |
| Book closed / switched / window closed | ✅ watch ends (spike) | not tested |
| Failed transaction | ✅ rolled back, retried, no duplicates (spike) | n/a |

Real Foxit and Acrobat were **not** driven in this environment; the saves are simulated with
generated PDFs (plain, incremental, object streams, renumbered). Whether a given viewer writes
`/NM`, how it saves (incremental vs rewrite, in place vs rename), and how fast, must be confirmed by
hand. See `pdf_annotation_reader_compatibility.md` (phase 4).

## 9. Limitations

- Without `/NM`, a move or resize becomes delete + insert. An app edit on the old row is kept, and
  the row is then orphaned from the file.
- A name that is readable in one save and unreadable in the next changes the key, for example when a
  viewer switches to an object stream with a predictor, which this reader can't inflate. The result
  is delete + insert of untouched rows. Rows the user edited are never lost.
- The open document in the reader is not reloaded. Annotation types the app doesn't import (Ink,
  FreeText…) only change on screen after a reopen. Imported ones are painted by the app, so they
  update live.
- `fs.watch` plus a 2 s poll: on network drives without change notifications, the latency is bounded
  by the poll.
- Encrypted PDFs: `/NM` is not read (ciphertext), so the geometry key is used.
