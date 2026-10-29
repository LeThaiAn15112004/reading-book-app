# Quickstart: validating PDF File Attachment

How to prove the feature works. Contracts: [contracts/pdf-file-attachment.md](contracts/pdf-file-attachment.md).
Data: [data-model.md](data-model.md). E2E is manual-only (CLAUDE.md): agents run only the automated checks below.

## 1. Automated checks (agents and CI)

From `source/apps/book-reader-sdk`:

```sh
npm run typecheck && npm run typecheck:tests && npm test     # incl. tests/attachments/*, two-way planner cases
```

From `source/apps/reading-book-desktop`:

```sh
npm run typecheck && npm run lint && npm run e2e:typecheck && npx vite build
npm run spike:pdf:attachment-memory      # M0 (research R3): prints the heap / time table, fails over budget
npm run spike:pdf:attachment-write       # Main side on real temp files (below)
npm run spike:pdf:attachment-store       # renderer store against the real Main service
npm run spike:pdf:attachments            # existing: open / Save As still pass, + rm-<uuid> ids
npm run spike:pdf:two-way                # existing: no regression of the two-way coordinator
npm run spike:pdf:export                 # existing + attachment content identical in the exported file
npm run spike:reader:toolbar             # tool present for PDF only
```

`spike:pdf:attachment-write` must show, each on a generated PDF (classic xref and xref stream, rotated page,
cropped page, PDF with existing highlights / shapes / typewriter / Foxit-style FileAttachment):

| # | Scenario | Expected |
|---|---|---|
| 1 | attach 1 B, 1 MB, 50 MB, 100 MB (exact) | `ok`; pdf.js finds FileAttachment on the page, rect ±0.5, decoded SHA-256 = source; `getAttachments()` unchanged |
| 2 | 100 MB + 1 B, 0 B | `too_large` (sizes in result) / `empty`; file SHA-256 unchanged; source never opened for reading (spy) |
| 3 | read-only file, managed copy, encrypted, signed (not confirmed) | `blocked` + reason; picker stub never called |
| 4 | picker cancelled | `cancelled`; nothing changed |
| 5 | source grows / shrinks during staging | `source_changed`; nothing changed |
| 6 | ENOSPC / EIO injected at temp write, fsync and rename | `write_failed`; target byte-identical; no temp / staging left |
| 7 | verification forced to fail | `verify_failed`; target byte-identical |
| 8 | target modified between scan and rename | `blocked` (`changed`); other program's version kept |
| 9 | move, then reopen | new rect; same object number; `/FS` and content untouched |
| 10 | delete, then reopen | not listed by pdf.js; every other annotation present; file did not shrink |
| 11 | two same-named files on one page | both present, distinct ids, both extract correctly |
| 12 | live sync after each step | no duplicate rows; row follows a rect changed by another writer; row removed when another writer deleted it |
| 13 | hostile PDF (names with `../`, `CON`, bidi, false `/Size`, executable behind `.pdf`) | names sanitised; open blocked as policy says; Save As writes only to the chosen path |
| 14 | export with annotations | exported file contains each attachment, content identical |

## 2. Manual in-app check (person, built app)

1. Open a writable PDF → choose the File Attachment tool → click a page → pick a `.docx`. Icon appears at the click;
   a toast names the file and size.
2. Hover → file name; double-click → details panel (name, size, page) with Open / Save As. Open → confirmation →
   Word opens it. Save As → written where chosen.
3. Drag the icon; Undo → back; Redo → moved. Right-click → Delete → the confirmation mentions that the file stays in
   the PDF's history; confirm → icon gone.
4. Close and reopen the book, then restart the app: state as left.
5. Pick a 150 MB file → refused with "150.0 MB — the limit is 100 MB". Make the PDF read-only → the tool explains it
   can't attach and no picker opens.
6. Open an EPUB, TXT, Markdown and an MP3: no File Attachment tool anywhere.

## 3. Compatibility record (manual, when the readers are available)

`npm run spike:pdf:compat-kit -- <dir>` writes the attachment test files (small text, 50 MB binary, Vietnamese file
name, moved, deleted, plus a Foxit- and an Acrobat-made sample if provided). Open each in Foxit and Acrobat and
fill `docs/implementation_plan/pdf_file_attachment_compat.md` (reader, version, OS; icon shown / listed in the
attachment pane / opens / content identical / deleted one absent). Mark "not tested" where a reader is not
available — never "compatible" without a result.
