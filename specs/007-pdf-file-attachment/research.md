# Research: PDF File Attachment

Phase 0 of [plan.md](plan.md). Each item: **Decision / Rationale / Alternatives**. Items marked **M0** are measured
by a spike before the dependent code is merged; the decision stated is the default and the fallback is fixed in
advance so implementation is not blocked on the result. Ground truth for the existing code: [audit.md](audit.md).

## R1. PDF structure written for a new attachment

**Decision**: one incremental update (the existing append-only model) adding:

1. an **EmbeddedFile stream** `<< /Type /EmbeddedFile /Filter /FlateDecode /Length n R /Params << /Size s /CheckSum <md5> /ModDate (D:…) >> >>` holding the file content;
2. a **file specification** `<< /Type /Filespec /F (name) /UF <utf16 name> /EF << /F ref /UF ref >> /Desc … >>` (`/Desc` omitted in this version);
3. a **FileAttachment annotation** `<< /Type /Annot /Subtype /FileAttachment /Rect […] /FS ref /Name /Paperclip /NM (readmate:<rowId>) /M … /CreationDate … /F 4 /C [r g b] /Contents (name) /AP << /N ref >> >>`;
4. its **appearance stream** (a paperclip glyph drawn in vector paths, BBox = Rect);
5. the page's `/Annots` rewritten with the new reference (inline or indirect, as the writer does today);
6. the xref section + trailer continuing the previous one (classic table or xref stream).

It is **not** added to the catalog `/Names /EmbeddedFiles` tree (that is the document-level list; ISO 32000-1
§7.11.4 / §12.5.6.15 make the annotation's `/FS` sufficient; Acrobat / Foxit show such files in their attachment
panes). Adding to the name tree would make a delete leave a document-level attachment behind.

**Rationale**: matches what Foxit / Acrobat write for "Attach File" (FileAttachment + Filespec + EmbeddedFile), is
what pdf.js reads (`FileAttachmentAnnotation` → `file`), and stays inside the existing writer model
(`appendRawObjects` already appends arbitrary objects for Typewriter fonts).

**Alternatives**: document-level only (no position — fails US1); both annotation and name tree (two listings,
delete semantics unclear — rejected); storing a path (`/F` without `/EF`) — forbidden by FR-003.

## R2. Content compression and checksums

**Decision**: always `/FlateDecode` via Node's built-in `zlib` streaming deflate (no dependency). Compressed size is
unknown until the end, so `/Length` is an **indirect** integer object written after the stream (valid PDF, ISO
32000-1 §7.3.8.2). `/Params /Size` (uncompressed), `/CheckSum` (MD5 of the uncompressed content) and `/ModDate`
(source mtime) are known before the stream is written because the content is staged first (R4). SHA-256 of the
content is kept in the app row (`attachment.sha256`) for verification and identity.

**Rationale**: compressed text / office files shrink a lot; already compressed formats grow by < 0.1 %. Indirect
`/Length` lets the content be streamed without holding it in memory.

**Alternatives**: uncompressed (simplest, direct `/Length` = size; rejected: PDFs grow by the full size of every
text-heavy file); compress only when it helps (needs two passes; not worth it in v1).

## R3. Memory: streaming the content, not the PDF (M0)

Facts (audit §2): the writer parses the whole PDF as a latin1 string in the scan worker (heap cap
`SCAN_WORKER_HEAP_LIMIT_MB`); pdf.js `getAnnotations()` materialises every FileAttachment's **decoded** content
(`FileSpec.serializable` includes `content`), and the live sync scans every page with it on open and after every
change.

**Decision**:

- The PDF itself is still read and parsed whole (needed to find the trailer, page and `/Annots`; same as every
  other write). The **attachment content is never held in memory by the writer**: the update is planned as text
  segments around one placeholder, and Main streams `original bytes → segment → deflate(staged file) → segment →
  xref` into the temp file (R5).
- Read-back verification (R6) loads the new file in the scan worker with pdf.js, which materialises the content
  once. That is the peak: roughly `pdf + content + pdf.js working set`.
- **M0 spike `spike:pdf:attachment-memory`** measures peak worker heap and wall time for (PDF 1 MB / 50 MB / 200 MB) ×
  (content 1 MB / 50 MB / 100 MB, compressible and incompressible), for: attach write + verify, a following
  ordinary annotation write, and an open/live-sync scan.
