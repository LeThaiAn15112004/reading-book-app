# Research: Annotation Import / Export (audited against code, 2026-10-28)

## R1 — What is exported
- Decision: annotation rows of `notes` (`group` null or `'annotation'`, `type` in the list in `ANNOTATION_TYPE_PREDICATE`, `sqlite-overlay-store.ts` ~l.216: highlight … arrow, typewriter). Typewriter notes are `notes` rows too (`HIGHLIGHT_STYLE_KINDS`); the `typewriter_notes` table of migration 010 is not referenced by any store code (legacy, ignored).
- Bookmarks (`group='bookmark'`) and freehand Ink (`pdfInk`, `listInk`) are not exported (spec: bookmarks out; Ink is not in the spec's kinds). Not verified whether the Notes list shows Ink — if it does, FR-025 would need Ink added (a spec decision, not made here).

## R2 — Can one transaction cover everything? (Q1)
- Yes, for the data that matters: every store shares one better-sqlite3 connection (`persistence/db.ts` `getDatabase()`), and `notes`, `txt_documents`, `pdf_embedded_annotations` are tables of it. Precedents: `SqliteTxtStore.commit` (`BEGIN IMMEDIATE` … `COMMIT`, calls the public `overlays.writeHighlight`/`deleteHighlightRow` inside) and the embedded-annotation sync.
- Limits found:
  1. `SqliteTxtStore.commit` opens its own `BEGIN IMMEDIATE`; it cannot be called inside another transaction. The import service must run its own `BEGIN IMMEDIATE`, call `overlays.writeHighlight(...)` per row (public, synchronous) and, for TXT, check `currentRevision(bookId)`/content hash inline; it does not create a text revision.
  2. better-sqlite3 is synchronous: the commit phase blocks Main for its duration and cannot be cancelled mid-way; cancel only works before `BEGIN`. Parsing, validation and planning run before it, in async chunks with yields and progress events.
  3. `writeHighlight` always stamps `modified` = now (no `modifiedAt` input; `createdAt` is accepted). Imported rows keep their created time only.
  4. `writeHighlight`'s `ON CONFLICT(id)` updates `note_json` of ANY book's row with that id. Reusing a source id is only safe after checking that no row with that id exists (see data-model "Identity").
  5. PDF: the DB write is atomic, but the later write of those rows into the PDF file is the always-on two-way sync (separate, asynchronous, gated by `pdf-write-eligibility`); it is not part of the import transaction.

## R3 — Do the stored locators round-trip? (Q2)
Yes, by carrying the stored fields verbatim (see data-model): EPUB `{kind:'cfi', cfi}` + `locatorExtended.text`; PDF `{kind:'page-rect', page}` + `pdfAnnotation` (0-based `pageIndex`, rects normalized 0–1 to the displayed page box); TXT `{kind:'text-offset', offset, blockId:'txt'}` + `txtAnnotation{startOffset,endOffset}`; Markdown `{kind:'text-offset', blockId:'md'}` + `mdAnnotation` (segment + offset). The earlier draft's `place` union and `raw` field were invented and are removed.
- Limit: EPUB CFI is valid only for the same EPUB content; TXT offsets only for the same canonical text; Markdown segment indices only for the same rendering segmentation (`mdQuoteMatches` guards against drift).
- R3b (unverified): `origin` for PDF rows. The ledger (`pdf_embedded_annotations`) records both annotations imported from the file AND Readmate's own rows linked after write-back, and stores only the hashed key (`nm1:<page>:<hash53(nm)>#n`). Origin `app` can be derived as "ledger key equals the key computed for `readmate:<id>`" (`noteIdFromReadmateName`, `pdf-annotation-export.ts`); `hash53` is not exported today, so a small SDK helper is needed. To be proven by a unit test; otherwise fall back to tagging every PDF row `app` with its `nm` when known.

## R4 — Book identity and moving to another machine (Q3)
- `books.sha256` is a SHA-256 of the file (`hashFile`, `relinkBook` re-checks it), so it is the same on any machine for the same bytes. Stable for EPUB/TXT/Markdown (never written).
- NOT stable for PDF: two-way sync appends incremental updates and updates `books.sha256` (`recordFileVersion`, `pdf-annotation-sync-service.ts`). Export from a PDF after annotation and a pristine copy elsewhere never match by hash. Decision: match order = sha256, then title + author + format (the preview states which rule matched); PDF placement is checked by page count and normalized rects, which do not depend on the hash.
- TXT: the user's file hash is stable, but offsets refer to the edited copy (`txt_documents.content_sha256`; revision numbers are local). The header carries `txt.contentSha256`; the target uses exact offsets only if its current content hash is equal, else the quote path.
- Dedup never uses SQLite ids (see data-model "Identity").

- **Placement rule on a different edition (spec FR-011, no new re-anchoring):** same `sha256` -> stored locator. Different: TXT -> quote + context match (`anchorByQuote`); Markdown -> not placed (the piece index `data-md-seg` is produced only by the renderer, `MdRenderer.tsx` with `remark-gfm`; verified: no segmentation exists in Main or the SDK); EPUB -> not placed (CFI validity cannot be checked in Main; whether it could be is unverified, nothing depends on it); PDF -> placed only if title + author match, the export header's `pageCount` and the target's `books` page count are BOTH known and equal, the stored page number is within that count and the payload passes `parsePdfAnnotation` (whether that parser also checks the page against a page count is unverified, so the page-within-count check is done explicitly); the quote is NOT checked against page text (whether Main can read page text for that check is unverified), so the preview labels these "placed by page position". Everything else -> not placed.
- **Which book is the target (spec FR-010):** `identifyBook` runs in every flow. If the file's book (by sha256, else title + author + format) is not the book the import started from, or is missing, the preview carries `requiresChoice`; Main refuses `confirm` (`target_not_confirmed`) until `setTarget` is called by the user's explicit choice. Same behaviour from the Reader menu and the Library.
- **Book file availability (spec edge case):** import calls `resolveBookFile` (`DESK/electron/files/sandbox.ts`) on the target before planning; a PDF target also needs it for the scan. `missing_file` / `path_denied` -> `file_unavailable`, nothing written. Export never calls it.

- **EPUB chapter titles for the readable copy (R9):** Main has no EPUB table-of-contents reader (verified by search: `electron/` has none, `epub.adapter.ts` only knows spine indexes). Decision: the readable copy uses `Chapter N` headings from `locator.chapterIndex` unless task T048 finds an existing byte-level TOC parser in the SDK `src/epub/`; no new parser is written in this feature.

## R5 — PDF annotations from other readers (Q4)
- They are ordinary `notes` rows, created by `planEmbeddedAnnotationSync` / the two-way plan from a pdf.js scan and tracked in `pdf_embedded_annotations` (migrations 023/024; `note_id`, `source_key`, `base_json`, `conflict_json`). They exist in SQLite, so export is complete from SQLite alone and the PDF is not read or written.
- Blocker for import (see audit B1): a row inserted without a ledger entry is seen by `planTwoWaySync` as (a) a "row the file doesn't hold" -> `file.add`, and (b) the same annotation, if the target PDF already contains it, as an unknown scan item -> `inserts` = a second row. Result: duplicates in SQLite and in the file.
- Decision: for PDF, preview runs the existing scan (`electron/pdf-sync` worker) on the target; a file-origin annotation whose `/NM` key is in the scan is "present" and not inserted; one whose `/NM` is `readmate:<id>` with a reused id is picked up by `plan.links` (no duplicate). Annotations not in the target file are inserted as ordinary rows and are written into the file by the existing sync like any app-made annotation. Import does not touch the ledger.

## R6 — Preview/confirm consistency (Q5)
- Decision: Main keeps the session (like `picked-zip` / `zipImport:confirm`, which re-validates at confirm). `confirm` opens `BEGIN IMMEDIATE`, then re-checks inside the transaction: book row still exists and `sha256` equals the preview's; TXT content hash/revision equal; the set of existing content keys for the book still equals the preview's. Any difference -> ROLLBACK, `stale_preview`, the renderer shows a new preview. Within the transaction nothing else can write (single writer, `IMMEDIATE`).
- After a successful commit (never after rollback, `stale_preview` or `write_failed`) the renderer reloads the open book's annotations (tasks T044/T045). Whether each store exposes a reload entry point is NOT verified; the task finds it per store.
- Sessions are dropped on discard, on book removal and when the window closes.

## R7 — Export write, cancel, errors, progress (Q6)
- Export: build in memory, then `writeFileSafely` (`pdf-annotation-export.ts` l.69: temp file `wx` + `fsync` + `rename`, temp removed on error) so no partial file is left; save dialog in Main with `showOverwriteConfirmation`; target inside userData refused (`isPathInsideUserData`). Cancelling the dialog returns `cancelled` and writes nothing. An empty book never opens a dialog. Export of a few thousand rows is a short synchronous read; progress is only needed for the import planning phase.
- Import: phases `reading` -> `planning` (yields every N items, progress events `annotationTransfer:progress`) -> `committing` (single synchronous transaction; not cancellable). A cancel before commit leaves nothing; an error in the transaction rolls back (`write_failed`).

## R8 — Restore JSON vs readable Markdown (Q7)
- Decision: distinguished by extension and content. `pickFile` filters `*.readmate-notes.json`; a picked `.md` or any file without `fileVersion`/`book`/`annotations` answers `not_annotation_file`, and for `.md` the message says the readable copy is not importable (spec Story 4 scenario 3). Schema, `ipc.md` and `readable-markdown.md` use the same two names; Reader/Library menu labels: "Export annotations (backup)…" and "Export readable copy…".

## R9 — Readable copy
- Pure function over the same file object; grouped by chapter title (EPUB: "Chapter N" from `chapterIndex`; a TOC lookup only if task T048 finds an existing parser), page (PDF), section by position (TXT, Markdown); order by locator; strikethrough quotes `~~…~~`.

## R10 — Spec / document conflicts found
- C1 (resolved): FR-012 and SC-006 say the book file is never modified by export or import; FR-007, the PDF edge case and Assumptions say imported PDF annotations follow the existing always-on write-back, which appends an incremental update to the user's PDF. Both cannot be true for PDFs. Plan assumes: the import itself never writes the file; a later two-way sync may (existing behavior). DECIDED (user, option A): spec FR-012 / SC-006 reworded to match; no hold-back mechanism is built.
- C2: `docs/implementation_plan/annotation_support_matrix.md` says Markdown has buttons only; code has `mdAnnotations.ts`, `mdHighlightsStore` and `useReaderMdHighlights`. Stale doc, not part of this feature.
- C3: spec edge case "A PDF whose annotations are also embedded in the file" is not solvable by the content key alone (see R5); resolved above.
- C4: the SDK `persistence/sql-notes.ts` JSON layout differs from Main's (CLAUDE.md) — export/import must be built on Main's `note_json`, not on that module.
