# PDF embedded annotation import

Date: 2026-10-15.

When a PDF opens, the Reader reads the annotations embedded **in the file** (written by Foxit,
Acrobat or another viewer) and syncs them into the app's SQLite `notes` table. From then on they
are ordinary app annotations: painted, listed in the sidebar, editable, deletable. The scan runs on
**every** open, never just the first, because the file may have gained, changed or lost annotations
in another viewer since the last open.

This is a read-only import. The PDF file is never written, re-exported or modified.

Out of scope: writing annotations into the PDF, exporting a PDF, two-way sync, and annotations that
exist only in another app's own database (for example Thorium's SQLite). Those are not in the
file, so no scan can see them.

## 1. Decisions

1. **The scan runs in the renderer, on the `PDFDocumentProxy` already loaded for rendering.** The
   file is not read or parsed a second time. The scan uses the same scale-1 viewport the app's own
   PDF annotations are normalized against (`pdf_text_annotations.md` §3), so geometry needs no new
   coordinate system.
2. **Main re-validates and persists everything in one transaction**, through the existing
   `SqliteOverlayStore` and `notes` row format. There is no second annotation system. Imported rows
   use exactly the JSON of app-made PDF annotations.
3. **A ledger table** (`pdf_embedded_annotations`, migration 023) records which embedded
   annotation became which `notes` row, plus two hashes. This is the only schema change. It is
   needed because the ledger has to outlive the row: an imported row the user deleted must not come
   back on the next open, and `note_json` cannot carry state for a row that no longer exists.
4. **Identity = anchor, not object number.** See §3.
5. **Nothing is ever deleted by a scan.** An annotation removed from the file keeps its app row.
6. **The app's version wins.** A row the user edited in the app is never overwritten by a later
   change in the file. A row made in the app is never matched, merged or overwritten at all.
7. **The app paints the annotations it imported.** The file's own appearance of those annotations
   is hidden on the canvas, so a mark isn't drawn twice and an edit or deletion in the app is
   visible. This affects only the in-memory document; the file is not touched.

## 2. What PDF.js 5.4.624 actually gives (verified)

The source checked is `pdfjs-dist/build/pdf.worker.mjs`. The runtime check is
`spike:pdf:embedded`, run against real PDFs.

- `PDFPageProxy.getAnnotations({ intent: 'display' })` is a public API. It returns one plain data
  object per annotation:

  | Field | Contents |
  |---|---|
  | `subtype`, `annotationType` | the annotation type |
  | `id` | object reference (`"12R"`), or `annot_…` for an inline dictionary |
  | `rect` | box in PDF user space |
  | `quadPoints` | `Float32Array`; PDF.js reorders each quad to `[minX, maxY, maxX, maxY, minX, minY, maxX, minY]` |
  | `color` | RGB bytes, or null |
  | `contentsObj.str`, `titleObj.str` | `/Contents` and `/T` |
  | `modificationDate`, `creationDate` | dates |
  | `inReplyTo`, `replyType` | reply link to another annotation |
  | `annotationFlags` | `/F` flags |
  | `overlaidText` | the page text under Highlight / Underline / Squiggly / StrikeOut. PDF.js computes it with an `Intersector` for the display intent. |

- **`/NM` is not exposed**, and neither is any other identifier that survives a full rewrite of the
  file.
- The display intent drops Invisible and NoView annotations but **still returns Hidden ones**
  (`viewable` ignores the Hidden flag). The import therefore checks `annotationFlags & (1|2|32)`
  itself; the spike caught this.
- **Colors** are bytes produced by a `Uint8ClampedArray`, which rounds halves to even
  (0.7·255 = 178.5 becomes 178).
- **Hiding one annotation's appearance** works through
  `pdf.annotationStorage.setValue(id, { noView: true })` combined with
  `render({ annotationMode: AnnotationMode.ENABLE_STORAGE })`. In the worker, `mustBeViewed` reads
  `noView` from the storage. With an empty storage, `ENABLE_STORAGE` draws exactly like the default
  `ENABLE`.

Supported types are listed in the table below. Each was checked against real files.

| PDF subtype | Stored as | Geometry | Note text | Text under mark |
|---|---|---|---|---|
| Highlight | `highlight` | one rect per quad | `/Contents` | `overlaidText` |
| Underline | `underline` | one rect per quad | `/Contents` | `overlaidText` |
| Squiggly | `underline` (lossy: the app has no squiggly style) | one rect per quad | `/Contents` | `overlaidText` |
| StrikeOut | `strikethrough` | one rect per quad | `/Contents` | `overlaidText` |
| Text (sticky note) | `textbox` (note), anchored on its icon rect | `rect` | `/Contents` | none |