- **Fallback, fixed now**: if a combination exceeds the heap, the attach is refused up front with
  `too_large_for_pdf` when `pdfSize + contentSize` is above a ceiling `ATTACH_COMBINED_MAX_BYTES` set from the
  measurement (one constant in the SDK next to `ATTACHMENT_MAX_BYTES`). The per-file 100 MB limit is unchanged.
  Raising the worker heap is NOT the fallback (it would mask the cost on every later scan).

**M0 result (2026-10-29, `npm run spike:pdf:attachment-memory`, Windows 11 dev machine, plain Node, worker heap
512 MB)**: all 18 combinations passed (PDF 1 / 50 / 200 MB × file 1 / 50 / 100 MB × compressible / random); the
worker never ran out of heap. Times (ms, one run; the 200 MB rows were noisy on this machine):

| PDF + file | stage | plan (worker) | stream write | verify (worker) | next ordinary write | open scan |
|---|---|---|---|---|---|---|
| 1 + 50 random | 142 | 0 | 2 137 | 224 | 258 | 149 |
| 50 + 1 random | 16 | 163 | 522 | 65 | 246 | 82 |
| 50 + 50 random | 470 | 138 | 3 609 | 170 | 432 | 153 |
| 50 + 100 random | 1 198 | 170 | 9 404* | 645 | 835 | 461 |
| 200 + 100 random | 8 543 | 219 | 30 645* | 568 | 1 611 | 421 |
| 200 + 100 text | 15 696 | 715 | 25 595* | 1 282 | 1 026 | 1 045 |

\* measured before writes were batched into 1 MB blocks; the batched re-run of the quick matrix gave the first
three rows. Most of the remaining write time is deflate of incompressible data.

Peak-heap figures from in-worker sampling stayed ~46–53 MB, but sampling cannot see inside synchronous steps,
so the gate is "no out-of-memory at 512 MB", not a heap number. Decision: `ATTACH_COMBINED_MAX_BYTES` =
**300 MiB** (the largest measured total); larger totals are refused with `too_large_for_pdf` because they were
not measured, not because they are known to fail.

**Rationale**: removes the largest copy (the content) from the writer at low cost; keeps every other code path
unchanged; turns the unknown into a measured constant with a clean refusal (FR-014).

**Alternatives**: full streaming PDF parser (large rewrite of `pdf-raw-objects.ts`, out of proportion); raising the
heap (hides the cost); skipping pdf.js read-back (weakens FR-006).

## R4. Reading the picked file safely (FR-011, FR-013)

**Decision**: Main owns the picker (`dialog.showOpenDialog`, one file, all types). Then: `lstat` (regular file, not
a directory / device / FIFO; a symlink is followed once with `stat` and must also be a regular file) → size check
(0 → `empty`, > 100 MB → `too_large` with `{ sizeBytes, limitBytes }`) **before any read** → stream-copy into a
staging file `{userData}/attachment-staging/{uuid}/content` (`wx`), counting bytes and computing SHA-256 + MD5 →
abort with `source_changed` if the counted size differs from the stat size, if more than the limit arrives, or if
`stat` after the copy differs (size / mtime) → the write streams from the staging file only. Staging is removed in
`finally`; the whole staging root is swept at startup (same pattern as `attachment-tmp`).

**Rationale**: guarantees FR-013 (stored = checked) without reading into RAM; a file locked or changed mid-read is
detected; the PDF is not touched until the content is safely staged.

**Alternatives**: read the source twice (hash pass + write pass) — a change between passes still needs detecting
and the source may be slow (network drive); reading into a Buffer — rejected by FR-014.

## R5. Atomic write and serialisation with the live sync

**Decision**:

- A new Main operation `PdfAttachmentWriter` (in `electron/pdf-sync/`) performs create / move / delete. It runs
  **inside the per-book sync session's exclusive slot**: a new `runFileOperation(bookId, op)` on the sync service
  waits for the running cycle, holds off new cycles (queued triggers run after it), and afterwards sets
  `lastSyncedSha` to the new file's hash and calls `recordFileVersion` (so the watcher does not treat Readmate's own
  write as external and `books.sha256` stays current). Without a session (should not happen for an open reader)
  it takes a per-book mutex only.
- Before writing: the existing `checkWritable` (user-owned, writable, not encrypted, signed only if confirmed for
  this session, unchanged since read). Any block → refused with the reason (FR-012); for `signed` the renderer shows
  the existing confirmation and calls `overlay:confirmSignedPdfWrite`, then retries.
