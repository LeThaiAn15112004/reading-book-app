# PDF annotations — two-way sync with external PDF readers (phase 3)

Date: 2026-10-17. Builds on phase 1 (`pdf_embedded_annotation_live_sync.md`: watcher, scan worker,
`/NM` identity, ledger) and phase 2 (`pdf_annotation_export.md`: incremental writer, read-back
verification).

Goal: annotations created, edited or deleted in an external PDF reader appear in Readmate (phase 1),
**and** annotations created, edited or deleted in Readmate are written into the same PDF file in
standard form, so readers that support the type can show them. The design is based on the PDF
standard (ISO 32000 annotation dictionaries, `/NM`, incremental updates), not on any one reader.

## 1. Prerequisites (verified)

| Prerequisite | Status |
|---|---|
| Watcher, re-scan, SQLite update and UI update | phase 1. `spike:pdf:live` 18/18; E2E live spec 8/8; latency 0.73–1.43 s |
| PDF writer that edits an existing file and keeps unrelated objects | phase 2: incremental updates, original bytes kept; `spike:pdf:export` 9/9 |
| Ledger schema, identity, hashes | 023 ledger; `/NM` keys with anchor fallback; source / content hashes |
| Test environment | Windows 11. **Foxit PDF Reader 2024.4.0.27683** and **Microsoft Edge 155** are installed; **no** Adobe Acrobat Reader, **no** SumatraPDF. No GUI automation tool is available in this session, so real readers can only be checked by hand (phase 4) |

## 2. Always on, gated by a write check (decided 2026-10-18; replaces the per-book opt-in)

Writing back means writing to the **user's own book file**, so the old invariant "the book file is
never mutated" changes. First version: opt-in per book (a menu switch, off by default). **Product
decision, 2026-10-18: write-back is always on.** There is no switch in Settings, none per book, and
nothing to enable first; existing PDF books follow the same behaviour as new ones.

What replaces the switch is a **write check run before every write** (`pdf-write-eligibility.ts`,
`checkPdfWritable`, asked through `twoWay.checkWritable`). A file that fails it is **never written and
never reported as written**; Readmate's changes stay pending in SQLite, the renderer is told why
(once per reason), and the next trigger tries again:

