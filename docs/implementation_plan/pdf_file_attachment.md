# PDF file attachments (create / move / delete)

Scope: **PDF only.** Placing a file on a PDF page as a FileAttachment annotation whose content is embedded in the
PDF, then opening / saving it out, moving it on its page and deleting it. Reading, opening and saving out
attachments already inside a PDF (the Attachment sidebar tab) is [pdf_attachments.md](pdf_attachments.md) and is
reused unchanged.

Status: built (specs/007 T001–T057). Compatibility with Foxit / Acrobat is **not claimed** until
[pdf_file_attachment_compat.md](pdf_file_attachment_compat.md) holds results.

- Spec: [specs/007-pdf-file-attachment/spec.md](../../specs/007-pdf-file-attachment/spec.md)
- Plan: [plan.md](../../specs/007-pdf-file-attachment/plan.md)
- Research / decisions: [research.md](../../specs/007-pdf-file-attachment/research.md)
- Data model: [data-model.md](../../specs/007-pdf-file-attachment/data-model.md)
- IPC contracts: [contracts/pdf-file-attachment.md](../../specs/007-pdf-file-attachment/contracts/pdf-file-attachment.md)
- Checks: [quickstart.md](../../specs/007-pdf-file-attachment/quickstart.md)
- Compatibility record: [pdf_file_attachment_compat.md](pdf_file_attachment_compat.md)

## What is written into the PDF

One **incremental update** per attach / move / delete (original bytes untouched; R1, R2, R10, R11):

| Object | Attach | Move | Delete |
|---|---|---|---|
| EmbeddedFile stream (`/Filter /FlateDecode`, indirect `/Length`, `/Params /Size /CheckSum (MD5) /ModDate`) | new | — | — (stays in the earlier revision) |
| Filespec (`/F` ASCII name, `/UF` Unicode name, `/EF << /F /UF >>`) | new | — | — |
| FileAttachment annotation (`/NM (readmate:<rowId>)`, `/Name /Paperclip`, `/FS`, `/C`, `/T`, `/Contents` = name, `/M`, `/CreationDate`, `/P`) | new | rewritten, **same object number**, `/FS` + `/Popup /IRT /RT /StructParent /OC` kept | removed from the page `/Annots` (with its popup) |
| Appearance stream (paperclip icon, BBox = Rect) | new | new | — |
| Page `/Annots` (inline or indirect array) | patched | — | patched |

Never touched: the catalog's `/Names /EmbeddedFiles` (a document-level entry would survive a delete), other
annotations, the Filespec / EmbeddedFile on a move. The file name is sanitised (`sanitizeAttachmentFileName`) before it
is written.

## Flow

```
renderer (pageAttachmentsStore)        Main                                         scan worker (pdf.js)
attach tool click(page, point) ──► attachments:create
                                   resolveBookFile (PDF) ─ runFileOperation slot:
                                   checkWritable ── blocked? → refuse, NO picker
                                   picker (Main-owned dialog)  ── cancelled → nothing
                                   stageAttachmentSource: stat → size check (never read when over)
                                     → copy to {userData}/attachment-staging/{uuid}/content (SHA-256 + MD5,
                                       count = stat size, mtime unchanged)
                                   slot again: checkWritable, size vs PDF ─────────► scan (pages, items)
                                                                           ─────────► attachment-plan
                                   writeAttachmentUpdate: temp beside target, original bytes → segments →
                                     deflate(staged) → /Length → xref; fsync ────────► attachment-verify (temp)
                                   re-check target = scanned version → rename
                                   ONE SQLite write: notes row (kind `attachment`)
row in the list ◄──────────────── { ok, highlight }   (the next sync cycle links it in the ledger)
```

