---

description: "Task list for Annotation Import and Export (EPUB, PDF, TXT, Markdown)"
---

# Tasks: Annotation Import and Export

**Input**: Design documents from `/specs/006-annotation-import-export/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (`annotation-file.schema.json`, `ipc.md`, `readable-markdown.md`), quickstart.md, audit.md

**Tests**: Included. plan.md and quickstart.md require SDK vitest tests and desktop spikes (repo convention: the desktop app has no test runner). E2E is manual-only: no task runs it.

**Organization**: Grouped by user story. US1 + US2 (both P1) are the MVP: export, then restore, including the shared target-choice step (T030, T047, T046).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on an unfinished task)
- **[Story]**: US1…US4 (spec.md user stories)
- IDs T044+ were added by the analysis remediation; their position in a phase, plus the Dependencies section, gives the execution order. T030 now sits in Phase 2 (it has no story label); T046 sits in US2.
- Paths are relative to the repo root. `SDK` = `source/apps/book-reader-sdk`, `DESK` = `source/apps/reading-book-desktop`, `SPEC` = `specs/006-annotation-import-export`.

## Standing rules for every task

- SDK code must not import Electron, DOM, `better-sqlite3`, React or a format engine (SDK `tsconfig`: `lib: ES2022`, `types: []`).
- No SQL migration. Never touch `notes` through `overlay:saveHighlight` / `txt:commit`; the import service calls `SqliteOverlayStore.writeHighlight` inside its own `BEGIN IMMEDIATE` (research R2).
- The renderer never gets or sends a filesystem path, only `bookId` / `sessionId`. Dialogs and file I/O live in Main.
- Build on Main's `note_json` shape (`INoteState`, `buildHighlightNoteJson` in `DESK/electron/persistence/sqlite-overlay-store.ts`), NOT on SDK `persistence/sql-notes.ts` (different layout).
- Audiobooks are never offered the feature; DOCX/DOC have none.
- Do not install dependencies and do not run E2E or Electron windows. A task that needs a new package stops and asks.
- After each task touching code run the matching check from quickstart.md; keep SDK `npm run verify`, desktop `npm run typecheck` and `npm run lint` green.
- Commit + push after each finished task per the user's `auto-commit-and-push` memory, unless told otherwise this session.

---

## Phase 1: Setup

- [X] T001 Create `SDK/src/annotation-transfer/index.ts` (empty barrel) and add `export * from './annotation-transfer/index.js'` to `SDK/src/index.ts` next to the other module exports; create the folder `SDK/tests/annotation-transfer/`.
- [X] T002 [P] Create `DESK/spikes/annotations/` with stub `run-annotations-main.mjs` and `run-annotations-store.mjs` modelled on `DESK/spikes/audio/run-audio-zip.mjs`, and add `spike:annotations:main` and `spike:annotations:store` to `DESK/package.json` using the same command shape as `spike:audio:zip` (SDK build first, `--experimental-transform-types`, `register-alias.mjs`).
- [X] T003 [P] Add the `AnnotationTransferChannels` group (`count`, `exportRestore`, `exportReadable`, `pickFile`, `setTarget`, `confirm`, `discard`, `cancel`, `progress`; names `annotationTransfer:<name>` per `SPEC/contracts/ipc.md`) to `DESK/electron/ipc/channels.ts`.

---

## Phase 2: Foundational (blocks every story)

- [X] T004 [P] Implement `SDK/src/annotation-transfer/file-format.ts`: types `AnnotationFile`, `TransferAnnotation`, `FILE_VERSION = 1`, `FILE_EXTENSION = '.readmate-notes.json'`, and `parseAnnotationFile(text): {ok:true,file}|{ok:false,errorCode}`. Constraints (verbatim from data-model.md): `fileVersion` int `1`, greater than supported -> `newer_version`; `book` = `{ title, author?, format: 'epub'|'pdf'|'txt'|'md', sha256, pageCount? }` (`pageCount` integer >= 1, optional, PDF only); `annotations` not empty; `type` one of highlight, underline, squiggly, strikethrough, replace, insert, textbox, rectangle, ellipse, line, arrow, typewriter; `locator` is the stored `NoteLocator` (`{kind:'cfi',cfi,chapterIndex?}` | `{kind:'page-rect',page>=1,rect?,chapterIndex?}` | `{kind:'text-offset',offset>=0,blockId?: 'txt'|'md',chapterIndex?}`); `colorHex` `#RRGGBB` or `#RRGGBBAA`; `origin` `'app'|'file'`; `nm` only for PDF file-origin. Not JSON -> `damaged`; JSON without `fileVersion`/`book`/`annotations` -> `not_annotation_file`. An invalid single annotation is kept out of the result and counted (re-validated later with the existing parsers). Export from `index.ts`.
- [X] T005 [P] Write `SDK/tests/annotation-transfer/file-format.test.ts`: accepts `SPEC/samples/sample-epub.readmate-notes.json`; rejects truncated text (`damaged`), `{}` (`not_annotation_file`), `fileVersion: 2` (`newer_version`), empty `annotations`, unknown `type`, bad colour; Vietnamese strings round-trip through `JSON.stringify`/`parse` unchanged.
- [X] T006 [P] Implement `SDK/src/annotation-transfer/content-key.ts`: `contentKeyOf(a: TransferAnnotation): string` = `type` + normalised locator + `selectionText.highlight` + `note` + format geometry (PDF `pdfAnnotation` rects rounded to 4 decimals, TXT `txtAnnotation` offsets, Markdown `mdAnnotation`), independent of SQLite ids (data-model "Identity"). Test in `SDK/tests/annotation-transfer/content-key.test.ts`: same content different ids -> equal; different comment -> different; key stable across key order.
- [X] T007 [P] Add the SDK helper for PDF origin (research R3b): export `isReadmateAuthoredKey(noteId, sourceKey)` from `SDK/src/app-models/pdf-embedded-annotations.ts` (re-exported by `SDK/src/app-models/index.ts`), using the same `hash53` and `nm1:<pageIndex>:<hash53(nm)>#n` form as `embeddedAnnotationIdentities` with nm = `readmate:<noteId>`. Test in `SDK/tests/app-models/pdf-embedded-annotations.test.ts`. If the equivalence cannot be proven, instead tag every PDF row `origin: 'app'` and carry `nm` when known, and record that in research.md R3b.
- [X] T008 Add a read method to `DESK/electron/persistence/sqlite-overlay-store.ts` returning annotation rows of a book with their raw `note_json` fields needed by export (`listAnnotationsForTransfer(bookId)`: same predicate as `ANNOTATION_TYPE_PREDICATE` — group null/`annotation`, the 12 types — plus `created_at`/`updated_at`), and `listExistingNoteIds(ids)` for the id-reuse check (data-model "Identity", audit H1). Read-only; no write path changes.
- [X] T009 [P] Add DTOs to `DESK/electron/ipc/api-types.ts`: `ExportResult`, `ImportPreviewDto` (data-model "ImportPreview": `fileBook`, `startedFrom?`, `target|null` with `matchedBy: 'sha256'|'title'|'chosen'`, `requiresChoice`, `fileBookMissing?`, counts, `notPlaced[]`), `ImportResult`, `AnnotationTransferProgressDto`, error codes `not_found | empty | cancelled | not_annotation_file | damaged | newer_version | format_mismatch | book_missing | file_unavailable | target_not_confirmed | stale_preview | write_failed` (data-model "Results"), and the `annotationTransfer` block of `DesktopApi` with the signatures in `SPEC/contracts/ipc.md`.
- [X] T010 Create `DESK/electron/ipc/annotation-transfer.ipc.ts` with `registerAnnotationTransferHandlers()` (handlers return `{ok:false,errorCode:'not_found'}` until later tasks fill them), register it in `DESK/electron/ipc/index.ts` `registerAllIpcHandlers()`, expose every channel in `DESK/electron/preload.ts` through `contextBridge` typed by `DesktopApi`, and add `DESK/src/bridge/annotationTransfer.ts` re-exported from `DESK/src/bridge/index.ts` (the four-place IPC sync from CLAUDE.md). Handlers reject non-string ids and audiobook ids (`not_found`).
- [X] T030 [P] Implement `DESK/electron/annotation-transfer/identify-book.ts`: `identifyBook(fileBook)` -> `{bookId, matchedBy: 'sha256'|'title'} | {missing: {title, author}}` using `getLibraryStore()` (sha256 first, then title + author + format); format must equal (`format_mismatch`).