Not imported: FreeText, Ink, Square/Circle/Line/Polygon, Stamp, Caret, Link, Widget/forms,
FileAttachment, Popup, and replies (`/IRT`). The `notes` model cannot represent them; FreeText, for
example, is text drawn on the page, not a note on a passage. These keep their own appearance on the
canvas, unchanged.

## 3. Identity and sync rules

**Key** (`embeddedAnnotationKeys`): `pdf1:<subtype>:<pageIndex>:<hash of the normalized rects rounded to 0.001 of the page>#<n>`.

- `#n` counts identical anchors in document order (page, then `/Annots` order). Duplicate or
  stacked annotations therefore stay separate rows.
- **Why not the object id?** A non-incremental save in another viewer renumbers objects and can
  hand the old number to a different annotation. Using it as the key could update the wrong row.
- **Why not the color or comment?** Those are exactly what users edit in other viewers. They are in
  the change hash, not in the key.
- **Consequence:** moving or resizing an annotation in another viewer makes it a new annotation.
  The old row stays, because nothing is deleted.

**Ledger row** `(book_id, source_key) → note_id, source_hash, note_hash`:

- `source_hash` = `embeddedAnnotationSourceHash`: subtype, page, rects, color, contents, author and
  text as last written.
- `note_hash` = `highlightContentHash` of what the import last wrote to the row: style, color, note,
  tags, text and geometry.

`planEmbeddedAnnotationSync` handles each scanned item as follows:

| Situation | Action |
|---|---|
| Key not in the ledger | **insert** a new `notes` row and ledger row |
| Ledger row exists, `notes` row gone (deleted in the app) | nothing; counted as *dismissed* |
| `source_hash` unchanged | nothing (*unchanged*) |
| File changed, and the row's current hash ≠ `note_hash` (edited in the app) | nothing; counted as *keptAppEdits* (the app wins) |
| File changed, row untouched since the import | **update** the row (same id, `created_at` kept) and both hashes |
| Ledger entry not seen in this scan (removed from the file, or its key changed) | nothing; the row stays |

Every scanned item that has a ledger entry, whether just written, unchanged, kept or dismissed, is
reported as *managed*. Its canvas appearance is then hidden.

## 4. How it works

- **SDK** (`app-models/pdf-embedded-annotations.ts`, pure):
  - `readPdfJsAnnotation(raw, pageViewport)` turns one PDF.js item into a `ScannedPdfAnnotation`:
    normalized 0–1 rects through `viewport.transform`, so rotation and crop box are handled, plus
    color, contents, author and text.
  - `parseScannedPdfAnnotation` is the strict validation on the IPC boundary.
  - The rest are the key, the hashes, `highlightFromEmbeddedAnnotation` (which builds the
    `notes`-row fields: page-rect locator, `pdfAnnotation`, `selectionText`), and
    `planEmbeddedAnnotationSync`.
- **Renderer:**
  - `reader/renderers/pdf/pdfEmbeddedAnnotations.ts` provides `scanEmbeddedPdfAnnotations(pdf,
    isCancelled)`.
    - It goes page by page, calling `getAnnotations({ intent: 'display' })`, and builds the
      viewport only for pages that have annotations.
    - It yields every 25 pages.
    - A page that fails is logged and skipped. This is safe because the sync never deletes.
    - It is capped at 5000 items.
  - `PdfRenderer`:
    - A `useEffect` on `doc` runs **one scan per loaded document**. A newer document cancels it.
      It is **not** gated by any "already scanned" flag.
    - The scan starts as soon as the document is ready. Pages render in parallel and the reader is
      never blocked.
    - Empty scan results are not sent.
    - The result goes to `onEmbeddedAnnotations`. The returned managed ids get
      `annotationStorage.setValue(id, { noView: true })`, and only the rendered pages that hold one
      are re-rendered. The old canvas stays up until it is replaced.
    - All page and thumbnail renders now pass `annotationMode: ENABLE_STORAGE`.
  - `pdfHighlightsStore.syncEmbeddedAnnotations` calls the IPC.
    - It merges only the rows Main wrote (inserted or updated) into the list, by id. A full reload
      could drop an optimistic app edit still in flight.
    - Any failure logs, returns null, and leaves reading untouched.
  - `ReaderScreen` passes `pdfHighlights.syncEmbeddedAnnotations` to `PdfRenderer`.
