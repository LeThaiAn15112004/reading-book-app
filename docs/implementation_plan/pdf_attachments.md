# PDF embedded attachments (Phase 1: list, secure extraction, OS opening)

Scope: **PDF only.** EPUB, TXT, Markdown and MP3 have no embedded-file mechanism (EPUB manifest items are rendering
resources, not attachments), so they show no Attachment tab. Opening an attachment *inside* Readmate is deferred; an
attachment is never added to the Library.

## What counts as an attachment

| Source | PDF structure | pdf.js |
|---|---|---|
| `document` | catalog `/Names /EmbeddedFiles` name tree | `PDFDocumentProxy.getAttachments()` |
| `page` | `FileAttachment` annotation (`/FS` file specification) | `page.getAnnotations({ intent: 'any' })` filtered by subtype |

Fonts, images and other XObjects are never listed. pdf.js exposes no MIME type for either source, so the policy
relies on the name and the extracted bytes only (embedded MIME claims could only block, never allow, and are not read).

## Flow

1. The Attachment tab is gated by the `attachments` reader capability (PDF only). The panel lists lazily when the tab
   opens: `attachments:list` → Main reads the PDF itself and scans it **in the existing long-lived scan worker**
   (`pdf-sync/pdf-annotation-scan.worker.ts`, kinds `attachments-list` / `attachment-extract`). Pages are scanned only
   then, never on open. Descriptors only (`BookAttachment`: id, sanitised name, size, description, page, source).
2. Double-click → confirmation dialog (file name + warning). **Cancel does nothing** — no IPC call.
3. Continue → `attachments:open { bookId, attachmentId }`. Main resolves the book (`resolveBookFile`, PDF only),
   re-reads the file, finds the attachment **in those bytes**, applies the 100 MB limit to the extracted data, runs the
   policy, writes `{userData}/attachment-tmp/{uuid}/{sanitised name}` and calls `shell.openPath`.
4. A blocked file (policy) writes nothing and returns `blocked`; the renderer shows "Readmate can't open this file"
   with **Save As…** — a separate `attachments:saveAs` call through a Main-owned save dialog.

The renderer sends only `bookId` + `attachmentId`; never bytes, names or paths.

## Identity

`doc-{ordinal}-{hash12}` / `page-{page}-{ordinal}-{hash12}`: position inside its group (duplicate names differ) + the
first 12 hex chars of the content SHA-256 (an id listed for an old version of the file cannot open a changed one). Ids
are validated by shape (`isAttachmentId`) before any file is read; an id absent from THIS PDF is `attachment_not_found`.

## Security policy (`book-reader-sdk/src/attachments/attachment-policy.ts`)

- Names: basename only, control / zero-width / bidi-override characters removed, `<>:"|?*` replaced, trailing dots and
  spaces trimmed, reserved device names prefixed, length bounded (extension kept). Never empty.
- Blocked (Save As only): prohibited final extension (executables, scripts, shortcuts, browser-hosted content, macro
  Office, installers, disk images…); **no extension**; **executable / script content** (MZ, ELF, Mach-O, `.lnk`, `#!`,
  `<html`, `<script`…) behind any name. Double extensions are judged by the final one (`invoice.pdf.exe` is blocked).
- Passing is not a safety claim — only "not an obvious launcher". There is no "always allow" and no settings page.
- 100 MB (`ATTACHMENT_MAX_BYTES`) is checked on the extracted bytes (worker and again in Main). At most
  `ATTACHMENT_MAX_COUNT` (500) attachments are listed.

## Temp files

Fresh `uuid` directory per open (no collisions), containment asserted, `wx` write. Removed at once if the OS could not
open the file. The whole root is removed at **startup** and, on Windows only (where a file in use cannot be deleted),
at quit; elsewhere quit deletes nothing, so a file an application still has open is never pulled away.

## Known limits

- pdf.js `getAttachments()` materialises every document-level file's bytes in the worker (heap capped at 512 MB);
  a PDF with enormous embedded files can fail the list with `extract_failed`.
- Encrypted PDFs that pdf.js cannot open without a password report `extract_failed`.
- A file attached both at document and page level is listed twice (two sources, two ids).
- No MIME type is available, so unknown extensions open via the OS association (or fail with "no application").

## Tests

- SDK vitest: `tests/attachments/attachment-policy.test.ts`.
- `npm run spike:pdf:attachments` (desktop): real pdf.js on generated PDFs, real service on temp files, real renderer
  store; OS opener and save dialog mocked.
- `npm run spike:reader:toolbar`: the Attachment tab is PDF-only.