**Checkpoint**: SDK types and tests green; `npm run typecheck` green in desktop; channels reach Main and return `not_found`; `identifyBook` (T030) ready.

**Implementation notes (Phase 1–2, done)**: DTO names carry the `AnnotationTransfer` prefix (`AnnotationExportResult`, `AnnotationImportPreviewDto`, `AnnotationImportResult`, ...) to avoid clashes in `api-types.ts`; the handler registrar is `registerAnnotationTransferIpc` (repo naming); the row predicate in `sqlite-overlay-store.ts` is called `HIGHLIGHT_TYPE_PREDICATE`; T008 also added `countAnnotationsForTransfer` (used by the `count` channel); `identifyBook` takes the library as a parameter (`IdentifyLibrary`) so the Main spike can feed it a real or fake store. The two existing failures in `tests/app-models/pdf-embedded-annotations.test.ts` (FreeText) come from uncommitted work outside this feature and are not caused by it.

---

## Phase 3: User Story 1 — Export a book's annotations to a file (P1) 🎯 MVP

**Goal**: From an open EPUB/PDF/TXT/Markdown book, export every annotation to `<title>.readmate-notes.json`.

**Independent test**: Annotate a book with several kinds and comments, export, open the saved file: each annotation has its type, quote, comment, colour, times and locator; cancelling the dialog writes nothing; an audiobook shows no entry.