`attachments:change { op: 'move' | 'delete' }` is the same slot → check → `attachment-change` (worker) → temp → verify →
re-check → rename → ONE transaction (`commitAttachmentChange`: update the row, or delete the row + its ledger
entries). The renderer sends only `bookId`, `pageIndex` + point, or `bookId` + `rowId` (+ rect) — never a path, a name
or bytes.

**Atomic write** (R5–R6): `writeFileSafelyStreaming` writes `.{name}.readmate-{hex}.tmp` beside the PDF (`wx`),
fsyncs, runs the read-back, checks the target is still the version that was read (size + SHA-256 — otherwise
`blocked` / `changed`), then renames. Any failure removes the temp file; the PDF is byte-identical. Orphan temps of this
pattern are swept before each write; `attachment-staging/` is swept at startup.

## Identity

| Who made it | Id used by open / Save As | Row |
|---|---|---|
| Readmate | `rm-<rowId>` — resolved by `/NM readmate:<rowId>` in freshly read bytes, so a move never changes it | `notes` row, style kind `attachment`, `page-rect` locator, `pdfAnnotation.attachment = { name, sizeBytes, sha256, modifiedAt? }` |
| Another reader | `page-{page}-{ordinal}-{hash12}` (existing `buildAttachmentId`) | none — sent with each sync event as `pageAttachments` (open / save only) |

Readmate draws every page attachment's icon itself (R9); the file's own appearance is hidden on the canvas through
`hiddenObjectIds` only while the displayed file is the scanned one.

**Live sync** (R7): attachments are **file-authoritative**. A changed rect in the file moves the row; a complete scan
without the row's `/NM` deletes it; a `readmate:` FileAttachment without a row is imported. The two-way cycle never
produces a file operation for kind `attachment`; `overlay:saveHighlight` / `deleteHighlight` refuse it
(`invalid_payload`), and annotation import never creates one.

## Limits

- **100 MB per file** (`ATTACHMENT_MAX_BYTES`, 104 857 600 bytes) — Readmate's own choice, checked on `stat` before the
  file is opened, and again on the bytes actually read. Empty files are refused.
- **PDF + file ≤ 300 MB** (`ATTACH_COMBINED_MAX_BYTES`) — the largest total the M0 measurement passed with the 512 MB
  scan-worker heap (research R3). Above it: `too_large_for_pdf`.
- No total across attachments. Refusal messages (`describeAttachFailure`) give the sizes with one decimal and the
  limit ("“x.mov” is 150.2 MB — the limit is 100 MB. Nothing was attached.") and never name PDF, Foxit or Acrobat as
  the source of the limit.

## Delete semantics (FR-019)

Delete takes the annotation off the page: no reader shows or lists it any more. The embedded bytes stay in the PDF's
earlier revision, so **the PDF does not get smaller** — the confirmation (`DeleteAttachmentDialog`) says so. Delete and
create are not in the undo history (undoing a create would delete without confirmation; redoing a delete would need
the removed content); a move is, and undo / redo move it again in the PDF (a refused step stays in the history).

## Unwritable PDFs

