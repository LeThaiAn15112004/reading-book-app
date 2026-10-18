# PDF annotation interoperability: audit

Date: 2026-10-18. Audited commit: `6bc57b5` on `anle-dev`, with a clean working tree (`git status`
empty).

Scope: read-only audit. No implementation code, migration, package or commit came with it.
Sources: `CLAUDE.md`, `pdf_text_annotations.md`, `pdf_embedded_annotation_import.md`,
`pdf_embedded_annotation_live_sync.md`, `pdf_annotation_export.md`, `pdf_annotation_two_way_sync.md`,
`pdf_annotation_reader_compatibility.md`, and the code cited below. Every conclusion was re-checked
against the code: line numbers are at `6bc57b5`.

Paths are abbreviated as follows:
- `D/` = `source/apps/reading-book-desktop/`
- `S/` = `source/apps/book-reader-sdk/src/`

## 1. Verified current state (answers 1–10)

**1. How does Readmate read the annotations already in a PDF?**
- Main reads the bytes and sends them to a long-lived worker (`D/electron/ipc/overlay.ipc.ts:476`
  `ensureScanWorker`).
- The worker runs pdf.js 5.4.624 (legacy build), calling
  `page.getAnnotations({ intent: 'display' })` (`D/electron/pdf-sync/pdf-annotation-scan.ts`).
- Each item is mapped by `readPdfJsAnnotation` (`S/app-models/pdf-embedded-annotations.ts:178`). Items
  flagged Invisible, Hidden or NoView are dropped (`:68`).
- `/NM` is read from the raw PDF objects (`D/electron/pdf-sync/pdf-raw-objects.ts`), because pdf.js
  doesn't expose it.
- The scan runs on open and on every settled file change. The renderer itself does **not** scan any
  more.

**2. Where are annotations stored?**
- **SQLite always**: rows in `notes`; the link to the file in `pdf_embedded_annotations` (migrations
  023 and 024).
- **The PDF as well**, but only for books with write-back enabled.

**3. Are annotations made in Readmate written into the original file?**
- **No, by default.**
- **Yes, when the user enables** "Sync annotations into this PDF file" for that book
  (`pdf_annotation_write_back`, `D/.../sqlite-overlay-store.ts:632`). Only referenced files qualify
  (`overlay.ipc.ts:550`).
- Export always writes a **new** file (`D/electron/pdf-sync/pdf-annotation-export.ts`).

**4. Does Readmate notice external changes?**
- Yes. `StableFileWatcher` watches the folder (`stable-file-watcher.ts:86`), backed by a 2 s poll
  (`:97`), then debounces and checks stability (`:143`).
- The service skips identical content (`pdf-annotation-sync-service.ts:294`) and files without
  `%%EOF` (`:295`).
- The reader updates through `overlay:pdfEmbeddedAnnotationsChanged`. The document displayed in the
  renderer is **not** reloaded.

**5. Supported types:**

| Direction | Types |
|---|---|
| Read from the PDF | Highlight, Underline, Squiggly (stored as underline), StrikeOut, Text (sticky note) |
| Write to the PDF | Highlight, Underline, StrikeOut, Text (`S/app-models/pdf-annotation-export.ts:55`) |

FreeText, Ink, Stamp, shapes, Link and widgets are neither imported nor touched.

**6. Mapping:**

| Attribute | How it is mapped |
|---|---|
| ID | `/NM` key `nm1:<page>:<hash>#n`, falling back to subtype + page + geometry rounded to 0.001 (`pdf-embedded-annotations.ts:309`). Readmate writes `/NM (readmate:<noteId>)` |
| Coordinates | normalized 0–1 in the displayed page box. Read and write go through `viewport.transform` at scale 1, so rotation and crop box are handled |
| Color | `/C` ↔ `#RRGGBB`; `/CA` ↔ alpha |
| Note | `/Contents` ↔ `note` |
| Page | 0-based `pageIndex` |
| Author (`/T`) | read for the change hash only; **not stored**. Readmate writes `/T (Readmate)` |

**7. Can a merge overwrite an edit made in Readmate?**
- **Write-back off:** no. A changed row keeps the app's version (`planEmbeddedAnnotationSync`,
  `:439`).
- **Write-back on:** a per-field three-way merge. The same field changed differently on both sides
  becomes a conflict, and neither side is overwritten (`pdf-annotation-two-way.ts:219`).

