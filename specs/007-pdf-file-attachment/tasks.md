---

description: "Task list for PDF File Attachment"
---

# Tasks: PDF File Attachment

**Input**: Design documents from `/specs/007-pdf-file-attachment/`

**Prerequisites**: plan.md, spec.md, audit.md, research.md, data-model.md, contracts/pdf-file-attachment.md, quickstart.md

**Tests**: Included. plan.md and quickstart.md §1 require SDK vitest cases and desktop spikes (`spike:pdf:attachment-memory`, `spike:pdf:attachment-write` scenarios 1–14, `spike:pdf:attachment-store`). E2E is manual-only: no task runs it.

**Organization**: by user story (spec.md). Phase 2 contains the M0 memory gate and the atomic, verified writer every story needs.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on an unfinished task)
- **[Story]**: US1…US6 (spec.md)
- Paths are relative to the repo root. `SDK` = `source/apps/book-reader-sdk`, `DESK` = `source/apps/reading-book-desktop`.

## Standing rules for every task

- SDK code must not import Electron, Node, DOM, `better-sqlite3`, React or pdf.js (SDK `tsconfig`: `lib: ES2022`, `types: []`).
- No migration, no new table. Exactly two new IPC channels: `attachments:create`, `attachments:change` (plan.md Complexity Tracking). Any other new channel needs the user's approval.
- No new dependency (Node `zlib` / `crypto` / `fs` streams only). Do not run E2E or Electron unless a spike re-launches itself the documented way.
- The renderer never sends a path, a file name or file bytes. Main re-validates every payload.
- The book file is replaced only through temp → fsync → verify temp → re-check target → rename (research R5–R6). No pending / "Not in the file" state for attachments.
- After each code task run the relevant check from quickstart §1; keep SDK `npm run verify`, desktop `npm run typecheck`, `npm run lint`, `npm run e2e:typecheck`, `npx vite build` green.
- Follow the user's `auto-commit-and-push` preference during `/speckit-implement` unless told otherwise.

---

## Phase 1: Setup

**Purpose**: places for the new code; nothing functional.

- [X] T001 Create `SDK/src/attachments/pdf-attachment-annotation.ts` (empty exports) and re-export it from `SDK/src/attachments/index.ts`; create test file `SDK/tests/attachments/pdf-attachment-annotation.test.ts` with one placeholder `describe`
- [X] T002 [P] Create spike stubs `DESK/spikes/attachments/run-pdf-attachment-memory.mjs`, `run-pdf-attachment-write.mjs`, `run-pdf-attachment-store.mjs` and add `spike:pdf:attachment-memory`, `spike:pdf:attachment-write`, `spike:pdf:attachment-store` to `DESK/package.json`, copying the command shape of `spike:pdf:attachments` (SDK build + `--experimental-transform-types --import ./spikes/txt/register-alias.mjs`)
- [X] T003 [P] Create `docs/implementation_plan/pdf_file_attachment.md` (map stub: links to spec, plan, research) and `docs/implementation_plan/pdf_file_attachment_compat.md` with the empty results table from quickstart §3 (columns: reader, version, OS, check, result = pass / fail / not tested)

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: SDK model, the streaming writer, the atomic write operation and the sync slot. Nothing in US1–US6 can start before this phase; T004–T009 can start immediately.

### SDK model

