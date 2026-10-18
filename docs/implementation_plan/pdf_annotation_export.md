# PDF annotation export (phase 2)

Date: 2026-10-17. Builds on `pdf_text_annotations.md`, `pdf_embedded_annotation_import.md` and
`pdf_embedded_annotation_live_sync.md`.

Goal: **Export a new PDF file** with Readmate's annotations, meaning the ones it created, edited or
deleted, written as standard PDF annotations, so Foxit, Acrobat and other compliant viewers show
them. Export itself never writes the book's own file. (Since 2026-10-18 the app also writes
annotations into the book's own PDF continuously — see `pdf_annotation_two_way_sync.md` §2; the export
of a file that already holds everything is a faithful copy of it.)

## 1. Audit (verified in code)

- **Readmate annotation model:** `notes` rows with `type` ∈ `highlight | underline | strikethrough |
  textbox` (textbox = Note on a text selection, painted as a 📝 icon) and `style.colorHex`
  (`#RRGGBB` or `#RRGGBBAA`).
  - `note` is the comment text. There is no author field.
  - `pdfAnnotation` holds the rects, normalized 0–1 in the *displayed* page box: the PDF.js viewport
    at scale 1, crop box plus `/Rotate`, top-left origin. A selection can span pages (one row,
    rects tagged with their `pageIndex`).
- **Ledger:** `pdf_embedded_annotations` links an embedded annotation's key (`nm1:` or `pdf1:`) to
  its `notes` row, plus the source and content hashes. A row whose `notes` row is gone is a
  tombstone, meaning it was deleted in Readmate.
- **PDF.js 5.4.624** can save only annotations created through its own editor layer
  (`annotationStorage` + `saveDocument()`: FreeText, Ink, Stamp, Highlight editors). It has no API to
  add Underline, StrikeOut or Text notes from data, or to rewrite or remove arbitrary existing
  annotations, so it is not a writer for this. It stays the **reader / verifier**.
- **Coordinates:** the inverse of `viewport.transform` (scale 1) maps the stored rects back to PDF
  user space. That handles crop-box offsets and all four rotations.
- **Signatures:** `electron/signature/signature-service.ts` `verifyPdf` already reports
  `unsigned / valid / invalid / unsupported` for PDFs.
- **Encryption:** `/Encrypt` in the trailer.
- **Metadata, forms, outlines (bookmarks), links, fonts, images:** these live in objects the export
  never rewrites (see §2), so they are carried over byte for byte.

## 2. Writing library: comparison and decision

| Option | License | Edits an existing PDF | Keeps unrelated objects | Incremental update | Encrypted input | Fit for Electron | Verdict |
|---|---|---|---|---|---|---|---|
| **pdf-lib** 1.17 | MIT | yes (low-level `PDFDict`) | re-serializes the **whole** file, drops the revision history, can fail or lose data on quirky files | no (full rewrite) | no (refuses; `ignoreEncryption` writes a broken file) | pure JS | no: unmaintained since 2021, full rewrite |
| @cantoo/pdf-lib (fork) | MIT | yes | same full rewrite | no | adds decryption | pure JS | no: full rewrite |
| mupdf (npm, WASM) | **AGPL-3.0** | yes, rich annotation API | yes | yes | yes | WASM | no: AGPL would bind the whole app |
| muhammara (HummusJS) | Apache-2.0 | yes | yes | yes | partial | **native addon**: per-Electron-ABI builds | no: native build burden for a small feature |
| qpdf / pikepdf | Apache-2.0 / MPL | yes | yes | — | yes | external binary / Python | no: not shippable |
| pdf.js `saveDocument` | Apache-2.0 | only its own editor annotations | yes | yes | — | already a dependency | no: can't write Underline / StrikeOut / Text or replace existing annotations |
| **Own incremental-update writer** (project code, plus pdf.js for page structure and read-back) | project | yes, for the annotation subset | **original bytes kept untouched**: the output is `original + one appended update` | yes (how Foxit and Acrobat save) | refused | pure TS, no new dependency | **chosen** |

**Decision: a small incremental-update writer** (`electron/pdf-sync/pdf-incremental-writer.ts`),
with pdf.js used to find pages and to verify the output.

- **Why:**
  - **Preservation:** every original byte stays untouched, so content, metadata, forms, outlines,
    links, fonts, images and earlier revisions are kept byte-identical.
  - **The mechanism viewers use themselves:** Foxit and Acrobat append updates too.
  - **No new dependency:** no license, maintenance or native-build risk.
  - **Reusable for phase 3:** the same writer can append to the user's own file with a minimal change.
- **Cost:** the writer understands only what it needs:
  - the trailer and the last xref section, classic or stream;
  - page dictionaries and their `/Annots`, inline or indirect;
  - annotation dictionaries.

  Everything else is opaque bytes. Files it can't handle, such as encrypted ones, are refused with
  an explicit error and never written in a "best effort" way.