**8. Can Readmate tell its own changes from another app's?**
- Yes, by SHA-256: after Readmate writes, `lastSyncedSha` is the new hash, so the watcher event is a
  no-op.
- Per annotation, by the `/NM (readmate:…)` names and the per-pair base snapshots.

**9. What happens when another app saves an old copy?**
- Readmate sees an ordinary external change.
- An annotation Readmate wrote that is missing from that copy is deleted from SQLite if the row
  hadn't changed since. If the row had changed, a `removed-in-file` conflict is raised.
- **The loss is real**, and Readmate cannot prevent it.

**10. Protections:**

| Case | Protection |
|---|---|
| Encrypted files | refused (`pdf-incremental-writer.ts:142,187`) |
| Signed files | confirmation before export (`pdf-annotation-export.ts:102`) and before enabling write-back |
| Locked files | `EBUSY` / `EPERM` / `EACCES` → retried 10 × 3 s (`sync-service.ts:231`) |
| File changed between scan and write | restart the cycle (`:219`) |
| Partial or truncated save | not scanned (`%%EOF` check) |
| Atomic replacement | the watcher follows the folder; Readmate writes with temp + rename (`writeFileSafely`, `:69`) |

## 2. Current read / write flow

```
External reader saves → [folder watch + 2 s poll] → debounce 250 ms → 2 × stat 400 ms apart
  → read bytes (stat before/after) → %%EOF + SHA-256 → scan worker (pdf.js + /NM)
  → write-back off: planEmbeddedAnnotationSync → SQLite (1 transaction)
  → write-back on : planTwoWaySync ─┬→ (file ops) worker append + read-back → re-hash the file → temp+rename
                                    └→ SQLite applyTwoWaySync (1 transaction) → lastSyncedSha
  → push event → renderer store (rows, deletions, conflicts) → overlay repaint
Readmate edit → overlay:saveHighlight / deleteHighlight → notifyAppChange (300 ms) → same cycle
Export → save dialog (Main) → worker write + verify → source unchanged? → temp+rename to the NEW file
```

## 3. Files and modules involved

- **SDK:** `app-models/pdf-embedded-annotations.ts`, `pdf-annotation-export.ts`,
  `pdf-annotation-two-way.ts`, `pdf-highlight.ts`.
- **Main:**
  - `electron/pdf-sync/` (watcher, sync service, scan, worker, raw objects, syntax, writer, write,
    export);
  - `electron/ipc/overlay.ipc.ts`, `channels.ts`, `api-types.ts`, `preload.ts`;
  - `persistence/sqlite-overlay-store.ts`, migrations 023 and 024;
  - `files/open-book-content.ts`, `files/sandbox.ts`, `signature/signature-service.ts`.
- **Renderer:**
  - `reader/renderers/pdf/PdfRenderer.tsx` (canvas hiding only);
  - `screens/Reader/logic/pdfHighlights/pdfHighlightsStore.ts`, `logic/pdfExport/*`,
    `logic/hooks/useReaderPdfHighlights.ts`;
  - dialogs, `SyncConflictBanner`, `MoreMenu`.

## 4. Architectural gaps found

1. **`books.sha256` is never updated** after Readmate's own writes or external saves.
   `library:relinkBook` (an exact hash match) then fails once the file has moved. Duplicate detection
   on re-import also no longer matches.
2. **The displayed PDF document is not reloaded.** Changes to types Readmate doesn't import (Ink,
   FreeText…) only appear after a reopen.
3. **Rename-over** gives the file a new inode and loses its ACLs and attributes. A reader that holds
   the old handle keeps the old version.
4. **Text notes are lossy:** a sticky note in the file sits at an icon position, while Readmate
   anchors a note to text. The geometry is deliberately never synced.
5. **No `/NM`, or a name that becomes unreadable** (encrypted files, object streams with a
   predictor): the identity falls back to geometry, so a move becomes delete + add.
6. **Author (`/T`) and tags** are not modeled.
7. **The signature is checked only when write-back is enabled**, not before each write.
8. **Memory on large files:** the bytes are copied Main → worker, then into a latin1 string for
   `/NM`, so peak memory is several times the file size. There is a single shared worker with a 60 s
   timeout, and a hung scan kills it for every session.