- Write: temp file next to the target (`.{name}.readmate-{hex}.tmp`, as `writeFileSafely`), original bytes, then
  the streamed tail; `fsync`; re-check the target's signature (size + mtime + SHA-256 already known) is still the
  scanned one; `rename` over it. Any error (ENOSPC, EIO, EPERM, crash) → temp removed in `finally`; a crash leaves at
  most an orphan `.tmp` next to the file, which the sweep for the book's folder removes on the next write
  (pattern `.<name>.readmate-*.tmp`, only our own names).
- A streaming variant `writeFileSafelyStreaming(target, write: (handle) => Promise<void>)` is added beside
  `writeFileSafely`; the latter is re-expressed on top of it.

**Rationale**: reuses the eligibility and version bookkeeping the two-way sync already depends on; one writer of the
file at a time; rename gives "old or new, never partial" (FR-007).

**Alternatives**: route attachments through the debounced two-way cycle (would create a pending state when the file
is blocked — forbidden by the clarification; would carry 100 MB through the planner) — rejected.

## R6. Verification after writing (FR-006)

**Decision**: order = write temp → `fsync` → **verify the temp file** → re-check the target is unchanged →
`rename`. Verification scans the temp file with the existing worker scan and passes only if it finds a
FileAttachment with `/NM readmate:<rowId>` on the expected page, with the expected rect (± 0.5 unit), whose decoded
content's SHA-256 (computed in the worker, where pdf.js already holds it) equals the staged SHA-256, and every
annotation present before is still present. Move: same NM, new rect, same SHA-256. Delete: NM absent, everything
else present. A failed check deletes the temp file and reports `verify_failed`; the target was never replaced.

**Rationale**: the same "every write is read back" rule as the rest of the writer, applied before anything is
replaced, so a writer bug can never reach the user's file.

**Alternatives**: verify after rename and restore the old bytes on failure (a window where the user's file is
wrong; restore can itself fail) — rejected.

## R7. App-side record and its relation to the file (Q-P6, Q-P7)

**Decision**: a Readmate-made attachment is one ordinary `notes` row (no migration, no new table), style kind
**`attachment`** (new `HighlightStyleKind`), `page-rect` locator, `pdfAnnotation.rects[0]` = icon box,
`pdfAnnotation.attachment = { name, sizeBytes, sha256, mtime? }`. The content lives **only in the PDF**.

The row is created / updated / deleted **only by the attachment operations** after a verified write, in the same
SQLite transaction as its ledger entry in `pdf_embedded_annotations` (key = `/NM readmate:<rowId>`, base =
written state). `overlay:saveHighlight` / `deleteHighlight` refuse kind `attachment` (Main re-validation).

Live sync:
- The scan reports Readmate-made FileAttachment annotations (`/NM` prefix `readmate:`) as `ScannedPdfAnnotation`
  with subtype `FileAttachment` (no content), exactly like Readmate shapes / FreeText today; others' are not
  annotations (R8).
- `planTwoWaySync` **never plans a file write for kind `attachment`** (they are always already in the file); for
  these rows the **file is authoritative**: a changed rect in the file updates the row, and a complete scan without
  the NM deletes the row (e.g. the user deleted it in Foxit). This is the one exception to "app edits win", and it is
  safe because an attachment row never has unsaved edits.
- A `readmate:` FileAttachment found in a file with no matching row (made by Readmate on another machine) is
  imported as an `attachment` row (editable: it is Readmate-made).

**Rationale**: Notes list, selection, history and the IPC surface come for free (same as shapes / typewriter);
the file stays the single source of truth for content.

**Alternatives**: no row at all, derive from the file every time (Notes list / history would need a second model);
storing content in SQLite (rejected by the clarification).

## R8. Attachments made by other readers (FR-022)

**Decision**: not annotations in the app. The open / live-sync scan additionally returns a **`pageAttachments`**
list for non-Readmate FileAttachment annotations: `{ attachmentId, pageIndex, rect (normalised), name (sanitised),
sizeBytes, objectId }` — id format unchanged (`page-{page}-{ordinal}-{hash12}`). Delivered on the existing
`overlay:pdfEmbeddedAnnotationsChanged` event (new optional field). The renderer draws a selectable, non-draggable
icon for each; Open / Save As go through `attachments:open` / `attachments:saveAs` unchanged.