## 3. Mapping Readmate → PDF

| Readmate | PDF annotation | Written keys |
|---|---|---|
| highlight | `/Highlight` | `/QuadPoints` (one quad per stored rect, display corners mapped back, in Acrobat's UL-UR-LL-LR order); `/Rect` (bbox); `/C` RGB; `/CA` opacity (from `#RRGGBBAA`, else 1); `/Contents` (note); `/T`; `/NM`; `/M` and `/CreationDate`; `/F 4` (Print); `/P`; `/AP /N` (a multiply-blended fill, so viewers that don't synthesize appearances still show it) |
| underline | `/Underline` | as highlight; the `/AP` is a line along the bottom edge of each quad (text direction respected on rotated pages) |
| strikethrough | `/StrikeOut` | as highlight; the `/AP` is a line through the middle of each quad |
| textbox (Note) | `/Text` (sticky note, `/Name /Comment`) | `/Rect` = a 20 pt icon at the end of the last selected rect; `/Contents` = the note; `/C`; `/T`; `/NM`; `/M`; `/F 28` (Print, NoZoom, NoRotate); no `/AP` (viewers draw the standard icon) |

- **Multi-page selections:** a PDF annotation belongs to one page, so one annotation is written per
  page. The first page gets `/NM (readmate:<noteId>)` and the others `readmate:<noteId>:p<page>`.
- **Author:** `/T (Readmate)`, because the model has no author.
- **Identity:** `/NM` is `readmate:<noteId>` for rows made in Readmate. An imported annotation keeps
  its own `/NM` when the row is rewritten.
- **Not written:** bookmarks (they are not PDF annotations), and anything else Readmate doesn't model.

## 4. What an export writes (`planPdfAnnotationExport`, SDK, pure)

The export source is always the **book's current file**. The output is that file plus **one**
appended update. Exporting again starts from the source again, so nothing accumulates.

| Row / annotation | Export |
|---|---|
| Embedded annotation imported into Readmate, row untouched since | kept as it is in the file |
| Embedded annotation imported, row **edited** in Readmate | its object is **replaced** (same object number, original `/NM` and `/Popup` kept) |
| Embedded annotation imported, then **deleted** in Readmate (tombstone) | **removed** from the page's `/Annots`, together with its `/Popup` |
| Row made in Readmate | **added** (new objects), unless the file already holds `readmate:<id>` (for example a book that is itself an earlier export), in which case it is **replaced** |
| `readmate:<id>` annotation in the file whose row no longer exists | **removed** |
| Embedded annotations Readmate doesn't import (Ink, FreeText, Link, widgets…) | kept untouched |

## 5. Safety

- **Target:** a new file chosen in a native save dialog, owned by Main. The renderer never sends or
  receives a path, only the base name for the toast.
- **Refused targets:** the book's own file, and anything inside the app's data folder.
- **Write:** to `<target>.readmate-<random>.tmp` in the target's folder, then `fsync`, then rename
  over the target. The OS dialog has already confirmed an overwrite. On failure the temp file is
  removed.
- **Error codes:**
  - `no_space` (ENOSPC)
  - `permission_denied` (EACCES / EPERM)
  - `busy` (EBUSY, the target is open elsewhere)
  - `write_failed`
- **The source is checked unchanged** after the export: same SHA-256 before and after, and the
  output starts with exactly the source's bytes.
- **Encrypted:** `encrypted` → refused.
- **Signed:** `verifyPdf` status other than `unsigned` → `signed_needs_confirmation`, with the
  signer. The UI warns that an annotated copy will show the signature as modified after signing or
  invalid, and exports only after the user confirms. Preservation of signature validity is **not**
  claimed.
- **Unsupported structure:** `unsupported_pdf` → refused.
- **Read-back:** pdf.js opens the output (`stopAtErrors`) and every written or replaced `/NM` is
  found with its subtype, page and color. Every removed one is gone. Otherwise the error is
  `verify_failed` and the target is not written.

## 6. Architecture

- **SDK** (`app-models/pdf-annotation-export.ts`, pure):
  - `pdfWriteAnnotationsFromHighlight`, which handles the Readmate → PDF mapping and the per-page
    split;
  - `planPdfAnnotationExport` (§4);
  - color parsing and date formatting.
- **Writer** (`electron/pdf-sync/pdf-incremental-writer.ts`, Node, no Electron, no UI, no SQLite):
  `appendAnnotationUpdate(bytes, pages, plan)`. It produces the dictionaries, the appearance
  streams, the updated `/Annots`, and the xref section with its trailer.
- **Worker:** the long-lived scan worker gains an `export` request. It scans the source (items plus
  page refs and viewports), plans the export with the ledger and rows Main sends, writes, and reads
  the output back.
- **Main:** the `library:exportAnnotatedPdf` IPC handles the save dialog, the signature and
  encryption checks, the worker call, and the safe write.