| Check | Result when it fails (`writeStatus`) | User sees |
|---|---|---|
| Referenced file (the user's own), not an app-owned copy under `{userData}/books` | `managed_copy` | nothing (by design: annotations of URL / cloud downloads stay in Readmate; Export still works) |
| File and folder writable (`W_OK`: read-only attribute, no permission) | `read_only`, no retries | toast: kept in Readmate, not written |
| Not encrypted, and the trailer can be appended to | `encrypted` / `unsupported_pdf` | toast: kept in Readmate, can't be written |
| Not digitally signed — or the signature **could not be evaluated** (prefer not writing) | `signed` | **confirmation dialog** (signer shown): writing makes readers report the signature as modified or invalid. Confirming allows writes into that file **for the rest of the session** (`overlay:confirmSignedPdfWrite`); declining keeps everything pending |
| File not held by another app (`EBUSY` / `EPERM` on the replace) | `locked`, **bounded retries** (10 × 3 s in the app) | toast: in use by another app, Readmate will retry |
| File unchanged since it was read for this plan (SHA-256) | the cycle restarts | nothing |
| Write verified by read-back before the file is replaced | `failed` if not | toast: kept in Readmate |

- **No backup file is made.** The write is an appended incremental update, so the earlier revisions
  of the file remain inside it, and the temp file is removed after the rename. No journal exists, so
  there is nothing to age out. The cost is file growth: every write appends the rewritten
  annotation objects, and nothing compacts the file.
- **`books.sha256` follows the file** (`updateFileFingerprint`, called after every successful
  cycle, for Readmate's writes and for external saves), so "Locate file" keeps matching after
  write-backs. It is skipped when another book already has that hash (unique index). Limit: if
  another app saves the file **while Readmate is closed** and the file is then moved, the hash no
  longer matches until the book is opened at its new place.
- **The table `pdf_annotation_write_back` (migration 024) is kept but no longer read or written.**
  Existing rows are ignored (an earlier "off" no longer disables anything), and nothing is deleted.
  A later migration may drop it.
- **Removed:** the More-menu item, its confirmation dialog, the `getPdfWriteBack` /
  `setPdfWriteBack` IPC and DTOs, the per-book store accessors.

## 3. Sync coordinator (extends phase 1's per-window session)

One session per reader window. **Everything that reads or writes the file goes through the
session's serialized queue.**

| Trigger | Source |
|---|---|
| `open` | `overlay:watchPdfEmbeddedAnnotations` |
| `file-change` | `StableFileWatcher` (settled change, phase 1) |
| `app-change` | Main's `overlay:saveHighlight` / `deleteHighlight` handlers call `notifyAppChange(bookId)`, debounced 300 ms (create, edit, kind, note, move, undo / redo and delete all save through these). One call; the logic lives in the coordinator. A tag-only change is not an annotation change (tags don't exist in PDF) and writes nothing |
| `retry` | after a failed or locked write (backoff 1.5 s × 3, then on the next trigger) |

One **reconcile cycle**, under the session's queue:
1. `resolveBookFile`, then stable read (stat, read, stat), `%%EOF`, SHA-256. This is phase 1's
   guard: a partial, truncated or replaced file is never scanned.
2. Scan in the worker: items, `/NM`, page geometry, `complete`.
3. Plan with `planTwoWaySync` (SDK, pure, §4), from the ledger with its base snapshots and the rows.
4. If the plan writes to the file:
   - Re-read the file. If its SHA-256 is no longer the one scanned, **abort and restart the cycle**:
     another app saved in between.
   - Write in the worker (phase 2 writer, read-back verified).
   - Then `writeFileSafely`: a temp file next to the book, `fsync`, rename over. A
     **locked / busy / permission** error does not lose anything: the file is untouched, the
     Readmate changes stay pending (the rows are still "changed since sync"), and a retry is
     scheduled. The renderer is told (`writeStatus: 'locked'`).
5. One SQLite transaction applies the plan: row inserts, updates and deletes, ledger keys, base
   snapshots and conflicts. For written annotations, the ledger keys and hashes come from the
   **read-back scan of what was written**.
6. `lastSyncedSha` becomes the SHA-256 of the file as it now is, so **Readmate's own write**,
   seen by the watcher, is a no-op (loop prevention).
7. Push `overlay:pdfEmbeddedAnnotationsChanged` with rows, deletions, conflicts and the write status.

**Crash safety:**
- Killed before the rename: the file is untouched and SQLite is unchanged.
- Killed after the rename but before the commit: the file holds `readmate:<noteId>` annotations that
  the ledger doesn't know. The next cycle **links** them to their existing rows by name instead of
  importing duplicates (§4).
- Killed during the transaction: rolled back, and the same situation as the line above.

## 4. Identity and reconciliation (`planTwoWaySync`, SDK)

**Identity:**
- `/NM` first. Readmate writes `/NM (readmate:<noteId>)` (`readmate:<id>:p<n>` for later pages of
  a multi-page row), and a rewritten foreign annotation keeps its own `/NM`.
- Without `/NM`, phase 1's anchor key. After Readmate rewrites such an annotation it carries a
  Readmate `/NM`, and the ledger is re-keyed.
- An item named `readmate:<id>` that the ledger doesn't know, whose row exists in this book, is
  **linked**, not imported. This covers crash recovery and an older write.

**Base snapshots (three-way merge).** Each ledger row now keeps `base_json`, the state of both sides
at the last successful sync:
- `file`: subtype, color, contents, rects, as scanned;
- `app`: style, color, note, rects, as in the row.

For each linked pair, every **field** (kind, color, text, geometry) is classified against its own
side's base:

| File side vs base | App side vs base | Action |
|---|---|---|
| same | same | nothing |
| changed | same | **file → row** (row updated) |
| same | changed | **row → file** (annotation rewritten in place) |
| changed | changed, **different fields** | **merged**: each side's change applied to the other |
| changed | changed, **same field, same value** | nothing to do (converged) |
| changed | changed, **same field, different values** | **conflict**: neither side overwritten. The row keeps Readmate's version, the file keeps the other app's, and the file's version is saved in `conflict_json`. The user resolves it |

**Deletions:**

| Situation | Action |
|---|---|
| Removed from the file (complete scan), row unchanged since sync | row deleted |
| Removed from the file, row **changed** in Readmate | **conflict** `removed-in-file`: row kept |
| Deleted in Readmate, file annotation unchanged since sync | annotation **removed from the file** (with its `/Popup`), ledger entry dropped |
| Deleted in Readmate, file annotation **changed** since sync | the other app's change is not dropped silently: the row is **restored** from the file and the user is told |
| Gone on both sides | ledger entry dropped |

**New on one side:**
- A new file annotation is imported (phase 1).
- A row made in Readmate is **added to the file**, and its ledger entry is created from the read-back.

**Text notes:** the file's geometry (the sticky icon) is never copied into the row's text anchor,
and the row's anchor isn't copied into the icon. Only kind, color and text sync for notes.

**Unsupported types** (Ink, FreeText, Stamp, shapes, Link, widgets, Squiggly's wave): never
converted and never touched. The writer keeps their objects.

**Timestamps** are never used to decide which side is newer. Only the bases decide.

## 5. Conflicts

- Stored per ledger row: `conflict_json`, the file's version. While it is set, that pair is
  frozen: no writes in either direction.
- Shown in the reader: a toast when it is detected, and a banner in the annotation's popup with
  **"Keep Readmate's version"** (rewrite the file annotation from the row) or
  **"Use the PDF's version"** (update the row from `conflict_json`).
- `overlay:resolvePdfAnnotationConflict` resolves it, and the next cycle applies it.
- `removed-in-file` conflicts:
  - "Keep Readmate's version" re-adds the annotation to the file;
  - "Use the PDF's version" deletes the row.

## 6. Limits made explicit

- Format compatibility (standard annotations), change detection (the watcher), read/write, **another
  reader refreshing its own view** and **avoiding concurrent writes** are separate things.
  - Readmate controls the first three.
  - A reader that keeps the old file in memory does not show Readmate's write until it reloads the
    file.
  - A reader that saves its in-memory copy later can overwrite Readmate's annotation in the file.
    Readmate then sees an external change. If that change removed Readmate's annotation and the row
    was untouched since, the row is deleted. That is the documented price of a reader that doesn't
    reload.
- Rename-over replaces the file (new inode). A reader holding the old handle keeps showing the old
  version. A reader that locks the file blocks the write, which is retried and reported.
- Signatures: never claimed to survive (§2).

## 7. Files (phase 3)

SDK:
- `app-models/pdf-annotation-two-way.ts` (new): `planTwoWaySync`, the base snapshots,
  `applyFileFields`.
- `app-models/index.ts`.
- `tests/app-models/pdf-annotation-two-way.test.ts` (new, 15 tests, with a coordinator model).

Desktop:
- `electron/persistence/migrations/024_pdf_annotation_two_way_sync.sql` (new), `migrate.ts`.
- `electron/persistence/sqlite-overlay-store.ts`:
  - `listTwoWayLedger`;
  - `get/setPdfWriteBack`;
  - `applyTwoWaySync`, one transaction that skips rows edited mid-cycle;
  - `listPdfAnnotationConflicts`, `resolvePdfAnnotationConflict`.
- `electron/pdf-sync/pdf-annotation-sync-service.ts`: two-way cycle, `notifyAppChange`, version
  check before the write, locked-file retries, loop prevention.
- `electron/pdf-sync/pdf-annotation-write.ts`: `applyAnnotationOps`.
- `electron/pdf-sync/pdf-incremental-writer.ts`: `assertPdfWritable`.
- `electron/pdf-sync/pdf-annotation-scan.worker.ts`: the `apply` request.
- `electron/ipc/overlay.ipc.ts`:
  - two-way deps;
  - write-back, conflict list and resolve handlers;
  - `notifyAppChange` from save / delete;
  - worker requests now get their own copy of the bytes. Transferring the caller's buffer detached
    it, so the write that follows the scan failed with a `DataCloneError`, found by E2E.
- `electron/ipc/channels.ts`, `api-types.ts`, `preload.ts`, `src/bridge/overlay.ts`.
- Renderer:
  - `logic/pdfExport/pdfWriteBackStore.ts` (new);
  - `pdfHighlightsStore.ts` (conflicts, toasts, resolve);
  - `useReaderPdfHighlights.ts`;
  - `components/dialogs/PdfWriteBackDialog.tsx` (new);
  - `components/highlights/SyncConflictBanner.tsx` (new), `HighlightEditPopup.tsx`,
    `NoteTextboxPopup.tsx` (conflict slot);
  - `chrome/MoreMenu.tsx`, `ReaderTopbar.tsx`, `ReaderScreen.tsx`.
- `e2e/specs/pdf-two-way-sync.spec.ts` (new).
- `spikes/pdf-annotations/run-pdf-two-way.mjs` (new).
- `spikes/pdf-annotations/electron-stub.mjs` (`BrowserWindow`, `dialog`).
- `e2e/support/build-annotated-pdf.mjs` (`quadPoints`).
- `package.json` (`spike:pdf:two-way`).

## 8. Test results (2026-10-17, Windows 11, automated)

| Check | Result |
|---|---|
| SDK unit tests (`pdf-annotation-two-way.test.ts`) | ✅ 15 |
| `spike:pdf:two-way` | ✅ 15/15 in 17 runs after the race fix. **1 failure in a long batch run of all spikes**: its output was not kept, so it is unknown which check failed. It was not reproduced in 17 runs, including 3 in parallel and the same batch order twice. Treated as an open timing risk: the spike waits at most 8 s per step |
| Full E2E suite (`vite build` + `playwright test`, all 29 specs) | ✅ 28 passed, 1 skipped (the optional kit capture, which needs `READMATE_COMPAT_KIT`) |
| E2E `pdf-two-way-sync.spec.ts` (built Electron app, PDF open) | ✅ 4/4 |

The SDK tests cover:
- Readmate → file: add once, edit in place, delete; a foreign annotation without `/NM` gets one;
- file → Readmate: an update; deletion only on complete scans;
- a merge of different fields;
- a same-field conflict, frozen and auto-cleared when both sides agree;
- the same value on both sides;
- `removed-in-file` and restore-after-delete;
- crash-recovery linking;
- named moves and repeated cycles;
- legacy (no-base) rows;
- multi-page rows.

The spike covers:
1. Add, edit in place and delete written to the file, with no loop and no duplicates.
2. A recolor, comment edit or delete in the other app updates Readmate.
3. A merge.
4. A conflict resolved both ways.
5. Restore and `removed-in-file`.
6. A locked (read-only) file: pending, retried, then written.
7. Another app saves during the write: restart, nothing lost.
8. A crash after the write: linked on retry, no duplicates. A row deleted mid-write is not
   resurrected; this check reproduces the race found in the full spike runs, and **fails** without
   the fix.
9. Write-back off: the file is never touched.
10. Global uniqueness.

The E2E spec covers: enabling via the More menu and confirmation, then add, recolor and delete
written to the file (checked with pdf.js in the test process), and an external recolor + comment
shown in the reader without being written back.

**Bugs found and fixed by these runs:**
1. A **`DataCloneError`**: the scan transferred the bytes the write then needed.
2. A **resurrection race**: a row deleted while its own write was in flight came back as an import.
   The fix is to write the ledger entry as a tombstone.

**Measured latency** (E2E, real timings, 4 runs):

| Change | Latency |
|---|---|
| Readmate recolor → file written | 0.48–0.60 s |
| Readmate delete → file | 0.46–0.56 s |
| Readmate add → file | 2.1–2.7 s, measured from before the UI selection steps (≈1 s of UI) |
| External save → reader updated | 0.76–0.82 s |

These numbers mean the data reached the file or the database. They are **not** how fast another
reader refreshes its own view (§6).

## 9. Always-on update: results (2026-10-18, Windows 11, automated)

The behaviour is described in §2. Files added or changed on top of §7:
- new: `electron/pdf-sync/pdf-write-eligibility.ts`, `src/screens/Reader/logic/pdfExport/pdfSignedWriteStore.ts`,
  `e2e/support/readmate-annotations.mjs`;
- removed: `PdfWriteBackDialog.tsx`, `pdfWriteBackStore.ts`, the get / set write-back IPC;
- changed: `pdf-annotation-sync-service.ts`, `overlay.ipc.ts`, `sqlite-overlay-store.ts`,
  `sqlite-library-store.ts` (`updateFileFingerprint`), the renderer stores, the More menu, the
  specs and spikes listed in the audit doc §11.

| Check | Result |
|---|---|
| SDK `verify` | ✅ 164 tests |
| Typecheck, lint, E2E typecheck | ✅ |
| `spike:pdf:two-way` | ✅ 21/21; **25 consecutive green runs** after the fixes below, plus every other spike (annotations, embedded, live, export, signature, toolbar, search, session, cfi, reset, reminders, background, notifications) |
| Full E2E (`vite build` + `playwright test`) | ✅ 29 passed, 1 skipped (the optional compatibility-kit capture) |

Not run: `npm run build` as a whole (it ends in `electron-builder` packaging); `npx vite build`, the
bundle check named in `CLAUDE.md`, was run before each E2E pass.

Found while looping the spike, and fixed:
1. **Retry budget was cumulative per session.** After one lock used it up, a later transient lock
   (on Windows, a rename over a file another process is reading gives `EPERM`) got no retry until a
   write succeeded. Now every fresh trigger (open, file change, an edit in Readmate) gets its own
   bounded budget; retries and internal restarts don't reset it.
2. Test-side races (not product bugs): checking the *written* status before the event was pushed;
   a delete through the spike's IPC not notifying the spike's coordinator the way the real handler
   does; counting `locked` events across checks.

Not verified: any real external reader (Foxit, Acrobat, SumatraPDF, PDF-XChange), a real signed PDF
through the whole flow (the signed path is tested with a faked verdict), file growth over many
edits, network or synced folders, and a reader that saves a stale in-memory copy.