9. **Conflict UI is minimal:** a banner in the popup and a toast. There is no list of open conflicts,
   no side-by-side comparison, and nothing for frozen multi-page rows.
10. **No real external reader has been tested.** The only cross-check is PDFium inside Electron.
    `spike:pdf:two-way` had **1 unexplained failure** in 18 runs.

## 5. Risks and limits

- Concurrent saves can't be prevented. File locks, the watcher and rename don't control how other
  apps save.
- Readmate can't force another reader to reload.
- The latency figures (≈0.5–1.4 s) are measured inside Readmate only, on the data side. The other
  reader's refresh is not measured.
- Signature validity is never claimed after a write.
- **Compatibility with Foxit, Acrobat, SumatraPDF or PDF-XChange is unproven.**

## 6. Target architecture (assessment)

The shared file is the only exchange point every reader understands, so the current design keeps it:
- standard annotations;
- incremental appends;
- `/NM` identity;
- per-pair base snapshots;
- write-back off by default.

Recommended additions, in order:
1. A real-reader test matrix, starting with Foxit, which is installed.
2. Keep `books.sha256` in step with known-good versions, or keep a list of accepted hashes.
3. An option to append in place instead of rename-over (preserves the inode and ACLs). It needs crash
   analysis.
4. A conflicts panel.
5. Streaming or limited memory use for large files.
6. A re-check of signature and encryption before every write.

## 7. Decisions needed before implementing further

1. Should write-back stay off by default?
2. On a write, may Readmate update `books.sha256`, or should it record the history of accepted
   hashes?
3. Rename-over or in-place append, given the lock behaviour of Foxit and Acrobat?
4. Who wins in a "stale copy" save: accept the deletion (current), or always treat it as a conflict?
5. Should author and tags be added to the model?
6. Which readers and versions are officially supported?

## 8. Acceptance criteria

- For each tested reader and version, in both directions: add, recolor, comment, move, resize and
  delete are synced. The result is recorded, including whether a reload is needed.
- No duplicates after 20 consecutive saves; no annotation lost in the documented scenarios.
- Annotations Readmate doesn't support are byte-identical after Readmate writes.
- Encrypted files: refused. Signed files: confirmation, then a warning. Locked files: retried and
  reported.
- Data latency of 3 s or less in Readmate, measured.
- Typecheck, lint, SDK verify, all spikes and full E2E green.

## 9. Tests to add

- A manual Foxit 2024.4 run of the `spike:pdf:compat-kit` checklist (and Acrobat or SumatraPDF if
  installed).
- Relink after a write-back (gap 1).
- A large PDF (100 MB+, 1000 pages): memory and time of the scan.
- A file whose `/NM` is in an object stream with a predictor (gap 5).
- Signed → unsigned → signed transitions while write-back is on (gap 7).
- A soak test of `spike:pdf:two-way` (50 runs) to settle the unexplained failure.
- E2E: the conflict banner flow and the locked-file toast.

---

## 10. Audit: turning PDF write-back on by default (2026-10-18, `6bc57b5`, clean tree)

This section is a read-only audit: no code and no user data were changed. Every point was re-checked
in the code.

### 10.1 Where the setting is read and written

| Place | Role |
|---|---|
| `migrations/024_pdf_annotation_two_way_sync.sql:19` | `pdf_annotation_write_back(book_id PK, enabled DEFAULT 0, updated_at)`. One row per book, **created only when the user toggles** |
| `sqlite-overlay-store.ts:632` `getPdfWriteBack` | **no row → `false`**. This is the effective default |
| `sqlite-overlay-store.ts:637` `setPdfWriteBack` | upsert |
| `overlay.ipc.ts:373` `getPdfWriteBack` IPC | `enabled = stored && eligibility.available` |
| `overlay.ipc.ts:382` `setPdfWriteBack` IPC | enabling runs `writeBackEligibility` (`:545`: referenced file, writable trailer, not encrypted, signature confirmation) and then `notifyAppChange` |
| `overlay.ipc.ts:587` coordinator `twoWay.isEnabled` | **reads only the table**. Eligibility is **not** re-checked at write time |
| `pdf-annotation-sync-service.ts:271, 292, 398` | the only consumers of `isEnabled` |
| Renderer `pdfWriteBackStore.ts:45, 67, 80`, `MoreMenu` toggle | per-book UI |
| `spikes/.../run-pdf-two-way.mjs:67, 86`, `e2e/specs/pdf-two-way-sync.spec.ts` | the tests enable it explicitly |