- [X] T004 [P] Add `'attachment'` to `HighlightStyleKind` in `SDK/src/app-models/highlight-location.ts` and `SDK/src/domain/annotation/highlight.ts`; fix every exhaustive `switch` / record over the kind that the compiler flags (SDK and DESK), treating `attachment` like a non-text PDF annotation with no colour picker and no comment
- [X] T005 [P] In `SDK/src/attachments/pdf-attachment-annotation.ts` define `PdfAttachmentInfo = { name, sizeBytes, sha256, modifiedAt? }` with `parsePdfAttachmentInfo(raw)`: `name` = output of `sanitizeAttachmentFileName`, "1–255 chars; never a path"; `sizeBytes` integer "1 … ATTACHMENT_MAX_BYTES (104 857 600)"; `sha256` "64 lowercase hex"; `modifiedAt` optional ISO 8601; anything else → `null`
- [X] T006 [P] In the same file add `ATTACHMENT_ICON_PT = 20`, `attachmentIconBox(point, page: { width, height, scale1 })` (top-left at the normalised click point, 20 × 20 PDF units converted to normalised units) and `clampAttachmentBox(box)` (keeps size, moves the box wholly inside `[0,1]²`), per data-model §1
- [X] T007 [P] In `SDK/src/attachments/attachment-policy.ts`: accept the id shape `rm-<uuid>` in `isAttachmentId`; add `readmateAttachmentId(rowId)` and `rowIdOfReadmateAttachmentId(id)`; add `ATTACH_COMBINED_MAX_BYTES` (placeholder `Number.MAX_SAFE_INTEGER`, set by T012) and `checkAttachSize(contentBytes, pdfBytes)` → `ok` | `empty` | `too_large { sizeBytes, limitBytes }` | `too_large_for_pdf { sizeBytes, pdfSizeBytes, limitBytes }`
- [X] T008 Extend `parsePdfAnnotation` in `SDK/src/app-models/pdf-highlight.ts` with `pdfAnnotation.attachment`: style kind `attachment` ⇔ `attachment` present; `rects.length === 1`; rect inside `[0,1]²` with width and height > 0; no `shape`, no `typewriter`, no text-markup quads (depends on T004, T005)
- [X] T009 [P] SDK tests in `SDK/tests/attachments/pdf-attachment-annotation.test.ts` and `SDK/tests/attachments/attachment-policy.test.ts`: payload accept / reject table, icon box at each page corner and on rotated viewports, clamp, `rm-<uuid>` ids accepted / malformed refused, `checkAttachSize` at 0, 1, 104 857 600 and 104 857 601 bytes

### M0 memory gate (research R3)

- [X] T010 Add `planAttachmentAppend(bytes, page: PageGeometry, spec)` to `DESK/electron/pdf-sync/pdf-incremental-writer.ts`: returns the ordered new objects as text segments around ONE content placeholder (EmbeddedFile stream dict with `/Filter /FlateDecode /Length <n> 0 R /Params << /Size … /CheckSum <md5> /ModDate … >>`, Filespec `/F` + `/UF` + `/EF << /F /UF >>`, FileAttachment annotation `/Rect /FS /Name /Paperclip /NM (readmate:<rowId>) /M /CreationDate /F 4 /C /Contents /AP << /N >>`, paperclip appearance stream BBox = Rect, page or indirect `/Annots` patch), the indirect `/Length` object number, and `finishXref(offsets)` that serialises the xref section + trailer for classic tables and xref streams exactly as `serialize` does; never adds to `/Names /EmbeddedFiles` (research R1, R2)
- [X] T011 Write `DESK/spikes/attachments/run-pdf-attachment-memory.mjs`: generate PDFs of 1 / 50 / 200 MB and contents of 1 / 50 / 100 MB (compressible and random), run plan → stream (T010 + a minimal streaming writer) → pdf.js scan in a `Worker` with the app's `SCAN_WORKER_HEAP_LIMIT_MB`; print peak heap and wall time for attach + verify, a following ordinary annotation write, and an open scan; exit non-zero when a combination crashes the worker
- [X] T012 Record the M0 table in `specs/007-pdf-file-attachment/research.md` R3 and set `ATTACH_COMBINED_MAX_BYTES` in `SDK/src/attachments/attachment-policy.ts` to the largest PDF + content total that passed with margin (≥ 20 % heap headroom); if every combination passed, set it to the largest measured total and note that in R3

### Atomic, verified write operation