**Rationale**: same split as shapes (Readmate's are annotations; others' are the file's own objects); no extra
scan pass (the sync scan already walks every page's annotations).

## R9. Drawing the icon (Q-P4)

**Decision**: Readmate writes an `/AP /N` appearance (vector paperclip, 20 × 20 PDF units like the sticky note
`NOTE_ICON`) so readers that draw appearances show it, plus `/Name /Paperclip` for readers that use their own icon.
In Readmate, the overlay draws its own icon for **every** page attachment (Readmate-made and others') and the
canvas appearance of those annotations is hidden through the existing `hiddenEmbeddedAnnotationIds` mechanism
(only when `matchesDisplayedFile`), so there is exactly one icon, always visible, with selection / hover / drag.
The icon box is fixed at 20 × 20 PDF units, converted to the normalised box at creation; its top-left is the
click point, clamped inside the page (FR-010).

**Alternatives**: rely on pdf.js canvas only (pdf.js draws nothing for a FileAttachment without `/AP`; no
selection affordance) — rejected.

## R10. Identity across move (Q-P5)

**Decision**: the stable identity of a Readmate-made attachment is its row id (= `/NM readmate:<rowId>`). Open /
Save As for those use an attachment id of a new shape **`rm-<rowId>`**, accepted by `isAttachmentId` and resolved
in Main by `/NM` in the current file bytes (so a move never changes the id). Others' keep the positional +
hash id. Moving rewrites only the annotation dictionary (and its appearance) with the same object number, keeping
`/FS` (and `/Popup`, `/IRT`, `/StructParent`, `/OC` as the writer already does); the Filespec and EmbeddedFile
objects are not rewritten.

## R11. Delete semantics (FR-019)

**Decision**: delete = remove the annotation from the page `/Annots` (writer's existing `remove`, which also drops
a `/Popup`). Filespec / EmbeddedFile objects become unreferenced in the new revision; their bytes remain in the
earlier revision. The confirmation text states exactly that. The orphaned objects are not re-listed by pdf.js
(it lists only `/Annots` entries and the name tree).

## R12. IPC surface

**Decision**: two new channels in `AttachmentChannels` (four-place rule: `channels.ts`, `attachments.ipc.ts`,
`preload.ts` + `api-types.ts`, `src/bridge/attachments.ts`):

- `attachments:create { bookId, pageIndex, point }` — Main checks eligibility, opens the picker, stages, writes,
  verifies, commits the row; returns the row or a coded refusal.
- `attachments:change { bookId, rowId, op: 'move', rect } | { bookId, rowId, op: 'delete' }`.

Existing: `attachments:open`, `attachments:saveAs` (accept `rm-<rowId>`), `overlay:confirmSignedPdfWrite`,
`overlay:pdfEmbeddedAnnotationsChanged` (+ `pageAttachments`). No migration.

**Rationale**: the renderer cannot pick a file or send bytes/paths (CLAUDE.md), so creation needs a Main-owned
operation; move / delete need the synchronous "reach the file or refuse" behaviour the two-way cycle cannot give.

## R13. Undo / redo

**Decision**: only **move** enters the `pdfHighlightsStore` history (undo / redo = another `attachments:change
move`). Create and delete are not in the history: undoing a create would delete the user's file from the PDF
without the delete confirmation, and redoing a delete would need the removed content. If the file became
unwritable, undo / redo reports the refusal and the history entry stays where it was.

## R14. Export PDF with annotations, annotation export (spec 006)

**Decision**: `overlay:exportAnnotatedPdf` copies the source bytes, which already contain every attachment; its
row → write planning skips kind `attachment` (they are in the source). Spike checks content identity in the export.
Spec 006 export skips kind `attachment` in the restorable JSON; the readable `.md` lists `📎 name (size), page n`.
Import never creates kind `attachment` (rows of that kind in a file are reported "not placed").

## R15. Compatibility evidence

**Decision**: automated: pdf.js read-back in the spikes (page, rect, name, content hash, both `getAttachments()`
unchanged and `getAnnotations()` FileAttachment). Manual: extend `spike:pdf:compat-kit` with attachment files
(Readmate-made: small text, 50 MB binary, Vietnamese file name, moved, deleted) and a results table
(`docs/implementation_plan/pdf_file_attachment_compat.md`) per reader + version. No claim beyond what is recorded.