### 10.2 The default today

| Situation | Default |
|---|---|
| New book (import) | no row → **off** (import never writes this table) |
| Old book / after migration 024 | no row → **off** |
| Migration | only creates the table; no data |

So "on by default" is purely a matter of how a **missing row** is read: a getter or global setting
change. No data migration is required.

### 10.3 Paths that trigger a write-back today

- `overlay:saveHighlight` → `notifyAppChange` (`overlay.ipc.ts:297`). This covers create, recolor,
  style change, note, tags, undo/redo and restore, because all of them save through it
  (`pdfHighlightsStore.ts:259`).
- `overlay:deleteHighlight` → `notifyAppChange` (`:317`). This covers delete and the Delete key.
- Resolving a conflict (`:421`) and enabling write-back (`:399`).
- Not involved: **bookmarks** (they are not PDF annotations), EPUB (no session exists).
- **Only while the PDF is open in a reader window.** An edit made without an open session is written
  by the reconcile when the book is next opened.

### 10.4 Watcher, own changes, write, errors (unchanged by the default)

- **Own writes:** `lastSyncedSha` makes Readmate's own write a no-op.
- **Before writing:** the file is re-hashed and the cycle restarts if it changed.
- **The write:** a worker append plus read-back, then temp + rename.
- **SQLite:** one transaction after the write.
- **A locked file** (`EBUSY` / `EPERM` / `EACCES`, which includes **read-only** and **no write
  permission**) is retried 10 × 3 s and reported as `writeStatus: 'locked'`. Then it waits for the
  next trigger.
- **No backup** of the original file is kept. Safety relies on appending: earlier revisions remain
  inside the file.

### 10.5 Blocking risks if the default simply flips

1. **Eligibility is bypassed.** `isEnabled` reads only the table. If a missing row meant "on", the
   coordinator would try to write into:
   - **managed copies** (read-only `0444`, which fails as `locked` with endless retries);
   - **encrypted** files (refused by the writer as `failed`, on every cycle);
   - **signed** files, **without any confirmation**: the signature becomes "modified after signing".

   `isEnabled` must apply the same eligibility rules as the toggle (cached per session), and signed
   files must stay opt-in.
2. **Existing books would start being written the next time they are opened**, including every
   annotation already in SQLite. Opening = modifying the user's file. This is the consequence of
   option B.
3. **A stale-copy save by another app** deletes untouched Readmate annotations
   (`pdf_annotation_two_way_sync.md` §6). With the default on, many more users are exposed.
4. **`books.sha256` drift** (gap 1): with writes by default, relink by hash breaks for every synced
   book.
5. **Read-only folders** (CD, network share, OneDrive "online-only") produce a noisy, repeated
   `locked` state. They should be detected up front (try opening for write) and switched off.
6. Many more users rely on behaviour that is **unverified with Foxit, Acrobat and SumatraPDF**.

### 10.6 Options

| | A. On for new PDFs only | B. On for every PDF, existing ones too | C. Global default + per-book override |
|---|---|---|---|
| Migration | none (write a row on import) | none (a missing row means "on") | none (a missing row = global setting; explicit rows stay) |
| Existing books | stay off | **all start being written when opened** | follow the global setting (see decision 2) |
| Respects earlier explicit choices | yes | yes | yes |
| User control | per book | per book | global + per book |
| Risk | low | **high** (silent mass modification) | medium; controllable with a one-time notice |
| Product goal ("on by default, no per-book switch") | partial (old books still need the switch) | full | full (global ON) |

### 10.7 Recommendation: **C**

The recommended shape:
- A global setting "Write annotations into PDF files", **ON by default**, owned by **Main**. The
  coordinator needs it without the renderer, like `background-prefs.json`: a JSON prefs file via
  `electron/prefs/json-prefs-file.ts`.
- The existing per-book table stays as an **explicit override** (`enabled` 0 or 1). No row means
  "follow the global setting".

The effective value of `isEnabled(bookId)` is `override ?? global`, AND eligibility (referenced,
writable folder, not encrypted), AND (not signed, OR the user explicitly enabled that book).

