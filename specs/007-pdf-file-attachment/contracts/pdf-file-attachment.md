# Contracts: PDF File Attachment

IPC between renderer and Main. Four-place rule (CLAUDE.md): `electron/ipc/channels.ts` → `electron/ipc/attachments.ipc.ts`
→ `electron/preload.ts` + `electron/ipc/api-types.ts` → `src/bridge/attachments.ts`. The renderer never sends a
path, a file name or file bytes. Every payload is re-validated in Main.

## 1. `attachments:create` (new)

Request:

```ts
type CreatePdfAttachmentRequestDto = {
  bookId: string
  pageIndex: number              // 0-based, < page count
  point: { x: number; y: number } // normalised 0–1 on the displayed page: the icon's top-left
}
```

Main, in order (stops at the first failure; nothing in the file or SQLite changes on any failure):

1. Validate payload; resolve the book (`resolveBookFile`, PDF only).
2. Inside the book's file-operation slot (research R5): `checkWritable` → blocked ⇒ `{ ok: false, code: 'blocked', reason }`.
   **The picker is not opened.**
3. Main-owned open dialog (one file). Cancel ⇒ `{ ok: false, code: 'cancelled' }`.
4. `lstat`/`stat`, size check ⇒ `empty` | `too_large` (+ `sizeBytes`, `limitBytes`) | `too_large_for_pdf` (+ `sizeBytes`, `pdfSizeBytes`, `limitBytes`).
5. Stage (stream copy + hashes) ⇒ `read_failed` | `source_changed`.
6. Build + stream the update to a temp file; `fsync` ⇒ `write_failed` (+ `errno` e.g. `ENOSPC`).
7. Verify the temp file ⇒ `verify_failed`. Re-check target unchanged ⇒ `blocked` (`reason: 'changed'`).
8. Rename; SQLite transaction (row + ledger); version bookkeeping.

Response:

```ts
type CreatePdfAttachmentResultDto =
  | { ok: true; highlight: HighlightDto }            // styleKind 'attachment', pdfAnnotation.attachment set
  | { ok: false; code: 'cancelled' }
  | { ok: false; code: 'blocked'; reason: WriteBlockReason | 'changed'; signerName?: string }
  | { ok: false; code: 'empty' | 'read_failed' | 'source_changed'; fileName?: string }
  | { ok: false; code: 'too_large'; sizeBytes: number; limitBytes: number }
  | { ok: false; code: 'too_large_for_pdf'; sizeBytes: number; pdfSizeBytes: number; limitBytes: number }
  | { ok: false; code: 'write_failed'; errno?: string }
  | { ok: false; code: 'verify_failed' | 'unsupported_pdf' | 'encrypted' | 'not_found' }
```

`reason: 'signed'` ⇒ the renderer shows the existing signed-file confirmation; on accept it calls
`overlay:confirmSignedPdfWrite` and repeats `attachments:create` (the picker opens then).

## 2. `attachments:change` (new)

```ts
type ChangePdfAttachmentRequestDto =
  | { bookId: string; rowId: string; op: 'move'; rect: { x: number; y: number; width: number; height: number } }
  | { bookId: string; rowId: string; op: 'delete' }

type ChangePdfAttachmentResultDto =
  | { ok: true; highlight?: HighlightDto }  // move: updated row; delete: absent
  | { ok: false; code: 'blocked'; reason: WriteBlockReason | 'changed'; signerName?: string }
  | { ok: false; code: 'not_found' | 'not_editable' | 'write_failed' | 'verify_failed' | 'unsupported_pdf' | 'encrypted'; errno?: string }
```

- `rowId` must be a kind-`attachment` row of `bookId` whose `/NM` is in the current file (`not_found` otherwise).
- Move: rect size must equal the stored size (± 1e-6), inside the page; only the annotation dictionary and its
  appearance are rewritten (same object number, `/FS` kept).
- Delete: annotation removed from `/Annots`; row + ledger entry deleted in one transaction after verification.
- The confirmation for delete is renderer-only; Main does not ask.

## 3. `overlay:pdfEmbeddedAnnotationsChanged` (existing event, extended)

New optional field on `PdfAnnotationSyncEvent` / its DTO:

```ts
pageAttachments?: {
  attachmentId: string      // page-{page}-{ordinal}-{hash12}
  pageIndex: number
  rect: { x: number; y: number; width: number; height: number } // normalised
  name: string              // sanitised
  sizeBytes: number | null
  objectId: string          // pdf.js id (hide on canvas only if matchesDisplayedFile)
}[]                          // attachments by OTHER readers only; capped at ATTACHMENT_MAX_COUNT
```

Readmate-made attachments arrive as ordinary rows (`outcome.inserted/updated/deleted`), and their pdf.js ids are in
`items` / `managedIndices` like other managed annotations (so their canvas appearance is hidden).

## 4. `attachments:open`, `attachments:saveAs` (existing, widened)

`attachmentId` may also be `rm-<uuid>` (data-model §4). Main resolves it by `/NM` in freshly read bytes. Policy,
confirmation, temp copy, 100 MB check and Save-As dialog are unchanged.

## 5. `overlay:saveHighlight`, `overlay:deleteHighlight`, annotation import (existing, narrowed)

Refuse any row with style kind `attachment` (`invalid_payload`). Rows of that kind are written only by §1/§2 and by
the live sync (R7).

## 6. SDK (pure, `book-reader-sdk/src`)

| Export | Purpose |
|---|---|
| `HighlightStyleKind` + `'attachment'` | new kind (both type definitions) |
| `PdfAttachmentInfo`, parse/validate in `parsePdfAnnotation` | row payload |
| `attachmentIconBox(point, page)`, `clampAttachmentBox(box)` | icon geometry (data-model §1) |
| `ATTACHMENT_ICON_PT`, `ATTACH_COMBINED_MAX_BYTES`, `checkAttachSize(contentBytes, pdfBytes)` | limits |
| `isAttachmentId` accepts `rm-<uuid>`; `readmateAttachmentId(rowId)` | ids |
| `describeAttachFailure(result)` | user-facing message keys incl. sizes formatted (`150.2 MB — the limit is 100 MB`) |
| `planTwoWaySync`: kind `attachment` → never a file op; file authoritative (R7) | sync |
| Export plan (`pdf-annotation-export.ts`) and annotation-transfer: skip kind `attachment` | R14 |

## 7. Main-internal (not IPC)

- `pdf-incremental-writer.ts`: `planAttachmentAppend(bytes, page, spec) → { segments, placeholder, finishXref }`
  (text segments around the content stream placeholder, indirect `/Length` object, xref built from the final
  offsets); `replace` keeps `FS` for FileAttachment; `FileAttachment` write subtype for move (dictionary + AP only).
- `pdf-attachment-writer.ts` (new): stage → stream → verify → rename (R4–R6).
- `pdf-annotation-sync-service.ts`: `runFileOperation(bookId, op)` (R5); scan returns `pageAttachments` + Readmate
  FileAttachment items.
- `pdf-annotation-export.ts`: `writeFileSafelyStreaming`.
- Startup sweep of `{userData}/attachment-staging/`.