- **IPC:** `overlay:syncPdfEmbeddedAnnotations`
  - Input is `{ bookId, annotations: ScannedPdfAnnotationDto[] }`.
  - Output is `{ ok, inserted, updated, unchanged, keptAppEdits, dismissed, invalid, managedObjectIds }`.
  - Each item is validated on its own. A bad item is counted in `invalid` and the rest still sync.
  - A non-PDF or unknown book returns `ok: false` and writes nothing.
  - The channel was added in `channels.ts`, the handler in `overlay.ipc.ts`, the types in
    `api-types.ts`, and the bridge in `preload.ts` and `src/bridge/overlay.ts`.
- **Main** (`SqliteOverlayStore.syncEmbeddedPdfAnnotations`):
  - It runs one `BEGIN IMMEDIATE … COMMIT` transaction.
  - It reads the ledger and the book's annotation rows, plans the sync, and writes rows through
    `writeHighlight`. `writeHighlight` is `saveHighlight`'s body, made synchronous so it can run
    inside the transaction; `saveHighlight` is unchanged for its callers.
  - Any error rolls back.
- **Identity of the book:** rows are keyed by `bookId`, as all overlay data is. Both referenced and
  managed files work, because the scan reads the bytes `library:openBookContent` already returned.
  A file edited in place (new SHA-256) still opens as the same book. That edit is exactly the case
  this feature exists for.

## 5. Files

SDK (`source/apps/book-reader-sdk`):
- `src/app-models/pdf-embedded-annotations.ts` (new), `src/app-models/index.ts` (exports).
- `tests/app-models/pdf-embedded-annotations.test.ts` (new, 28 tests).

Desktop (`source/apps/reading-book-desktop`):
- `electron/persistence/migrations/023_pdf_embedded_annotations.sql` (new), `electron/persistence/migrate.ts`.
- `electron/persistence/sqlite-overlay-store.ts`: `syncEmbeddedPdfAnnotations`, `writeHighlight`.
- `electron/ipc/channels.ts`, `electron/ipc/api-types.ts`, `electron/ipc/overlay.ipc.ts`, `electron/preload.ts`, `src/bridge/overlay.ts`.
- `src/reader/renderers/pdf/pdfEmbeddedAnnotations.ts` (new), `src/reader/renderers/pdf/PdfRenderer.tsx`.
- `src/screens/Reader/logic/pdfHighlights/pdfHighlightsStore.ts`, `logic/hooks/useReaderPdfHighlights.ts`, `ReaderScreen.tsx`.
- `e2e/support/build-annotated-pdf.mjs` (new; Foxit-style `/Annots`, optional object renumbering), `e2e/specs/pdf-embedded-annotations.spec.ts` (new).
- `spikes/pdf-annotations/run-pdf-embedded-annotations.mjs` (new), `package.json` (`spike:pdf:embedded`).
- `spikes/signature-status/run-signature-status.mjs`: it asserted that 022 is the *last* migration.
  It now asserts that 022 is present.

## 6. Tests

| Check | What it covers |
|---|---|
| SDK unit tests (`pdf-embedded-annotations.test.ts`, 28) | reading PDF.js items, including rotation, every subtype, skipped types / replies / hidden flags / bad geometry; IPC validation; key stability (object id renumbered, color / comment edits, float noise) and separation (subtype, page, geometry, duplicates); the content hash; the row mapping through the existing PDF mapper; and the sync plan for requirements 1–8 and 10 on an in-memory ledger model |
| `spike:pdf:embedded` (12 checks) | the real chain without Electron: PDFs with `/Annots`, pdf.js 5.4.624 (legacy build), `scanEmbeddedPdfAnnotations`, the real IPC handler, and `SqliteOverlayStore` on the migrated schema (node:sqlite) |
| E2E `pdf-embedded-annotations.spec.ts` | the built Electron app, end to end, across a relaunch |

The spike's 12 checks map to the requirements as follows:

1. Supported types, read from real files (requirement 11).
2. First open imports everything.
3. Reopen writes nothing, byte-for-byte.
4. A book never synced is still imported.
5. Two annotations added with every object renumbered.
6. A color and comment edit updates the row and keeps `created_at`.
7. An annotation removed from the file keeps its row.
8. A PDF without annotations writes nothing.
9. Identical and overlapping annotations stay separate.
10. App-made rows are untouched, app edits win, and app deletions stick.
11. An unreadable page, a cancelled scan, mixed bad items, a wrong or unknown or EPUB book, and the
    5000 cap: no crash and no junk written.
12. The PDF bookmark and a legacy EPUB row stay byte-identical, and deleting a book cascades its ledger.

The E2E spec runs these steps:

1. Opening a PDF with 10 embedded annotations shows the 5 supported ones as app marks.
2. The **canvas pixel inside the imported highlight is plain white**, so the file's own appearance
   is hidden and nothing is drawn twice.
3. A click on an imported mark opens the edit menu.
4. An app highlight is made on line 7.
5. The app is closed. The file is **rewritten in place**: the highlight is recolored, the StrikeOut
   removed, 2 annotations added and every object renumbered. The app is relaunched on the same data
   and the book resumed.
6. Expected after the relaunch: exactly 4 highlights on page 1 (the recolored import, the app-made
   one and the new one); the StrikeOut is still there; the new underline appears on page 3; nothing
   is duplicated.

**Results (2026-10-15, Windows 11):**

| Check | Result |
|---|---|
| SDK `npm run verify` | ✅ 10 files, 124 tests |
| Desktop `npm run typecheck`, `npm run lint`, `npm run e2e:typecheck` | ✅ |
| `spike:pdf:embedded` | ✅ 12 / 12 |
| Regression spikes: `spike:pdf:annotations` (21), `spike:signature:status` (23), `spike:reader:toolbar` (29), `spike:pdf:search` (9), `spike:settings:reset` (14), `spike:settings:reminders` (30), `spike:session:roundtrip`, `spike:overlay:cfi` | ✅ |
| E2E `pdf-embedded-annotations.spec.ts` | ✅ 4 consecutive runs (20–47 s). One earlier run hit the 120 s test timeout with an `EBUSY` while cleaning the temp userData at teardown, as in the teardown timeout noted in `pdf_text_annotations.md` §7. |
| Full E2E suite (`vite build` + `playwright test`) | ⚠️ then ✅ (details below) |

The full suite ran twice:

- **First run:** 8 of 24 specs failed: TOC sync ×5, Fit page ×1, EPUB-vs-PDF highlights ×1, and the
  new spec. Each took 1.2–2 min instead of seconds, with `EBUSY` teardown errors. At the same time
  another process was modifying `package.json` and `package-lock.json` in this checkout (dependency
  additions not part of this change). The failure screenshots show the reader working normally, so
  this points to machine contention rather than a regression.
- **Re-run of every affected file:** `pdf-toc-sync`, `pdf-fit-page`, `pdf-annotations` and
  `pdf-embedded-annotations` ran in isolation right after: ✅ **15 / 15**.
- **Not affected:** the remaining specs (Page layout, cursor zoom, EPUB TOC) passed in the first run.

## 7. Limitations

- **No `/NM` from PDF.js.** Identity is the anchor, so a mark moved or resized in another viewer
  becomes a second row. A change below 0.001 of the page in another viewer's rounding could, in
  theory, cross a rounding boundary and do the same.
- **Removals in the file are not propagated.** This is by design: no safe rule distinguishes
  "deleted in Foxit" from "edited in the app", so the row stays. The ledger keeps the entry.
- **Squiggly becomes an underline** (no squiggly style in the app). Its own wavy appearance is hidden
  once imported.
- **A sticky note's 📝 icon** is placed at the end of its icon rect, the same rule as app notes,
  not exactly on the file's icon.
- **Replies and comment threads** (`/IRT`) are not imported, and neither is the author (`/T`). The
  author only feeds the change hash, because the model has no author field.
- **Hidden canvas appearance also applies to imported rows the user deleted.** Deleting in the app
  removes the mark from view, although the file still contains it.
- **First paint:** pages rendered before the scan finishes show the file's appearance briefly, and
  are re-rendered once the sync answers. An imported row is painted by the overlay only after the
  sync. Page layout thumbnails rendered before that keep the file's appearance until they are
  re-rendered.
- **Mobile / SDK `sql-notes.ts`:** not involved. The `notes` JSON layout is the desktop one
  (`pdf_text_annotations.md` §9).