- [X] T013 Add `writeFileSafelyStreaming(target, write: (handle) => Promise<void>, beforeRename?: () => Promise<void>)` to `DESK/electron/pdf-sync/pdf-annotation-export.ts` (temp `.{name}.readmate-{hex}.tmp` beside the target, `wx`, fsync, optional hook, rename, temp removed in `finally`) and re-express `writeFileSafely` on top of it without behaviour change
- [X] T014 Create `DESK/electron/pdf-sync/pdf-attachment-writer.ts` with `stageAttachmentSource(sourcePath, stagingRoot)`: `lstat` / `stat` must be a regular file (symlink followed once); size check via `checkAttachSize` BEFORE opening for read; stream-copy into `{stagingRoot}/{uuid}/content` (`wx`) counting bytes and computing SHA-256 + MD5; abort `source_changed` if the count ≠ stat size, more than the limit arrives, or size / mtime changed after the copy; `read_failed` on I/O errors; returns `{ stagedPath, sizeBytes, sha256, md5, modifiedAt, cleanup }` (research R4)
- [X] T015 In `pdf-attachment-writer.ts` add `writeAttachmentUpdate({ filePath, bytes, segments, stagedPath, verify })`: through `writeFileSafelyStreaming` write original bytes, segment text, `zlib.createDeflate()` piped from the staged file, the indirect `/Length` object with the counted compressed size, the remaining segments and `finishXref(offsets)` with offsets counted while writing; fsync; call `verify(tempPath)`; re-check the target's size + mtime + SHA-256 equal the scanned version (`blocked` / `changed` otherwise); rename. Map ENOSPC / EIO / EPERM to `write_failed { errno }` (research R5, R6)
- [X] T016 Add worker request kind `attachment-verify` to `DESK/electron/pdf-sync/pdf-annotation-scan.worker.ts` and `pdf-annotation-scan.ts`: open the temp file bytes with pdf.js, find the FileAttachment whose `/NM` is `readmate:<rowId>` (via `pdf-raw-objects.ts` names, as for shapes), compare page, rect (± 0.5 unit), SHA-256 of the decoded `file.content`, and that every annotation id present before is still present; for delete check the NM is absent. Returns `{ ok } | { ok: false, detail }`
- [ ] T017 Add `runFileOperation(bookId, op)` to `DESK/electron/pdf-sync/pdf-annotation-sync-service.ts`: waits for the running cycle, holds triggers until `op` resolves, then sets the session's `lastSyncedSha`, calls `recordFileVersion` and runs exactly one follow-up cycle if a trigger arrived meanwhile; without a session uses a per-book mutex; expose it to IPC handlers the way `pdfAnnotationSyncService()` exposes the service
- [ ] T018 Sweep `{userData}/attachment-staging/` at startup next to the existing `attachment-tmp` sweep in `DESK/electron/attachments/attachment-service.ts`, and remove orphan `.<name>.readmate-*.tmp` files beside the target before each attachment write (only names matching our pattern)

### Live sync and IPC plumbing

- [ ] T019 Add `'FileAttachment'` handling to `SDK/src/app-models/pdf-embedded-annotations.ts`: a scanned FileAttachment with `/NM` prefix `readmate:` is a `ScannedPdfAnnotation` (subtype `FileAttachment`, one rect, no content) mapped to style kind `attachment`; no other FileAttachment is ever an annotation
- [ ] T020 In `SDK/src/app-models/pdf-annotation-two-way.ts` make kind `attachment` never produce a file op, and file-authoritative: a changed rect in the file updates the row; a `complete` scan without the row's NM deletes the row; a `readmate:` FileAttachment with no row is inserted as an `attachment` row (research R7). In `SDK/src/app-models/pdf-annotation-export.ts` skip kind `attachment` (research R14)
- [ ] T021 [P] SDK tests in `SDK/tests/app-models/pdf-annotation-two-way.test.ts` (or the existing two-way test file): no file op for `attachment`; row follows a moved rect; row deleted only after a complete scan; foreign FileAttachment ignored; import of an orphan `readmate:` FileAttachment; export plan skips `attachment`
- [ ] T022 Extend the scan in `DESK/electron/pdf-sync/pdf-annotation-scan.ts` (worker kind `scan`): keep Readmate FileAttachment items (T019) and return `pageAttachments` for every other FileAttachment `{ attachmentId (page-{page}-{ordinal}-{hash12} via existing buildAttachmentId), pageIndex, rect (normalised, clamped), name (sanitised), sizeBytes | null, objectId }`, capped at `ATTACHMENT_MAX_COUNT`; add the optional `pageAttachments` field to `PdfAnnotationSyncEvent` in `pdf-annotation-sync-service.ts` and its DTO in `DESK/electron/ipc/api-types.ts` (contracts §3)
- [ ] T023 Add `create: 'attachments:create'` and `change: 'attachments:change'` to `AttachmentChannels` in `DESK/electron/ipc/channels.ts`; the DTOs `CreatePdfAttachmentRequestDto`, `CreatePdfAttachmentResultDto`, `ChangePdfAttachmentRequestDto`, `ChangePdfAttachmentResultDto` exactly as contracts §1–2 in `DESK/electron/ipc/api-types.ts`; methods on `DesktopApi`; expose them in `DESK/electron/preload.ts`; wrappers `createPdfAttachment` / `changePdfAttachment` in `DESK/src/bridge/attachments.ts`
- [ ] T024 Refuse style kind `attachment` in `overlay:saveHighlight` / `overlay:deleteHighlight` (`invalid_payload`) in `DESK/electron/ipc/overlay.ipc.ts`, and in annotation import planning in `SDK/src/annotation-transfer/` (report such entries "not placed") (contracts §5)

