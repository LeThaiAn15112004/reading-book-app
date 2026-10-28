# Quickstart: validate annotation import/export

Prerequisite: `cd source && npm install`.

1. **SDK**: `cd source/apps/book-reader-sdk && npx vitest run tests/annotation-transfer` — schema accept/reject (newer version, damaged, wrong format), build, import plan (add / present / not placed), quote matching (unique / ambiguous / absent), readable Markdown with Vietnamese text. Then `npm run verify`.
2. **Desktop static checks**: `cd source/apps/reading-book-desktop && npm run typecheck && npm run lint && npx vite build`.
3. **Main spike** (also needs `npm run build` of the SDK, as the other spikes do): `npm run spike:annotations:main` — real SQLite on the migrated schema, temp files: export, wipe, import restores 100%; a second import adds 0; cancel or failure leaves rows identical; the book file hash is unchanged after import (PDF: checked before the two-way sync runs, with the sync stubbed out); a locked PDF still stores rows; a row id that already exists in another book is never overwritten; injected failure mid-transaction -> rows identical (rollback); book changed between preview and confirm -> `stale_preview`, nothing written; a PDF that already contains the annotations (Foxit-style `/NM` and `readmate:<id>`) gets no duplicate row and no duplicate in the sync plan; export with a read-only folder -> no temp file left; Vietnamese text byte-equal; truncated / non-JSON / `fileVersion: 2` / wrong-format files are refused with no change; a target whose book file was moved or deleted -> `file_unavailable` with a relink hint and zero rows written, while export of the same book still works; a file from book A started from book B's menu -> `requiresChoice`, `confirm` before `setTarget` -> `target_not_confirmed`, nothing written; the picker offers "Annotation files" and "All files" and a chosen readable `.md` is refused by Main with the "cannot be imported" hint; different-edition rules: TXT by quote, Markdown / EPUB only on identical content, PDF only with known equal page counts and the page inside the target's page count.
4. **Store spike**: `npm run spike:annotations:store` — the renderer store against the real Main service (preview, job, result); the open book's store reloads exactly once after a successful import (`loadHighlights` for EPUB/PDF/Markdown, `load` for TXT with an unsaved edit flushed first) and never after rollback, `stale_preview`, `file_unavailable`, `target_not_confirmed` or cancel.
5. **Manual** (SC-009): annotate an EPUB, PDF, TXT and Markdown book; More -> Export annotations; delete the annotations; More -> Import annotations; compare. Then try the `.md` copy in Import (expect "not importable"), an audiobook (no menu items), and a different-edition TXT (the preview lists the annotations not placed).

6. **Performance** (task T041): `npm run spike:annotations:perf` — the real better-sqlite3 on a temp file in WAL mode, run inside the app's Electron binary (`ELECTRON_RUN_AS_NODE`), one synthetic book per format from a fixed seed, median of 5 runs, fails when a figure is over its limit (export of 1,000 < 30 s, import of 5,000 < 60 s, the confirm transaction < 1 s, planning stall p99 < 100 ms and max < 1 s).

   Measured on 2026-10-28: 13th Gen Intel Core i7-13620H, 16 threads, 16 GB, Electron 39.8.10 (Node 22.22.1), Windows 11. Median of 5 runs, milliseconds:

   | format | export 1,000 | import 5,000 (preview + confirm) | confirm transaction | planning | planning stall (p99 = max) |
   |---|---|---|---|---|---|
   | EPUB | 14 | 267 | 182 | 51 | 15.6 |
   | PDF | 18 | 301 | 208 | 58 | 16.2 |
   | TXT | 14 | 270 | 185 | 54 | 16.5 |
   | Markdown | 15 | 288 | 196 | 55 | 15.4 |

   The confirm transaction is one synchronous block, so its length (about 0.2 s for 5,000 annotations) is the longest the main process is held by an import: well under the 1 s of SC-004. A first run proved the point of the limit: re-reading and re-keying every existing row inside the transaction took 0.99 s for PDF; the freshness proof now compares a cheap stamp of the rows' ids and last-change times (`SqliteOverlayStore.annotationStamp`) instead. Other machines will differ; the limits, not these figures, are the check.

E2E is not run unless asked.
