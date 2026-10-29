# Data Model: PDF File Attachment

No migration, no new table. Decisions: [research.md](research.md) R1, R7, R8, R10.

## 1. Readmate-made page attachment — a `notes` row

| Field | Value |
|---|---|
| `id` | UUID; also the PDF `/NM` as `readmate:<id>` |
| `book_id` | the PDF book |
| type / style kind | annotation row, `HighlightStyleKind = 'attachment'` (new) |
| locator | `page-rect`, 1-based page, `chapterIndex` = 0-based page (as every PDF annotation) |
| `note_json.pdfAnnotation.pageIndex` | 0-based page |
| `note_json.pdfAnnotation.rects` | exactly one rect: the icon box, normalised 0–1 to the displayed page box |
| `note_json.pdfAnnotation.attachment` | `{ name, sizeBytes, sha256, modifiedAt? }` (new optional field, below) |
| `note` | empty (no comment in this version) |
| `colorHex` | icon colour `#RRGGBB` (fixed default in v1) |
| `origin` | `app` (made here) or `file` (a `readmate:` attachment found in a file without a row, R7) — both editable |

### `PdfAttachmentInfo` (SDK, `pdfAnnotation.attachment`)

| Field | Type | Rule |
|---|---|---|
| `name` | string | `sanitizeAttachmentFileName` output; 1–255 chars; never a path |
| `sizeBytes` | integer | 1 … `ATTACHMENT_MAX_BYTES` (104 857 600) — the uncompressed size actually written |
| `sha256` | 64 lowercase hex | of the uncompressed content written |
| `modifiedAt` | ISO 8601, optional | source file mtime at pick time |

Validation (`parsePdfAnnotation`, re-run in Main): style kind `attachment` ⇔ `attachment` present; `rects.length === 1`;
rect inside `[0,1]²`, width and height > 0; no `shape`, no `typewriter`, no text-markup quads.

### Icon box

- Fixed size `ATTACHMENT_ICON_PT = 20` PDF units square (like the sticky-note icon).
- Created with its top-left at the click point; converted to normalised units with the page's scale-1 viewport;
  clamped so the whole box is inside the page (FR-010).
- Move keeps the size; the new top-left is clamped the same way.
- In the file: `/Rect` = the box mapped through the inverse page transform (works for rotated / cropped pages, as
  for shapes).

### Ledger entry (`pdf_embedded_annotations`, migration 023, unchanged schema)

Key = `/NM` `readmate:<id>`; `base_json` = the written state (page, rect, sha256, name). Written in the same SQLite
transaction as the row after each verified write.

## 2. Page attachment made by another reader — no row

Delivered with the sync event (`pageAttachments`, contracts §3), held in the renderer only:

| Field | Type |
|---|---|
| `attachmentId` | existing format `page-{page}-{ordinal}-{hash12}` |
| `pageIndex` | 0-based |
| `rect` | normalised icon box (the annotation `/Rect` mapped to the displayed page, clamped) |
| `name` | sanitised name |
| `sizeBytes` | actual decoded size (or `null` if the content is missing / unreadable) |
| `objectId` | pdf.js id, to hide its canvas appearance when `matchesDisplayedFile` |

Read-only: select, open, save. Never written, moved or deleted by Readmate.

## 3. Document-level attachment

Unchanged (`BookAttachment` with `source: 'document'`). Listed / opened / saved as today; never created or removed.

## 4. Attachment ids

| Shape | Meaning | Resolved by |
|---|---|---|
| `doc-{ordinal}-{hash12}` | document-level | existing |
| `page-{page}-{ordinal}-{hash12}` | page attachment by another reader | existing |
| `rm-{uuid}` (new) | Readmate-made page attachment | `/NM readmate:{uuid}` in the current file bytes |

`isAttachmentId` accepts the new shape; anything else is refused before the file is read.

## 5. Lifecycle of a Readmate-made attachment

```text
(none) --create: eligible, picked, size ok, staged, written, verified--> InFile
(none) --create refused (blocked | cancelled | empty | too_large | too_large_for_pdf | read_failed | source_changed | write_failed | verify_failed)--> (none)
InFile --move ok--> InFile (new rect)          InFile --move refused/failed--> InFile (unchanged)
InFile --delete confirmed + ok--> (none; content remains in the file's earlier revision)
InFile --complete scan without its /NM (removed by another reader)--> (none; row deleted)
InFile --scan shows another rect (moved by another reader)--> InFile (row follows the file)
```

There is no pending / "Not in the file" state.

## 6. Constants (SDK `src/attachments/`)

| Name | Value | Where used |
|---|---|---|
| `ATTACHMENT_MAX_BYTES` | 100 × 1024 × 1024 (existing) | pick check, staging, extraction |
| `ATTACH_COMBINED_MAX_BYTES` | set from M0 (research R3) | refuse `too_large_for_pdf` when PDF size + content size exceed it |
| `ATTACHMENT_ICON_PT` | 20 | icon box |