**Checkpoint**: SDK `npm run verify` green; `spike:pdf:attachment-memory` passes; desktop typecheck / lint green; `spike:pdf:two-way` and `spike:pdf:export` unchanged.

---

## Phase 3: User Story 1 — Attach a file at a place on a page (Priority: P1) 🎯 MVP

**Goal**: choose the tool on a PDF, click a page, pick a file → icon at the click, file embedded in the PDF, still there after reopen.

**Independent Test**: attach a small file to a writable PDF; close the app; delete the original; reopen: icon at the same spot, the file saves out byte-identical (quickstart §1 scenario 1, §2 steps 1 and 4).

### Tests for User Story 1

- [ ] T025 [P] [US1] In `DESK/spikes/attachments/run-pdf-attachment-write.mjs` implement quickstart scenarios 1 (1 B, 1 MB, 50 MB, exactly 100 MB; classic xref, xref stream, rotated, cropped page; PDF that already has highlights / shapes / typewriter / a Foxit-style FileAttachment), 4 (cancel), 11 (two same-named files on one page) and 12 (live sync: no duplicate rows), driving the real Main operation on temp files with a stubbed dialog

### Implementation for User Story 1

- [ ] T026 [US1] Implement `createPdfAttachment(deps, request)` in `DESK/electron/pdf-sync/pdf-attachment-writer.ts` in contract §1 order: validate payload (`pageIndex` < page count, point in `[0,1]²`), `resolveBookFile` (PDF only), inside `runFileOperation`: `checkWritable` → `blocked` (picker NOT opened), Main-owned open dialog (one file) → `cancelled`, `stageAttachmentSource`, icon box via `attachmentIconBox` + `clampAttachmentBox`, `planAttachmentAppend`, `writeAttachmentUpdate` with `attachment-verify`, then ONE SQLite transaction inserting the `notes` row (style kind `attachment`, `page-rect` locator, `pdfAnnotation.attachment`) and its `pdf_embedded_annotations` ledger entry (key `readmate:<rowId>`, base = written state); staging cleaned in `finally`
- [ ] T027 [US1] Register the `attachments:create` handler in `DESK/electron/ipc/attachments.ipc.ts` wiring the real deps (dialog, `resolveBookFile`, sync service, scan worker, `SqliteOverlayStore`, `{userData}/attachment-staging`)
- [ ] T028 [P] [US1] Add capability `fileAttachments` (PDF only) in `SDK/src/app-models/reader-session.ts` and `DESK/src/reader/capabilities.ts`, and the tool `{ id: 'fileAttachment', label: 'File Attachment', group: 'freehand', requires: ['fileAttachments'] }` in `DESK/src/screens/Reader/components/chrome/toolRegistry.ts` (+ `ToolsMenu.tsx` icon); no other format declares the capability
- [ ] T029 [US1] Extend `DESK/src/screens/Reader/logic/attachments/attachmentsStore.ts` (zustand) with `create(bookId, pageIndex, point)`: one create at a time (`creating` state shown as an indeterminate "Attaching…" indicator), on `ok` add the row to `pdfHighlightsStore` (`DESK/src/screens/Reader/logic/pdfHighlights/pdfHighlightsStore.ts`) without a history entry and toast "Attached {name} ({size})"; `cancelled` → nothing, tool stays selected; other codes → message (US4 / US5 tasks)
- [ ] T030 [US1] In `DESK/src/reader/renderers/pdf/PdfRenderer.tsx`: with the File Attachment tool active, a click on a page (not between pages) calls the store's `create` with the normalised point; draw an icon overlay for every `attachment` row (paperclip, 20 pt box, hover tooltip = file name) and hide those annotations' canvas appearance through `hiddenEmbeddedAnnotationIds` when `matchesDisplayedFile` (research R9)
- [ ] T031 [P] [US1] Show `attachment` rows in the Notes list in `DESK/src/screens/Reader/components/sidebar/TocSidebar.tsx` (📎 name, size, page; click → go to page and select) and add the `attachment` filter entry in `DESK/src/screens/Reader/logic/highlights/notesFilterStore.ts`