- **Existing books:** they follow the global setting, but the first write to a book that already has
  annotations is announced once ("Readmate will now write your annotations into this PDF"). The
  alternative is to keep books imported before the change off until confirmed (decision 2).
- **Signed files:** never written by default; they require the per-book confirmation as today.
- **UI:**
  - Settings gets a global switch.
  - The per-book More-menu item stays, now showing "On (default)" / "Off for this book".
  - "Reset App Settings" resets the global switch to ON.
- **No DB migration is needed.** Explicit rows written by earlier toggles keep their meaning.

### 10.8 Files to change (when implemented)

- `electron/prefs/` (new `pdf-sync-prefs`) plus IPC: get / set the global setting, in `channels.ts`,
  `api-types.ts`, `preload.ts`, `src/bridge/overlay.ts`.
- `sqlite-overlay-store.ts`: `getPdfWriteBackOverride` returning `boolean | null`, and the ability to
  clear an override.
- `overlay.ipc.ts`:
  - an effective `isEnabled` with cached eligibility (`writeBackEligibility`, plus a writable-folder
    probe);
  - the `getPdfWriteBack` DTO with `source: 'default' | 'book'`.
- `pdf-annotation-sync-service.ts`: eligibility failures stop retries; a one-time "first write"
  notice event.
- Renderer:
  - `pdfWriteBackStore.ts`, `MoreMenu.tsx` (labels);
  - a Settings screen entry;
  - `resetAppSettings.ts` (`APP_SETTINGS_RESETTERS`).
- Docs: `pdf_annotation_two_way_sync.md` §2, and `CLAUDE.md` (the invariant), **after your approval**.

### 10.9 Tests to update or add

- `spike:pdf:two-way`: the default (no row) writes; an explicit "off" row never writes; signed,
  encrypted and managed files are never written by default; a read-only folder doesn't retry
  forever.
- `e2e/pdf-two-way-sync.spec.ts`: no toggle step; writes happen by default. A new case: the per-book
  "off" stops writes.
- `e2e/pdf-annotation-export.spec.ts`, `pdf-embedded-annotations.spec.ts`,
  `pdf-embedded-live.spec.ts`, `pdf-annotations.spec.ts`, `pdf-pdfium-render.spec.ts`:
  - **these currently assume the book file is unchanged.** With write-back on by default, making
    annotations will modify the fixture file;
  - the export spec's `sha(file) === sourceSha` assertion and the live spec's
    "not written back" expectations must either set the override to "off" or be updated.
- `spike:settings:reset`: the new resetter.
- SDK: no change. The planners are policy-free.

### 10.10 Decisions for you to confirm

1. Option **C** (global ON plus per-book override)? Or **A**?
2. **Existing books:** written by default as soon as they are opened, or only after a one-time
   per-book confirmation?
3. **Signed PDFs:** keep them opt-in per book (recommended)?
4. When another app saves a stale copy, accept the deletion of untouched rows (current), or turn it
   into a conflict now that more users are affected?
5. Should `books.sha256` be updated on Readmate's own writes (fixes relink drift)?
6. Approval to update `CLAUDE.md`'s invariant once this is implemented.


---

## 11. Decision and implementation: write-back always on (2026-10-18)

**Decision (product):** Readmate writes the supported annotations into the book's own PDF
automatically. There is no switch, neither in Settings nor per book; existing PDF books follow the
same behaviour as new ones. This **supersedes the §10 recommendation (option C, global default
plus per-book override)**: a global setting was explicitly ruled out.

What the §10 audit found, and what was done about it:

| §10 finding | Handling |
|---|---|
| `isEnabled` read only the table, so eligibility was never re-checked at write time (managed copies, encrypted and signed files would have been written) | `isEnabled` is gone. `checkWritable` (`pdf-write-eligibility.ts`) runs **before every write** and checks user-owned file, writable file and folder, not encrypted, appendable trailer, not signed (or unverifiable) unless confirmed |
| Existing books would start being written on open | Intended: with no per-book row to consult, the first cycle after opening writes the annotations SQLite already holds. Covered by spike check 9a |
| Signed files written without confirmation | `writeStatus: 'signed'` → confirmation dialog naming the signer. Confirmation lasts for the session (`allowSignedWrite`); declining keeps the data pending |
| `books.sha256` drift breaks "Locate file" | `updateFileFingerprint` after every successful cycle (own writes and external saves). Spike 9f runs a real `relinkBookToFile` after write-backs |
| Read-only folders / locked files: noisy, repeated retries | read-only is detected up front (`W_OK`) and **not** retried; `EBUSY` / `EPERM` get a **bounded** retry (10 × 3 s) and are announced once per reason |
| No backup | None is made: the write is an appended incremental update (earlier revisions stay in the file), temp files are removed. No journal exists, so no lifecycle policy is needed |
| Stale copy saved by another app deletes untouched Readmate rows | **Unchanged** (the user did not answer decision 4): an annotation missing from a complete scan, whose row was never edited in Readmate, is deleted; an edited one becomes a `removed-in-file` conflict. Real exposure grew with the default |

Removed: the More-menu "Sync annotations into this PDF file", its dialog (`PdfWriteBackDialog`), the
`pdfWriteBackStore`, the `overlay:getPdfWriteBack` / `setPdfWriteBack` channels, DTOs, preload and bridge, the
store's `get/setPdfWriteBack`. Added: `pdf-write-eligibility.ts`, `overlay:confirmSignedPdfWrite`,
`pdfSignedWriteStore`, more `writeStatus` values, `LibraryStore.updateFileFingerprint`, an injectable
retry timing for tests. Kept, unused: the table `pdf_annotation_write_back` and its rows (nothing was deleted; an
earlier "off" no longer has an effect).

### Test changes

| Test | Change |
|---|---|
| `spike:pdf:two-way` | no `setPdfWriteBack`; old check 6 split into 6a (read-only: not written, announced once, no retries, written once writable) and 6b (EBUSY: bounded retries, announced once); old check 9 replaced by 9a–9f: existing + new books write without any setting, kind change / move / undo of a delete written while a tag change doesn't touch the file, app-owned copy never written, signed announced once then written after confirmation (an unverifiable signature also blocks), encrypted and unsupported refused by the gate, `books.sha256` and Locate file after write-backs. 21 checks. A mutation check (removing the managed-copy or the signature test from the gate) makes 9c / 9d fail |
| `e2e/pdf-two-way-sync.spec.ts` | no enabling step; asserts the menu has no switch; adds undo of a delete; new test for a read-only PDF (toast, kept in Readmate, flushed once writable) |
| `e2e/pdf-annotation-export.spec.ts` | assumed the book file stays unchanged: now waits for the write-back, and checks the original bytes remain a prefix and that the export of an up-to-date file equals it |
| `e2e/pdf-pdfium-render.spec.ts` | "before" is a pristine copy of the source; also renders the book file itself in PDFium |
| `e2e/pdf-embedded-annotations.spec.ts` | the other viewer's rewrite now keeps Readmate's own annotation (`e2e/support/readmate-annotations.mjs`), as a real viewer would; the StrikeOut removed in the file is now deleted in Readmate (live-sync rule) |
| other E2E, spikes | unchanged |

### What still has to be verified (not claimed)

- **Real readers.** Nothing here was tested with Foxit, Acrobat, SumatraPDF or PDF-XChange. Only pdf.js
  and PDFium (Chromium's engine, inside Electron) were used: automated, not "external applications".
- A real signed PDF with write-back and confirmation: the signed path is covered with a faked verdict
  (the detection itself is covered by `spike:signature:status`).
- File growth: each write appends; there is no compaction. Not measured on large or heavily edited files.
- Behaviour when the file sits on a network share or in a synced folder (OneDrive), and when an antivirus
  holds the file.
- A reader that keeps the old copy in memory and saves it later (stale copy, decision 4).
- `spike:pdf:two-way` had one unexplained failure in an earlier batch run (see §1).

### Results of the implementation (2026-10-18)

SDK `verify` 164 tests; typecheck, lint, E2E typecheck clean; `spike:pdf:two-way` 21/21 and 25
consecutive green runs; every other spike green; full E2E 29 passed, 1 skipped. Details, and the two
fixes found while looping the spike (per-trigger retry budget; test-side races), are in
`pdf_annotation_two_way_sync.md` §9. The unexplained spike failure noted in §1 was most likely the
resurrection race fixed earlier, but that was not proven; no failure remains in 25 runs.