- [ ] T011 [P] [US1] Implement `SDK/src/annotation-transfer/export-build.ts`: `buildAnnotationFile({book (with `pageCount` for a PDF when the library knows it, otherwise omitted), annotations, txtContentSha256?, appVersion, now})` -> `AnnotationFile`, carrying the stored `locator`, `selectionText`, `note` (typewriter text untrimmed), `tags`, `colorHex`, `pdfAnnotation`/`txtAnnotation`/`mdAnnotation`, `createdAt`, `modifiedAt`, `origin`/`nm`; ordered by locator; throws/returns `empty` for zero annotations (FR-001 "no empty file").
- [ ] T012 [P] [US1] Test `SDK/tests/annotation-transfer/export-build.test.ts`: one fixture per format (EPUB cfi, PDF page-rect + rects, TXT offsets, Markdown anchor, PDF shape `#RRGGBBAA`, typewriter text with leading spaces preserved); output re-parses with `parseAnnotationFile`; empty input refused.
- [ ] T013 [US1] Implement `DESK/electron/annotation-transfer/export-service.ts` (`exportRestore(bookId, event)`): load the book via `getLibraryStore().findById`, refuse audio formats and unknown ids (`not_found`), read rows (T008), map to the SDK shape (PDF origin per T007), read the PDF's `pageCount` from the library book when known, read TXT `txt_documents.content_sha256` via `getTxtStore().getDocument`, build the file (T011), show the Main save dialog (pattern of `exportAnnotatedPdf` in `overlay.ipc.ts`: `showOverwriteConfirmation`, `createDirectory`, default `<title>.readmate-notes.json` with `/\\:*?"<>|` replaced), refuse targets for which `isPathInsideUserData` is true, write with `writeFileSafely` (`DESK/electron/pdf-sync/pdf-annotation-export.ts`), return `{ok, exported}`; dialog cancel -> `cancelled`; empty -> `empty` before any dialog. Never reads the book file.
- [ ] T014 [US1] Implement `annotationTransfer:count` and `annotationTransfer:exportRestore` handlers in `DESK/electron/ipc/annotation-transfer.ipc.ts` calling T013 and the row count.
- [ ] T015 [P] [US1] Create `DESK/src/screens/Reader/logic/annotationTransferStore.ts` (zustand, per the user's prefer-zustand preference): `count`, `exporting`, `lastResult`, `refreshCount(bookId)`, `exportRestore(bookId)`; toast text with the count (FR-019) in the style of `markupToast.ts`.
- [ ] T016 [US1] Add "Export annotations (backup)…" to the Reader More menu (find the item that triggers `exportAnnotatedPdf` under `DESK/src/screens/Reader/components/` and add beside it, shown for epub/pdf/txt/md only, disabled with a tooltip when `count` is 0), wired to the store.
- [ ] T017 [P] [US1] Add the same entry to the Library book context menu in `DESK/src/screens/Library/components/` (same rule, calls the bridge with the book id).
- [ ] T018 [US1] Write the export half of `DESK/spikes/annotations/run-annotations-main.mjs`: real SQLite on the migrated schema, seeded rows for the four formats, export to a temp path with the dialog stubbed; assert exact JSON content, Vietnamese bytes equal, no `.tmp` left on a failing target (read-only folder), cancelled dialog writes nothing, empty book -> `empty` with no dialog call, book file hash unchanged, audiobook id -> `not_found`, and **export still succeeds when the book file has been moved or deleted** (rows come from SQLite only; `resolveBookFile` is never called by export).

**Checkpoint**: Export works end to end for all four formats; `spike:annotations:main` export half passes.

---

## Phase 4: User Story 2 — Import annotations into the same book (P1) 🎯 MVP

**Goal**: Pick a `.readmate-notes.json`, see a preview, confirm, and get the annotations back without duplicates, all-or-nothing.

**Independent test**: Export, delete the annotations, import: same type, place, quote, comment, colour. Import twice: second adds 0. Damaged file: refused, nothing changes. Cancel/failure: rows identical.

- [ ] T019 [P] [US2] Implement `SDK/src/annotation-transfer/import-plan.ts`: `planImport({file, targetFormat, existingKeys, scanKeys?, isUsableId})` -> `{toAdd: [...with id decision], present, notPlaced:[{type, quote?, reason}]}`: duplicates by `contentKeyOf` (T006), PDF file-origin item with `nm` key present in `scanKeys` -> present, annotations failing re-validation with `parsePdfAnnotation` / `parseTxtAnnotation` / `parseMdAnnotation` -> `notPlaced` (never guessed), id reused only when `isUsableId` (audit H1), existing rows never changed (FR-009).
- [ ] T020 [P] [US2] Test `SDK/tests/annotation-transfer/import-plan.test.ts`: all new; all present (second import adds 0, SC-003); mixed; invalid pdfAnnotation -> notPlaced; same content with different ids -> present; id exists elsewhere -> fresh id; PDF `nm` in scan -> present.
- [ ] T021 [US2] Implement `DESK/electron/annotation-transfer/import-service.ts` part 1 (preview): `pickFile(event, {bookId?})` opens a Main open dialog (pattern of `zip-import.ipc.ts` l.104) with two filters, "Annotation files" (`*.readmate-notes.json`) first and "All files", so a `.md` can be chosen. Main validates the CONTENT too, never only the picker: reads the file and `parseAnnotationFile`s it (`damaged` / `newer_version`); a file without the annotation-file shape, or one named `.md`, answers `not_annotation_file` with the hint "a readable copy cannot be imported" (consistent with T036). Then, in this order: (1) identify the file's book with `identifyBook` (T030) and compare it with `bookId` when one was given: if they differ, or the file's book is missing, the preview carries `requiresChoice` and `startedFrom` (U1, spec FR-010; same logic as the Library flow, T031); (2) refuse a format mismatch (`format_mismatch`); (3) `resolveBookFile` (`DESK/electron/files/sandbox.ts`) on the target book: `missing_file` / `path_denied` -> `file_unavailable` with a relink hint, no session, nothing written (spec edge case; export never does this); (4) build existing content keys from the target's rows, run the pdf.js scan worker (`DESK/electron/pdf-sync/`) for a PDF target to get `/NM` keys via `embeddedAnnotationIdentities`, run `planImport`; (5) store a Main-held session `{sessionId, bookId, plan, freshness, choiceMade}` where freshness = target `books.sha256`, TXT `content_sha256`/revision, and the sorted existing key set; return `ImportPreviewDto` (counts + not-placed list, FR-005). Sessions are dropped on `discard`, book removal and window close. Emits `progress` events (`reading`, `planning`) and yields to the event loop every 500 items.
- [ ] T022 [US2] Implement `import-service.ts` part 2 (`confirm(sessionId)`): refuse with `target_not_confirmed` while the session has `requiresChoice` and no `setTarget` was made (T031); then `BEGIN IMMEDIATE` on `getDatabase()`; inside, re-check freshness (book exists and `sha256` equal; TXT content hash/revision equal; existing key set equal) else `ROLLBACK` + `stale_preview`; for each `toAdd` call `SqliteOverlayStore.writeHighlight` (TXT rows: only after the inline `getTxtStore().currentRevision` check, never `commit`, never a new revision); `COMMIT`; any throw -> `ROLLBACK` + `write_failed`; emit `committing`; return counts `{added, present, notPlaced}`. Cancel before `BEGIN` drops the session and writes nothing. Does not touch `pdf_embedded_annotations` or the book file (research R5; spec FR-012). The result is `ok:true` only after `COMMIT`; every other outcome returns an error code, which is what T044 keys on.
- [ ] T047 [US2] Implement the target choice in `import-service.ts` (U1, FR-010; extracted from the old T031 so the MVP import is complete): `setTarget(sessionId, bookId)` is the user's explicit choice (the proposed book or the one the import started from): it re-checks format and `resolveBookFile`, re-plans against that book, sets `choiceMade`, clears `requiresChoice` and sets `matchedBy: 'chosen'`; `confirm` returns `target_not_confirmed` while `requiresChoice` is set (T022 calls this check). `pickFile` without `bookId` (Library) uses the same identification (T021 + T030), so the Reader and Library flows behave identically: `book_missing` names title and author via `fileBookMissing`. Depends on T021, T030.
- [ ] T023 [US2] Implement `pickFile`, `confirm`, `discard`, `cancel` handlers in `annotation-transfer.ipc.ts`.
- [ ] T024 [P] [US2] Extend `annotationTransferStore.ts`: `preview`, `importing`, `progress`, `pickFile(bookId?)`, `confirm()`, `discard()`, `cancel()`; on `stale_preview` re-run the preview; result toast with added / skipped as present / not placed counts (FR-019); import runs as a non-blocking job like `zipImportStore` (reading and navigating stay possible, FR-016). Reader refresh after success is T044.
- [ ] T025 [US2] Create `DESK/src/components/annotation-transfer/ImportPreviewDialog.tsx`: target title, counts (to add, already present, cannot be placed), the not-placed list (kind, quote, reason; capped height, scroll), Import / Cancel; uses the existing dialog styling of `AudiobookZipImportDialog.tsx`; plain-language errors for each error code.
- [ ] T026 [US2] Add "Import annotations…" to the Reader More menu and the Library book context menu (next to the T016/T017 entries) opening the dialog for that book.
- [ ] T046 [US2] Choice step shared by both flows (U1, FR-010): in `ImportPreviewDialog.tsx` and `annotationTransferStore.ts`, when `requiresChoice` is true show "This file is from <fileBook title/author>; you started from <startedFrom title>", the proposed book (or "not in your library" with title and author when `fileBookMissing`), and two explicit actions: "Import into <proposed book>" and "Import into <startedFrom> anyway (different book)" (the latter only when formats match); each calls `setTarget` and shows the refreshed preview; the Import button stays disabled until a `setTarget` result arrives. Depends on T025, T047; it does not need the Library UI (T032), which reuses this component.
- [ ] T027 [US2] Extend `run-annotations-main.mjs` with the import half: round trip per format (export, wipe, import = 100% same type/locator/quote/comment/colour, SC-002); second import adds 0; injected throw mid-transaction -> rows identical (SC-005); book hash changed or a row added between preview and confirm -> `stale_preview`, nothing written; a source id existing in another book is not overwritten; created time restored, modified = import time; a locked/encrypted PDF still stores rows; PDF with an already embedded annotation (`/NM` Foxit-style and `readmate:<id>`) -> no duplicate row and no duplicate in `planTwoWaySync` output; non-JSON / truncated / `fileVersion: 2` / wrong-format files refused with no change; **a target whose book file was moved or deleted -> `file_unavailable`, zero rows written (and a relinked book imports normally)**; **`confirm` on a session with `requiresChoice` and no `setTarget` -> `target_not_confirmed`, zero rows written**; book file hash unchanged (PDF: sync stubbed out, SC-006).
- [ ] T028 [US2] Write `DESK/spikes/annotations/run-annotations-store.mjs`: the real renderer `annotationTransferStore` against the real Main service: preview -> confirm -> result counts, `stale_preview` re-preview, cancel before commit, errors surfaced.
- [ ] T044 [US2] Reload the open Reader after a successful import (spec US2 scenario 3, FR-007; G1). In `annotationTransferStore.ts`, when `confirm` returns `ok:true` and the imported-into book is the one currently open, call the existing reload of that format's store (verified to exist): EPUB `DESK/src/screens/Reader/logic/highlights/highlightsStore.ts` `loadHighlights`, PDF `pdfHighlights/pdfHighlightsStore.ts` `loadHighlights`, Markdown `mdHighlights/mdHighlightsStore.ts` `loadHighlights`; TXT `txtDocument/txtDocumentStore.ts` `load(bookId)` (reloads text, annotation marks and revision state) — but first wait for or flush the TXT save loop so unsaved edits are neither lost nor overwritten (if the flush fails, skip the reload and tell the user the annotations were imported and will show after the book is reopened). Reload only on `ok:true`; never on `stale_preview`, `write_failed`, `target_not_confirmed`, `file_unavailable`, cancel or any other error code (rollback = no reload). Importing into a book that is not open triggers no reload. Renderer only, no IPC change.
- [ ] T045 [US2] Add the reload cases to `DESK/spikes/annotations/run-annotations-store.mjs`: a successful import into the open book calls the reload exactly once (EPUB, PDF, Markdown via `loadHighlights`; TXT via `load`, with marks + revision state refreshed); `write_failed` (injected rollback), `stale_preview`, `file_unavailable`, `target_not_confirmed` and cancel call it zero times; import into a non-open book calls it zero times; the open book's visible annotation list equals the database after a successful import; **TXT with an unsaved edit pending: the save loop is flushed first and the edit survives the reload; if the flush fails, no reload happens and the user is told.**

**Checkpoint**: Backup and restore round trip passes for all four formats, the open Reader refreshes after a successful import and only then; both spikes green.

---

## Phase 5: User Story 3 — Import into the right book (P2)

**Goal**: The Library flow and the placement rules for a different edition (the target choice itself is in US2): TXT annotations re-anchored by quote, PDF placed only for the same document with known equal page counts, Markdown and EPUB only on identical content, everything else reported as not placed.

**Independent test**: Export from book A; import from the Library file action -> A is proposed; choose book B -> warning and only confident matches; missing book -> named in the message; different format -> refused.

- [ ] T029 [P] [US3] Implement `SDK/src/annotation-transfer/quote-match.ts`: `anchorByQuote(text, quote, contextBefore?, contextAfter?)` -> `{start,end}|null`, exact match required, unique (or disambiguated by before/after context) else `null`; operates on the canonical TXT text only (Markdown is not re-anchored). Test `SDK/tests/annotation-transfer/quote-match.test.ts`: unique, ambiguous without context, ambiguous resolved by context, absent, Vietnamese with combining marks, never returns a position whose text differs from the quote (SC-008).
- [ ] T031 [US3] Extend `import-service.ts` with the placement rules for a target whose `sha256` differs (spec FR-011; no new re-anchoring mechanism; `identifyBook`, `setTarget` and `requiresChoice` are T030, T047, T021): TXT annotations are re-anchored with `anchorByQuote` (quote + before/after context), using `txt_documents.content_sha256` against the header's `txt.contentSha256` to decide whether the stored offsets can be used exactly, and rebuilding the row's `txtAnnotation` offsets and locator from the match (TXT canonical text from `DESK/electron/txt/`); Markdown annotations are placed only when `sha256` is identical, otherwise `not placed` (reason "different edition"; the piece index exists only in the renderer, research R4); EPUB annotations likewise (identical `sha256` only); PDF annotations from a different file are placed only when title + author match, the header's `pageCount` and the target's library page count are both known and equal, the stored `locator.page` is within that count (checked explicitly) and the payload passes `parsePdfAnnotation` (labelled "placed by page position" in the preview; the quote is not verified); if either page count is unknown they are `not placed`.
- [ ] T032 [US3] Add the Library-level "Import annotations file…" action in `DESK/src/screens/Library/` (calls `pickFile` with no book and renders the shared dialog from T046, including its "Choose another book…" path through `setTarget`; the `matchedBy` rule is shown, research R4).
- [ ] T033 [US3] Extend `run-annotations-main.mjs`: identity by sha256, by title when only the title matches, missing book message, cross-format refusal, import started from book B with a file of book A -> `requiresChoice`, A proposed, nothing written until `setTarget`, then both choices work (T047); different-edition TXT (some re-anchored, rest listed, none at a position whose text differs from its quote, exact offsets used when `contentSha256` equals); different-edition Markdown and EPUB -> all `not placed`, identical `sha256` -> placed; different-edition PDF: equal known page counts and matching title/author -> placed by page position; **page number beyond the target's page count -> not placed**; **page count missing in the file header or in the target -> not placed**; PDF whose hash changed after write-back but same title/author/page count still imports.

**Checkpoint**: Wrong-book imports are impossible without a deliberate choice, in both the Reader and Library flows; SC-008 verified for TXT.

---

## Phase 6: User Story 4 — Export a readable copy (P3)

**Goal**: A Markdown document of quotes and comments in reading order, not importable.

**Independent test**: Export the readable copy of an annotated book and open it in any text viewer: headings per chapter/page/section, quotes, kind, colour, comment, time; Vietnamese intact; picking it in Import says it cannot be imported.

- [ ] T034 [P] [US4] Implement `SDK/src/annotation-transfer/readable-markdown.ts`: `renderReadableMarkdown(file, {headingOf})` following `SPEC/contracts/readable-markdown.md` (title header, one heading per chapter title / `Page N` / `Section k`, quote as `>`, strikethrough `~~…~~`, shapes `[Rectangle on page 3]`, typewriter text, kind, colour tag, local time, `Note:` line omitted when empty), ordered by locator. Test `SDK/tests/annotation-transfer/readable-markdown.test.ts`: order, headings, Vietnamese text byte-equal, empty comment omitted.
- [ ] T035 [US4] Add `exportReadable` to `export-service.ts` (same save-dialog / `writeFileSafely` flow, default `<title>.md`; EPUB headings are `Chapter N` from `locator.chapterIndex` unless T048 finds a byte-level TOC parser to reuse, research R9) and its handler; add "Export readable copy…" to the Reader More menu and the Library book menu; add it to the store.
- [ ] T048 [US4] Small lookup before the EPUB readable-copy headings are finalised (research R9, M4): search `SDK/src/epub/` and `DESK/electron/adapters/epub.adapter.ts` for an existing function that returns chapter titles from EPUB bytes without a DOM or epubjs. If one exists, T035 uses it for `headingOf`; if none exists, keep `Chapter N`; do NOT write a new TOC parser in this feature. Record the result in `SPEC/research.md` R9. Depends on T034.
- [ ] T036 [US4] In `pickFile` (T021 already offers "All files"), a `.md` or any file lacking the annotation-file shape answers `not_annotation_file` with the hint that the readable copy cannot be imported (FR-014, FR-013, research R8); show that message in `ImportPreviewDialog.tsx`. Add a spike case: the readable `.md` written by T035 is picked through the "All files" filter and refused with that hint, nothing written.
- [ ] T037 [US4] Extend `run-annotations-main.mjs`: readable copy of the four formats, `.md` refused by Import, empty book -> no file.

**Checkpoint**: All four stories work independently.

---

## Phase 7: Polish & cross-cutting

- [ ] T038 [P] Add a "Annotation import / export" paragraph to `CLAUDE.md` (file name, the one-transaction rule and why `SqliteTxtStore.commit` is not used, `stale_preview`, PDF write-back happens afterwards through the two-way sync, spike names) and list the two spikes in its Commands block.
- [ ] T039 [P] Fix the stale Markdown row of `docs/implementation_plan/annotation_support_matrix.md` (Markdown has `mdAnnotations.ts`, `mdHighlightsStore`, `useReaderMdHighlights`) — documentation only (audit L1).
- [ ] T040 [P] Add `docs/implementation_plan/annotation_import_export.md` summarising the feature and pointing to this spec folder.
- [ ] T041 Performance check, repeatable, in `run-annotations-main.mjs` (re-launched with the app's Electron binary in `ELECTRON_RUN_AS_NODE` mode like `spike:audio:migration`, because better-sqlite3 is built for that ABI): fixed synthetic fixtures of 1,000 and 5,000 annotations (generated from a fixed seed, mixed formats of one book each). Measure with `performance.now()`, median of 5 runs, on the same machine, and print the numbers: (a) export of 1,000 < 30 s end to end (SC-001); (b) import of 5,000, preview + confirm, < 60 s (SC-004); (c) the confirm transaction alone < 1,000 ms; (d) main-thread stall during import planning: `perf_hooks.monitorEventLoopDelay` p99 < 100 ms and max < 1,000 ms, with progress events still delivered. Fail the spike when a threshold is exceeded; record the measured numbers and the machine in `SPEC/quickstart.md`. Thresholds are the spec's (SC-001, SC-004) plus the (c)/(d) stall limits stated in SC-004.
- [ ] T042 Run the full set: SDK `npm run verify`, desktop `npm run typecheck`, `npm run lint`, `npx vite build`, `npm run spike:annotations:main`, `npm run spike:annotations:store`; fix regressions. Do NOT run E2E.
- [ ] T043 Manual pass of `SPEC/quickstart.md` step 5 by the user (SC-009); the agent stops here and reports.

---

## Dependencies & execution order

- Phase 1 -> Phase 2 -> user stories. In Phase 2: T004–T007, T009 parallel; T008 needs nothing else; T010 needs T003 and T009; T030 (`identify-book.ts`, uses only the library store) can start any time after T001.
- US1 (T011–T018) needs Phase 2.
- US2 (T019–T028, T044–T047) needs Phase 2 (including T030) and a working export for its spike (T013). Inside US2: T021 -> T022 and T047 (T022 calls the `requiresChoice` check implemented in T047) -> T023 -> T024 -> T025 -> T026 -> T046 (needs T025, T047) -> T044 (needs T022, T024) -> T045 (needs T028, T044). The shared choice step (T030, T047, T046) is part of the MVP, so the Reader-menu import is complete without US3.
- US3 (T029, T031–T033) needs US2: T029 [P]; T031 (placement for a different edition) needs T021, T029; T032 (Library action) needs T046 and T047; T033 needs T031 and T032.
- US4 (T034–T037, T048) needs Phase 2 and T013's dialog flow; independent of US2/US3. T048 needs T034; T035 needs T034 and T048; T036 needs T021.
- Within a story: SDK logic + tests -> Main service -> IPC handler -> store -> UI -> spike.
- UI tasks T016/T017/T026/T032 touch different files from each other but share the menu code: do T016 before T026.

## Parallel examples

- Phase 2: T004, T005, T006, T007, T009 together.
- US1: T011 + T012 (SDK) while T015 + T017 (UI) wait for T014.
- US2: T019 + T020 (SDK) while T024 (store) is drafted; T025 after T024.
- US3 + US4 can proceed in parallel after US2 (different files).

## Implementation strategy

1. MVP = Phases 1–4 (US1 + US2, including T030, T046, T047 and the Reader reload T044/T045): backup and restore for all four formats, from the Reader menu, with a deliberate target choice when the file belongs to another book.
2. Add US3 (identity and quote re-anchoring), then US4 (readable copy).
3. Polish, then the user's manual pass (T043). Commit and push after each task.
