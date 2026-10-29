# Audit: what exists today for PDF attachments (2026-10-29)

Read-only audit done before writing `spec.md`. Paths are relative to `source/apps/`. Nothing here is a design
decision; it is the ground the spec stands on and the open points the plan must verify.

## 1. Reading attachments already exists (Phase 1, `docs/implementation_plan/pdf_attachments.md`)

| What | Where | Notes |
|---|---|---|
| Attachment sidebar tab, PDF only (capability `attachments`) | renderer `src/screens/Reader/logic/attachments/` | lists lazily when the tab opens |
| Listing document-level (`/EmbeddedFiles`, `getAttachments()`) and page-level (`FileAttachment`, `getAnnotations()`) files | `reading-book-desktop/electron/attachments/pdf-attachments.ts` | runs in the long-lived scan worker (kinds `attachments-list` / `attachment-extract`) |
| Open → confirmation → `attachments:open`; blocked → `attachments:saveAs` | `electron/attachments/attachment-service.ts`, channels `attachments:list|open|saveAs` | renderer sends `bookId` + `attachmentId` only |
| Security policy: name sanitising, prohibited extensions, no-extension, executable-content sniffing, 100 MB on extracted bytes, 500 listed max | `book-reader-sdk/src/attachments/attachment-policy.ts` (`ATTACHMENT_MAX_BYTES`, `ATTACHMENT_MAX_COUNT`, `classifyAttachment`, `checkAttachmentSize`) | MIME claimed by the PDF is never read |
| Temp copies `{userData}/attachment-tmp/{uuid}/…`, swept at startup (and quit on Windows) | attachment service | |
| Identity `doc-{ordinal}-{hash12}` / `page-{page}-{ordinal}-{hash12}` | policy | content hash ⇒ an id from an older file version cannot open a changed file |

**Consequence**: opening / saving / policy for attachments are done. The new work is **creating, moving and
deleting** a page-level File Attachment annotation, and showing its icon on the page.

## 2. Writing into the PDF

- `electron/pdf-sync/pdf-incremental-writer.ts` appends ONE incremental update (original bytes untouched) with
  add / replace / remove of annotations; refuses encrypted / unparseable trailers (`PdfWriteError`). Handles classic
  xref tables and xref streams. Every write is read back with pdf.js.
- Supported write subtypes today (`PdfWriteSubtype`, SDK `app-models/pdf-annotation-export.ts`): Highlight,
  Underline, Squiggly, StrikeOut, Text, Square, Circle, Line, FreeText. **No FileAttachment, no embedded-file stream,
  no file specification.**
- `appendRawObjects` exists for adding arbitrary objects (used by Typewriter fonts) — a candidate for the embedded
  file stream + `/Filespec`.
- The writer works on the **whole file in memory** as a latin1 string + `Buffer` (several copies during
  serialise). It runs in the scan worker, whose heap is capped (`SCAN_WORKER_HEAP_LIMIT_MB` in
  `electron/ipc/overlay.ipc.ts`). A 100 MB attachment added to an already large PDF is therefore an **unverified
  memory risk** (see spec "Questions for planning").
- New streams are written uncompressed today (`streamObject`). Whether the embedded file is Flate-compressed is
  open.
- Files are replaced with `writeFileSafely` (`pdf-annotation-export.ts`): temp file next to the target, flush,
  rename; temp removed on failure. This is what makes a failed write leave the original intact.
- **Removal is only from the page's `/Annots`.** An incremental update never deletes earlier bytes, so a removed
  attachment's content is still physically present in the file (older revision) and the file does not shrink.

## 3. Two-way sync and eligibility

- Always on, no switch. App rows in `notes` → written to the user's own referenced PDF after
  `pdf-write-eligibility.ts` (user-owned, writable, not encrypted, not signed unless confirmed, unchanged since read).
  A file that fails it is never written; data stays pending in SQLite.
- Per-annotation "Not in the file" status with a reason exists (Typewriter: `file_not_writable`,
  `unsupported_characters`, `font_unavailable`, `does_not_fit`; type in `pdf-annotation-sync-service.ts` and
  `api-types.ts`). A new attachment would plausibly reuse it (e.g. `file_not_writable`, too large to write).
- App-made annotations carry `/NM readmate:<id>`; three-way merge per field from `base_json`.
- Embedded-annotation import (`book-reader-sdk/src/app-models/pdf-embedded-annotations.ts`,
  `EMBEDDED_PDF_ANNOTATION_SUBTYPES`) does **not** include FileAttachment: attachments made by other readers are not
  turned into `notes` rows; they are only listed by the Attachment tab.
- Export PDF with annotations (`overlay:exportAnnotatedPdf`) copies the source bytes and appends app annotations, so
  anything already in the file survives; anything only pending in the app needs its bytes available to the export.

## 4. Annotation model

- `notes` rows with a `page-rect` locator, `note_json.pdfAnnotation` (0-based `pageIndex`, rects normalised 0–1
  to the displayed page box), `HighlightStyleKind` decides the kind (shapes and `typewriter` were added this way
  without migrations or new channels). Sticky note (`textbox` → `/Text`) already uses a fixed 20-unit icon.
- `pdfHighlightsStore` history (undo/redo) and the Notes list cover every kind.
- Storing up to 100 MB of file content inside a SQLite row is not done anywhere today.

## 5. Rendering

- pdfjs-dist 5.4.624, pages rendered with `AnnotationMode.ENABLE_STORAGE`; a FileAttachment's appearance stream (if
  it has one) is painted on the canvas by pdf.js, otherwise nothing is drawn. Readmate draws its own marks through
  `PdfAnnotationLayer`.

## 6. Compatibility evidence

None. No test has been run against Foxit or Adobe Acrobat for FileAttachment. There is a manual kit
(`spike:pdf:compat-kit`) for other annotation kinds that could be extended.