**Checkpoint**: scenarios 1, 4, 11, 12 pass; a person can attach and see the icon after reopening.

---

## Phase 4: User Story 2 — Open or save out an attached file (Priority: P1)

**Goal**: double-click (or Enter) an icon → details panel → Open (existing confirmation + policy) or Save As; works for Readmate-made and other readers' attachments.

**Independent Test**: attach a `.docx` and an `.exe`; double-click each: `.docx` offers Open and Save As; `.exe` offers Save As only with the reason (quickstart §2 step 2; scenario 13).

### Tests for User Story 2

- [ ] T032 [P] [US2] Extend `DESK/spikes/attachments/run-pdf-attachments.mjs`: `attachments:open` / `saveAs` with `rm-<uuid>` ids resolve by `/NM` in fresh bytes, keep working after a move, refuse an unknown uuid with `attachment_not_found`; add quickstart scenario 13 (hostile names `../`, `CON`, bidi, false `/Size`, executable behind `.pdf`) to `run-pdf-attachment-write.mjs`

### Implementation for User Story 2

- [ ] T033 [US2] In `DESK/electron/attachments/pdf-attachments.ts` and `attachment-service.ts` resolve `rm-<uuid>` ids: find the FileAttachment with `/NM readmate:<uuid>` in the freshly read bytes and extract its content through the existing worker kind `attachment-extract`; policy, 100 MB check, temp copy and Save-As dialog unchanged (contracts §4)
- [ ] T034 [US2] Hold `pageAttachments` from `overlay:pdfEmbeddedAnnotationsChanged` in `attachmentsStore.ts` (replaced on every event, cleared when the book changes) and draw them in `PdfRenderer.tsx` as selectable, non-draggable icons, hiding their canvas appearance via `objectId` only when `matchesDisplayedFile`
- [ ] T035 [US2] Icon interaction in `PdfRenderer.tsx` (clarification Q4): single click selects (name tooltip, no panel); double-click or Enter on a selected icon opens the details panel; right-click menu with Open, Save As and — only for `attachment` rows — Delete; a drag that starts on an icon never opens the panel
- [ ] T036 [P] [US2] Create `DESK/src/screens/Reader/components/dialogs/AttachmentDetailsPanel.tsx`: sanitised name, actual size, page, description if present, Open and Save As; Open goes through the existing confirmation and `attachments:open`; a blocked verdict shows the existing "Readmate can't open this file" text and only Save As; errors (missing / empty / unreadable / over limit) are shown and nothing is written
- [ ] T037 [P] [US2] List other readers' page attachments in the Notes list (`TocSidebar.tsx`) from `attachmentsStore.pageAttachments` as read-only entries (📎 name, size, page) — no colour, no delete

**Checkpoint**: US1 + US2 = the full attach / retrieve loop (MVP).

---

## Phase 5: User Story 3 — Move and delete an attachment (Priority: P2)

**Goal**: drag a Readmate-made icon on its page or delete it after confirmation; the PDF follows; move is undoable.

**Independent Test**: attach, move, reopen → new spot; delete after confirming, reopen → gone and not listed (quickstart scenarios 9, 10; §2 step 3).

### Tests for User Story 3

- [ ] T038 [P] [US3] In `run-pdf-attachment-write.mjs` implement scenarios 9 (move: new rect, same object number, `/FS` and content untouched) and 10 (delete: not listed by pdf.js, every other annotation present, file did not shrink), plus 12 for another writer moving / deleting the annotation (row follows / is removed)

### Implementation for User Story 3