- **Renderer:** More menu → "Export PDF with annotations…", shown for PDF only, with a toast for the
  result and a confirmation for signed files. No PDF logic lives in React.

## 7. Files (phase 2)

SDK:
- `app-models/pdf-annotation-export.ts` (new): the mapping, `planPdfAnnotationWrite`, colors, dates
  and names.
- `app-models/index.ts`.
- `tests/app-models/pdf-annotation-export.test.ts` (new, 14 tests).

Desktop:
- `electron/pdf-sync/pdf-syntax.ts` (new): value extents, top-level dictionary entries, patching,
  references, strings.
- `electron/pdf-sync/pdf-incremental-writer.ts` (new): the writer.
- `electron/pdf-sync/pdf-annotation-write.ts` (new): scan, plan, write, read back and verify.
- `electron/pdf-sync/pdf-annotation-export.ts` (new): the export flow and `writeFileSafely`.
- `electron/pdf-sync/pdf-raw-objects.ts`: a `PdfRawObjects` index shared with the writer.
- `electron/pdf-sync/pdf-annotation-scan.ts`: page geometry (object references and viewports), and
  a plain `Uint8Array` copy, since pdf.js refuses Node Buffers.
- `electron/pdf-sync/pdf-annotation-scan.worker.ts`: `scan` and `write` requests.
- `electron/ipc/overlay.ipc.ts`: `runInScanWorker` and the `overlay:exportAnnotatedPdf` handler,
  including the save dialog.
- `electron/ipc/channels.ts`, `api-types.ts`, `preload.ts`, `src/bridge/overlay.ts`.
- `electron/persistence/sqlite-overlay-store.ts`: `listEmbeddedLedger`.
- `src/screens/Reader/logic/pdfExport/pdfExportStore.ts` (new).
- `components/dialogs/SignedPdfWriteDialog.tsx` (new).
- `components/chrome/MoreMenu.tsx`, `ReaderTopbar.tsx`, `ReaderScreen.tsx`.
- `e2e/support/build-annotated-pdf.mjs`: `pageBoxes` (MediaBox, CropBox, Rotate) and popups.
- `e2e/specs/pdf-annotation-export.spec.ts` (new).
- `spikes/pdf-annotations/run-pdf-annotation-export.mjs` (new).
- `package.json`: `spike:pdf:export`.

There is no new dependency and no migration.

## 8. Tests (2026-10-17, Windows 11)

| Check | Result |
|---|---|
| SDK unit tests: mapping, colors and opacity, dates, names, multi-page split, write plan (add / keep / replace in place with original `/NM` / tombstone removal / re-export without duplicates / multi-page parts / foreign annotations untouched) | ✅ 14 |
| `spike:pdf:export`: real writer + pdf.js 5.4.624 read-back | ✅ 9/9 |
| E2E `pdf-annotation-export.spec.ts`: create in app → More → Export → output read by pdf.js **in the test process** → re-export | ✅ 2/2 |

The spike's checks cover:
1. The four types, with subtype, `/NM`, color, opacity, comment, author, dates and appearance stream.
2. `/Rotate` 90/180/270, a crop box and a different page size: the rects come back within 0.003 of
   the page.
3. Deterministic and idempotent export, re-export of an export, and removal of a deleted row.
4. Imported annotations: untouched ones kept, edited ones rewritten in the same object, deleted ones
   removed together with their `/Popup`.
5. The output starts with the source bytes, and foreign Link, Ink and FreeText annotations are kept.
6. Classic xref, xref stream with object streams, and an earlier incremental update, each with a
   second update on top.
7. Encrypted and broken-trailer files are refused.
8. Nothing to write gives an identical copy.
9. The flow: signed source needs confirmation; target = source and app-data targets are refused;
   existing targets are replaced safely; a read-only target fails cleanly with no temp file left;
   a source changed mid-export is detected; the source is never written.

**Foxit / other viewers:** see `pdf_annotation_reader_compatibility.md` (phase 4) for what was and
was not verified in a real viewer.

## 9. Limitations

- **Encrypted PDFs** are refused. Files whose last `startxref` doesn't point at an xref section
  (pdf.js would "recover" them) are refused as `unsupported_pdf`.
- **Text notes** are written as `/Text` sticky notes at the end of the selection. The selected text
  itself is not marked in other viewers, and their icon is the viewer's standard one.
- **Signatures:** the signed revision stays byte-identical inside the output, but readers will
  report the copy as modified after signing. Signature validity is **not** claimed to survive.
- **Author** is always `Readmate`. The original `/T` of imported annotations is kept only when they
  are left untouched.
- **Appearance streams** are generated for Highlight / Underline / StrikeOut, as a multiply fill and
  simple lines. A viewer that regenerates appearances may draw them slightly differently.
- **Bookmarks** are not exported: they are not PDF annotations.