Read-only file / folder, Readmate's own copy (URL / cloud), encrypted, unsupported structure → refused before the
picker opens, with the reason; the File Attachment tool is then shown disabled with that reason (known from the
sync's `writeStatus` or the last refusal). A signed PDF asks first (the existing signed-PDF dialog); on confirm
`overlay:confirmSignedPdfWrite` is called and the same request is repeated.

## Renderer

- Tool `fileAttachment` (capability `fileAttachments`, PDF only) in the Freehand group.
- Icons: `PdfAttachmentLayer` (paperclip, 20 pt box). Click selects (tooltip = name); double-click / Enter → details
  panel (`AttachmentDetailsPanel`: name, size, page, Open / Save As — a blocked type shows the reason and Save As only);
  right-click → Open, Save As, Details, Delete… (Readmate-made only); drag (Select / Hand) moves a Readmate-made icon on
  its page, dimmed at the target until Main answers; Delete / Backspace asks to delete.
- State: `src/screens/Reader/logic/attachments/pageAttachmentsStore.ts` (creating, selection, dialogs, foreign
  attachments, move / delete, signed confirmation, write block). Dialogs: `PageAttachmentDialogs.tsx`.
- Notes list: Readmate rows as 📎 entries; other readers' attachments as read-only entries ("added by another app").

## Export

- **Export PDF with annotations**: the exported file is a copy of the source plus Readmate's annotations; every
  attachment is already in the copied bytes, so attachment rows are never written again (no second embedded copy).
- **Annotation export (spec 006)**: attachment rows are not in the restorable `.readmate-notes.json` (their content
  lives in the PDF); the readable `.md` lists them under their page as `📎 name (size), page n`. A book with only
  attachments has nothing to restore.

## Measurements

M0 memory gate: [research.md R3](../../specs/007-pdf-file-attachment/research.md) (all 18 combinations PDF 1 / 50 / 200 MB
× file 1 / 50 / 100 MB passed in a 512 MB worker).

Success criteria — `npm run spike:pdf:attachment-memory -- --sc`, 2026-10-30, Windows 11 dev machine, plain Node,
scan / plan / verify in a worker with the app's heap limit, staging + streamed write on the measuring thread; "stall"
= the longest time that thread could not run a 10 ms timer:

| Criterion | Target | Run 1 | Run 2 | Result |
|---|---|---|---|---|
| SC-004 10 MB file into a 50 MB PDF | ≤ 5 s | 1.4 s, stall 20 ms | 2.0 s, stall 66 ms | met |
| SC-004 100 MB file into a 50 MB PDF | completes or refused cleanly, no stall > 1 s | attached, 6.7 s, stall 106 ms | attached, 10.1 s, stall 103 ms | met |
| SC-005 over-limit file (150 MB) refused | ≤ 1 s, before reading | 2 ms | 1 ms | met |

Not measured in the packaged Electron app (no E2E run): the numbers are the same code paths outside Electron.

## Known limits

- **Every later scan pays for the content.** pdf.js materialises each FileAttachment's decoded content when a page's
  annotations are read, so opening a PDF and every live-sync cycle cost roughly the size of its attachments
  (M0: an open scan of a 200 MB PDF holding a 100 MB attachment took 1.8–2.3 s).
- **Later writes are slower.** Every write re-reads and re-parses the whole (now larger) PDF; the next
  ordinary annotation write took 0.7–1.5 s in M0 for 200–300 MB PDFs.
- **Deleting never frees space** (incremental update; see above).
- **The tool's disabled state is best-effort**: a PDF that has never had anything to write may not have reported a
  `writeStatus` yet; the click is then refused by Main before the picker opens.
- **Compatibility unverified**: `npm run spike:pdf:compat-kit -- <dir> [--samples <dir>]` builds the test files
  (`attachments/` + README); results go in [pdf_file_attachment_compat.md](pdf_file_attachment_compat.md).

## Checks

| Script | What |
|---|---|
| `spike:pdf:attachment-memory` | M0 matrix + SC-004 / SC-005 (`--quick`, `--sc`) |
| `spike:pdf:attachment-write` | Main side on real files: attach, refusals, unwritable PDFs and write failures, move / delete, live sync, hostile PDFs (quickstart scenarios 1–13) |
| `spike:pdf:attachment-store` | the real renderer stores against the real Main operations: create, cancel, refusals, signed, move + undo / redo, delete, book switch |
| `spike:pdf:attachments` | open / Save As incl. `rm-<uuid>` ids |
| `spike:pdf:export` | scenario 14: attachments survive Export PDF, no second copy |
| `spike:reader:toolbar` | the tool exists for PDF only (SC-007) |
| SDK `tests/attachments/*`, `tests/annotation-transfer/*`, `tests/app-models/pdf-annotation-two-way.test.ts` | payload, ids, limits, messages, sync rules, export |