- [ ] T039 [US3] In `pdf-incremental-writer.ts` add the `FileAttachment` replace path: rewrite the annotation dictionary and its appearance with the same object number, keeping `/FS` (add `FS` to the kept keys alongside `Popup`, `IRT`, `RT`, `StructParent`, `OC`); never rewrite Filespec / EmbeddedFile objects
- [ ] T040 [US3] Implement `changePdfAttachment(deps, request)` in `pdf-attachment-writer.ts` (contracts §2): row must be kind `attachment` of `bookId` with its NM in the current file (`not_found`), foreign → `not_editable`; move: rect size equal to stored (± 1e-6) and inside the page; delete: `remove` from `/Annots`; both via `runFileOperation` → `checkWritable` → write → `attachment-verify` → rename → ONE transaction updating / deleting row + ledger entry; register `attachments:change` in `attachments.ipc.ts`
- [ ] T041 [US3] Drag to move in `PdfRenderer.tsx` for `attachment` rows only (box clamped with `clampAttachmentBox`, same page); on drop call the store's `move`; while the request runs the icon shows the target spot dimmed, on refusal / failure it snaps back to the file's position and the message is shown
- [ ] T042 [US3] In `attachmentsStore.ts` add `move(rowId, rect)` (pushes ONE history entry into `pdfHighlightsStore` whose undo / redo call `attachments:change move` back / forward; a refused undo keeps the entry) and `remove(rowId)` (no history entry)
- [ ] T043 [P] [US3] Create `DESK/src/screens/Reader/components/dialogs/DeleteAttachmentDialog.tsx`: file name, and the sentence that the file stays in the PDF's history and the PDF does not get smaller (FR-019); Cancel does nothing; Delete calls `remove`; reached from the context menu, the Delete key on a selected `attachment` icon and the Notes list

**Checkpoint**: scenarios 9, 10, 12 pass; move undo / redo works; delete is confirmed.

---

## Phase 6: User Story 4 — Size limit and clear refusals (Priority: P2)

**Goal**: too large, empty, unreadable or changing files are refused with numbers and nothing changes.

**Independent Test**: pick a 150 MB file → message gives its size and the 100 MB limit; PDF fingerprint unchanged (quickstart scenarios 2, 5; §2 step 5).

### Tests for User Story 4

- [ ] T044 [P] [US4] In `run-pdf-attachment-write.mjs` implement scenarios 2 (100 MB + 1 B → `too_large` with sizes; 0 B → `empty`; a spy proves the source was never opened for reading; target SHA-256 unchanged) and 5 (source grows / shrinks during staging → `source_changed`), plus `too_large_for_pdf` above `ATTACH_COMBINED_MAX_BYTES`

### Implementation for User Story 4

- [ ] T045 [P] [US4] Add `describeAttachFailure(result)` to `SDK/src/attachments/pdf-attachment-annotation.ts` returning message text for every result code of contracts §1–2, sizes formatted with one decimal (`"150.2 MB — the limit is 100 MB"`), never naming PDF, Foxit or Acrobat as the source of the limit; tests in `SDK/tests/attachments/pdf-attachment-annotation.test.ts`
- [ ] T046 [US4] Show `describeAttachFailure` messages from `attachmentsStore.ts` (create and change) through the Reader's existing toast / notice mechanism; the refused file name is shown when known

**Checkpoint**: scenarios 2 and 5 pass; messages match the spec examples.

---

## Phase 7: User Story 5 — PDF that cannot be written, and write failures (Priority: P2)

**Goal**: unwritable PDFs refuse before the picker opens; signed PDFs ask first; any write failure leaves the PDF byte-identical and other pending annotations intact.

**Independent Test**: read-only PDF → refused, no picker; ENOSPC during the write → PDF byte-identical (quickstart scenarios 3, 6, 7, 8).

### Tests for User Story 5

