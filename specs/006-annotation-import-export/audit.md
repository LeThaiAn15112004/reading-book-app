# Audit of the implementation plan (2026-10-28)

Method: read spec/plan/research/contracts + CLAUDE.md; checked `sqlite-overlay-store.ts`, `sqlite-txt-store.ts`, `db.ts`,
`pdf-annotation-two-way.ts`, `pdf-embedded-annotations.ts`, `pdf-annotation-export.ts` (`writeFileSafely`), `overlay.ipc.ts`,
`api-types.ts`, SDK `index.ts`, domain location/note types. Nothing run; source untouched.

## Blocker
- **B1 PDF duplicates.** `planTwoWaySync` (`pdf-annotation-two-way.ts`, "Unknown items" and "Rows made in Readmate" blocks): an imported row with no ledger entry becomes `file.add` (duplicate in the file) and, if the target PDF already holds the annotation, its scan item becomes `inserts` (duplicate row). Fix in research R5 (scan at preview, treat NM matches as present, reuse ids so `readmate:<id>` links).
- **B2 Spec conflict FR-012/SC-006 vs FR-007.** Import into a PDF triggers the always-on write-back, which appends to the user's PDF. Resolved: option A chosen by the user; spec FR-012 / SC-006 reworded.

## High
- **H1** `writeHighlight` upserts by id across books (`ON CONFLICT(id)`): reusing a source id can corrupt another book's row. Fix: reuse only ids absent from `notes`.
- **H2** `SqliteTxtStore.commit` cannot nest in another transaction; the draft's "use the TXT commit path" was wrong. Fix: own `BEGIN IMMEDIATE` + `writeHighlight` + inline revision check (R2).
- **H3** Invented `place`/`raw` fields in the draft file format; real fields are `locator` (`kind`), `selectionText`, `pdfAnnotation`/`txtAnnotation`/`mdAnnotation`. Fixed in data-model, schema, samples.
- **H4** Preview/confirm race had no protection. Fixed: re-validate inside the transaction (R6).

## Medium
- **M1** PDF `books.sha256` changes after write-back, so fingerprint match is unreliable for PDFs (R4).
- **M2** TXT revision numbers are device-local; header now carries `contentSha256` instead (R4).
- **M3** `writeHighlight` cannot restore `modified` time; only created time round-trips (R2.3, data-model).
- **M4** Commit phase is synchronous and not cancellable; progress/cancel only for planning (R7).
- **M5** `origin` (app vs file) cannot be read directly from the ledger (hashed key); derivation needs an SDK helper and a test (R3b) — unverified.

## Low
- **L1** `annotation_support_matrix.md` stale about Markdown (R10 C2).
- **L2** SDK `persistence/sql-notes.ts` layout differs from Main (C4) — do not reuse.
- **L3** Ink inclusion not verified (R1).

## Answers to the eight questions
1 Atomic: yes for SQLite (one shared connection, one transaction); not for the later PDF file write (R2). 2 Locators round-trip when carried verbatim (R3). 3 sha256 stable except PDF; dedup by content key, not ids (R4, data-model). 4 Stored as `notes` rows + ledger; export needs no PDF access (R5). 5 Re-validation inside the transaction (R6). 6 Temp+fsync+rename, cancel before commit, phases (R7). 7 Consistent: extension + content check, separate labels (R8). 8 Quickstart step 3 now lists rollback, dedup, Unicode, damaged / wrong-version files, hash-unchanged check.


## Final pass (2026-10-28)
H1 (MVP dependencies: T030 to Phase 2, new T047, T046 into US2), H2 (Markdown not re-anchored), H3 (`pageCount` in the export header) and M1–M6 applied to spec, research, data-model, schema, plan, tasks and quickstart. New tasks: T047, T048. See the report in the session.