- [ ] T047 [P] [US5] In `run-pdf-attachment-write.mjs` implement scenarios 3 (read-only, managed copy, encrypted, signed not confirmed → `blocked` + reason, picker stub never called), 6 (ENOSPC / EIO injected at temp write, fsync and rename → `write_failed`, target byte-identical, no temp / staging left), 7 (verification forced to fail → `verify_failed`, target byte-identical) and 8 (target modified between scan and rename → `blocked` `changed`, the other program's version kept); also check pending two-way rows of other kinds are still pending afterwards

### Implementation for User Story 5

- [ ] T048 [US5] In `attachmentsStore.ts` handle `blocked` with `reason: 'signed'`: show the existing signed-file confirmation; on accept call `overlay:confirmSignedPdfWrite` and repeat `create` / `change` (the picker opens only then); decline writes nothing
- [ ] T049 [US5] When the open sync reports a blocking write status for the book, show the File Attachment tool disabled with the reason in `toolRegistry.ts` / `ToolsMenu.tsx` (FR-012 "MAY"); a click on the page with a blocked file never opens a picker

**Checkpoint**: scenarios 3, 6, 7, 8 pass.

---

## Phase 8: User Story 6 — Export and compatibility (Priority: P3)

**Goal**: exported PDFs keep attachments; compatibility with pdf.js verified, Foxit / Acrobat recorded.

**Independent Test**: export a PDF with an attachment → content identical in the new file; compat kit produced and record filled (quickstart scenario 14, §3).

- [ ] T050 [P] [US6] Extend `DESK/spikes/pdf-annotations/run-pdf-annotation-export.mjs` (the `spike:pdf:export` script) with scenario 14: export a PDF holding Readmate-made and foreign attachments → each present in the exported file with identical content and position; the export does not add a second copy
- [ ] T051 [P] [US6] Extend `DESK/spikes/pdf-annotations/build-compat-kit.mjs` with attachment files: small text, 50 MB binary, Vietnamese file name, moved, deleted, plus copies of Foxit / Acrobat samples when provided in the input dir; write a README listing what to check per file
- [ ] T052 [P] [US6] In `SDK/src/annotation-transfer/` list `attachment` rows in the readable Markdown copy as `📎 name (size), page n` and leave them out of the restorable JSON (research R14); tests in `SDK/tests/annotation-transfer/`

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T053 [P] Write `DESK/spikes/attachments/run-pdf-attachment-store.mjs`: the real renderer `attachmentsStore` + `pdfHighlightsStore` against the real Main service on temp files — create, cancel, refusals, move + undo / redo, refused undo, delete, book switch clears `pageAttachments`
- [ ] T054 [P] Extend `DESK/spikes/reader-toolbar/run-toolbar.mjs` (`spike:reader:toolbar`) to assert the File Attachment tool exists for PDF only and for none of EPUB, TXT, Markdown, MP3 and other audio formats (SC-007)
- [ ] T055 Measure SC-004 / SC-005 in `run-pdf-attachment-memory.mjs` (10 MB into 50 MB ≤ 5 s; 100 MB into 50 MB completes or is refused; over-limit refusal ≤ 1 s) and record the numbers in `docs/implementation_plan/pdf_file_attachment.md`
- [ ] T056 Complete `docs/implementation_plan/pdf_file_attachment.md` (structures written, flow, ids, limits, delete semantics, known limits incl. scan cost and slower later writes) and add the **PDF file attachments (create / move / delete)** paragraph to `CLAUDE.md` next to "PDF attachments"; list the new spikes in the CLAUDE.md commands section
- [ ] T057 Run the full default checks (SDK `npm run verify`; desktop `npm run typecheck`, `npm run lint`, `npm run e2e:typecheck`, `npx vite build`; all spikes of quickstart §1) and fix anything red

---

## Dependencies & Execution Order

- **Phase 1** → **Phase 2** (blocks everything). Inside Phase 2: T004–T007 parallel; T008 after T004 + T005; T010 → T011 → T012 (M0 gate); T013 → T015; T014, T016, T017, T018 parallel after T010; T019 → T020 → T021; T022 after T019; T023, T024 parallel.
- **US1 (Phase 3)** after Phase 2. **US2** needs US1's rows for `rm-` ids (T033 can start with Phase 2 done; T035 needs T030). **US3** needs US1 (rows exist) and T035 (selection). **US4** and **US5** need T026 (the create operation) and T029 (store). **US6** needs US1; T052 only Phase 2.
- **Polish** after the stories it measures.

```text
Setup → Foundational (M0 gate) → US1 → US2 (MVP) → US3 ─┐
                                    ├→ US4 ──────────────┤→ Polish
                                    ├→ US5 ──────────────┤
                                    └→ US6 ──────────────┘
```

## Parallel Examples

- Phase 2: T004, T005, T006, T007 together; later T014, T016, T017, T018 together; T023 with T024.
- US1: T025 (spike) with T028 (capability / tool) and T031 (Notes list) while T026 → T027 → T029 → T030 run in order.
- US2: T032, T036, T037 together after T033.
- US3: T038 and T043 while T039 → T040 → T041 → T042.
- US4 / US5 / US6 can proceed in parallel once US1 is done (different files except `attachmentsStore.ts`: serialise T046, T048).

## Implementation Strategy

1. **MVP = Phase 1 + 2 + US1 + US2**: attach, see, reopen, open / save out. Stop and validate with quickstart §2 steps 1, 2, 4.
2. Add US4 + US5 (refusals and failure safety) before any release: the Phase 2 writer already guarantees no damage; these stories make the refusals visible and tested.
3. Add US3 (move / delete), then US6 (export, compat record), then Polish.
4. Never claim Foxit / Acrobat compatibility from these tasks; only `pdf_file_attachment_compat.md` results count.
