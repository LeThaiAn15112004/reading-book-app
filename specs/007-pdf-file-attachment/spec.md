# Feature Specification: PDF File Attachment

**Feature Branch**: `007-pdf-file-attachment`

**Created**: 2026-10-29

**Status**: Draft

**Input**: User description: "Xây dựng đặc tả tính năng PDF File Attachment cho Readmate Reader" — add a file to a PDF the way Foxit PDF Editor does: pick a file on the computer, place an attachment icon anywhere on a PDF page, store the file inside the PDF, then open or extract it. PDF only; not a general attachment system. (Full Vietnamese brief: sections 1–9 of the request.)

Existing system: see [audit.md](./audit.md). Reading, opening and saving out attachments that are already inside a PDF exists (Attachment tab, security policy, 100 MB limit on extraction). This feature adds **creating, placing, moving and deleting** a page-level File Attachment, and shows its icon on the page.

## Scope

| Format | File Attachment |
|--------|-----------------|
| PDF | Yes |
| EPUB, TXT, Markdown, DOCX/DOC | No — no tool, button, sidebar entry, menu item or backend |
| MP3, M4B and every other audiobook format | No |

Two kinds of attachment exist in a PDF and are treated separately:

| Kind | What it is | In this feature |
|------|-----------|-----------------|
| **Page attachment** (File Attachment annotation) | A file tied to an icon at a place on a page | **Created, moved and deleted by Readmate.** Readmate-made ones are fully editable. Ones made by other readers are shown and can be opened / saved only (not moved or deleted). |
| **Document attachment** (document-level embedded file list) | A file attached to the whole document, with no icon | **Not created, moved or deleted.** Listed, opened and saved exactly as today. |

Not in scope: a shared "book attachments" system; attachments in the annotation export file of spec 006 (that file carries no file content); opening an attachment inside Readmate; a settings page for the size limit; a total-size limit across attachments; attaching folders or several files in one step; editing the attachment's file content.

## Clarifications

### Session 2026-10-29

- Q: When the PDF cannot be written (read-only, encrypted, signed without confirmation, app-owned copy, changed on disk), what happens to a new attachment? → A: The attach is refused outright with the reason; nothing is kept in the app (no "Not in the file" state, no app-owned copy of the content).
- Q: A deleted attachment's content stays in the PDF's earlier revision (append-only writing); how is that handled? → A: The delete confirmation states it plainly (the file stays in the PDF's history and the PDF does not get smaller); no clean-copy feature in this version.
- Q: Can page attachments made by other readers (Foxit, Acrobat) be moved or deleted? → A: No — view, open and save only in this version.
- Q: Which mouse action on the page opens an attachment's details panel? → A: Single click selects (file name as tooltip; a Readmate-made icon can then be dragged or deleted); double-click or Enter opens the details panel; the right-click menu offers Open / Save As / Delete (Delete only for Readmate-made ones).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Attach a file at a place on a page (Priority: P1)

A reader opens a PDF, chooses the File Attachment tool among the PDF tools and clicks a spot on a page. The system file picker opens; the reader picks a file. An attachment icon appears where they clicked, and the file is stored inside the PDF itself — not as a link to the file on their computer.

**Why this priority**: It is the feature. Everything else (opening, moving, deleting, compatibility) needs an attachment to exist.

**Independent Test**: Attach a small file to a writable PDF; close the app; delete or move the original file on disk; reopen the PDF: the icon is at the same spot and the file can still be saved out with identical content.

**Acceptance Scenarios**:

1. **Given** an open, writable PDF and the File Attachment tool selected, **When** the reader clicks on a page and picks a file, **Then** an attachment icon appears at the clicked spot and the reader is told the file was attached (name and size).
2. **Given** the tool is selected and the reader clicked a spot, **When** the file picker is cancelled, **Then** no icon is created, nothing is written, and the tool stays selected.
3. **Given** a file has been attached, **When** the PDF is closed and reopened (also after the app restarts), **Then** the icon is in the same place on the same page and the file's content is byte-for-byte the one that was picked.
4. **Given** a file has been attached, **When** the original file on disk is deleted or changed afterwards, **Then** the attachment in the PDF is unaffected.
5. **Given** an EPUB, TXT, Markdown or audiobook is open, **When** the reader looks for the tool, **Then** it is not offered anywhere.
6. **Given** the PDF already has highlights, notes, shapes, typewriter notes or attachments (made in Readmate or another reader), **When** a file is attached, **Then** all of them are still present and unchanged afterwards.
7. **Given** the icon is placed near a page edge, **When** it is created, **Then** it is kept wholly inside the page.

---

### User Story 2 - Open or save out an attached file (Priority: P1)

The reader clicks (or double-clicks) an attachment icon on the page and sees the file's name, size and a warning appropriate to its type, then chooses to open it in the computer's default application or to save a copy somewhere.

**Why this priority**: An attachment that cannot be retrieved is useless; this is half of the core loop and reuses the existing safe-opening path.

**Independent Test**: Attach a `.docx` and an `.exe`; activate each icon: the `.docx` offers Open and Save; the `.exe` offers Save only, with the existing "can't open this file" explanation.

**Acceptance Scenarios**:

1. **Given** an attachment icon on the page, **When** the reader double-clicks it (or selects it and presses Enter), **Then** a panel shows the file name, size, the page it is on and, if available, its description, with Open and Save As actions. Nothing is opened yet.
2. **Given** that panel, **When** the reader chooses Open, **Then** the existing confirmation (file name + warning) is shown first and the file is opened by the operating system only after the reader confirms.
3. **Given** a file the security policy blocks (prohibited type, no extension, executable content behind any name), **When** it is activated, **Then** Open is not available and Save As is offered, with the reason.
4. **Given** Save As, **When** the reader picks a destination, **Then** the file is written only there; if a file with that name exists, the system dialog asks before replacing; the name proposed is the sanitised name.
5. **Given** a PDF with attachments made in Foxit or Acrobat (page or document level), **When** it is opened, **Then** page attachments show an icon on their page and both kinds are listed in the Attachment tab and can be opened / saved as today.
6. **Given** an attachment whose data in the PDF is missing, empty, unreadable or over the limit, **When** it is activated, **Then** a clear error is shown and nothing is written outside the app.

---

### User Story 3 - Move and delete an attachment (Priority: P2)

The reader drags a Readmate-made attachment icon to another spot on the same page, or deletes it. The PDF is updated accordingly.

**Why this priority**: Needed to correct mistakes, but the attach / open loop is useful without it.

**Independent Test**: Attach a file, move the icon, reopen: the icon is at the new spot. Delete it after confirming, reopen: no icon, and it is not listed in the Attachment tab.

**Acceptance Scenarios**:

1. **Given** a Readmate-made attachment icon, **When** the reader single-clicks it, **Then** it is visibly selected (file name as a tooltip, no panel opened) and can be moved or deleted; moving keeps it inside the page.
2. **Given** a moved icon, **When** the PDF is reopened, **Then** the icon is at the new spot and the file content is unchanged.
3. **Given** a selected attachment, **When** the reader deletes it, **Then** they are asked to confirm, with the file name and the consequence described in FR-019.
4. **Given** a confirmed delete, **When** the PDF is reopened, **Then** the icon is gone, the attachment is no longer listed and no other annotation changed.
5. **Given** a move, **When** the reader uses Undo, **Then** the icon returns to its previous spot.

---

### User Story 4 - Size limit and clear refusals (Priority: P2)

A reader who picks a file that is too large, empty or unreadable is told why, with numbers, and nothing is changed.

**Why this priority**: Protects the user's PDF and memory; without it a large pick could fail mid-write.

**Independent Test**: Pick a 150 MB file: the message gives the file's size and the 100 MB limit; the PDF's bytes are unchanged (same fingerprint).

**Acceptance Scenarios**:

1. **Given** a file larger than 100 MB, **When** it is picked, **Then** the attach is refused before the file's content is read, and the message shows the actual size and the limit (e.g. "150.2 MB — the limit is 100 MB").
2. **Given** an empty file (0 bytes), **When** it is picked, **Then** the attach is refused with a message saying the file is empty.
3. **Given** a file that cannot be read (permission, locked, vanished, changed while being read), **When** it is picked, **Then** the attach is refused with that reason and nothing is written.
4. **Given** a file of exactly 100 MB, **When** it is picked, **Then** it is accepted.
5. **Given** a refused attach, **When** the reader looks at the PDF and its other annotations, **Then** nothing changed, including annotations not yet written to the file.

---

### User Story 5 - PDF that cannot be written, and write failures (Priority: P2)

The reader tries to attach a file to a PDF Readmate may not or cannot write (read-only, app-owned copy, encrypted, signed without confirmation, changed on disk, disk full, write error).

**Why this priority**: The file is the user's own document; a failure must never damage it or lose work.

**Independent Test**: Make the PDF read-only, attach a file: the attach is refused with the reason and no icon is created. Fill the disk during a write: the PDF on disk is byte-identical to before.

**Acceptance Scenarios**:

1. **Given** a PDF that fails the existing write check, **When** the reader tries to attach, **Then** the attach is refused, no icon is created, nothing is kept in the app, and the reader is told why (read-only, encrypted, signed, app copy, changed on disk).
2. **Given** a signed PDF, **When** the reader attaches, **Then** the existing confirmation for writing to a signed file is asked first; declining writes nothing.
3. **Given** a write that fails at any point (disk full, I/O error, app quit or crash during the write), **When** the PDF is opened afterwards, **Then** it is either exactly the previous version or the complete new one — never partly written — and all its earlier annotations are present.
4. **Given** a failed write, **When** the reader looks at the app, **Then** the other annotations not yet written to the file are still there and still pending.

---

### User Story 6 - Export and compatibility (Priority: P3)

A reader exports the PDF with annotations, or opens the file in Foxit or Adobe Acrobat, and the attachment is still there.

**Why this priority**: The value of storing the file inside the PDF is that it travels with it; but the in-app loop comes first.

**Independent Test**: Export a PDF with one attachment; open the exported file in Readmate and pdf.js: the attachment is present and its content is identical. Then follow the manual compatibility kit in Foxit and Acrobat and record results.

**Acceptance Scenarios**:

1. **Given** a PDF with Readmate-made attachments, **When** the reader uses "Export PDF with annotations…", **Then** the new file contains each attachment with identical content and position.
2. **Given** a Readmate-made attachment, **When** the file is read by pdf.js (outside the app's own model), **Then** it is reported as a page FileAttachment with the right page, name and content.
3. **Given** a test environment with Foxit and/or Adobe Acrobat, **When** a Readmate-made file is opened there, **Then** the result (icon shown, file listed, file opened/saved, content identical) is recorded per reader and version. Compatibility is claimed only for combinations actually tested.
4. **Given** a file attached in Foxit or Acrobat, **When** it is opened in Readmate, **Then** the recorded result covers icon shown, listed, opened/saved with identical content.

---

### Edge Cases

- **Same name**: several attachments with the same file name (on one page, several pages, or page + document) are all kept and distinguished; none replaces another. Saving two of them to the same folder asks before replacing (system dialog).
- **Invalid or hostile names / metadata in a PDF from elsewhere**: path parts, `..`, control / bidi / zero-width characters, reserved device names, absurd length, wrong or missing MIME type, size claims that disagree with the data, huge description — the name is sanitised (existing policy), MIME claims are ignored, sizes are taken from the actual data, nothing is ever written outside the folder the user chose.
- **The name of the picked file** itself is sanitised the same way before being stored.
- **Executable or script file picked**: may be attached (it is the user's choice), but opening it later is blocked exactly like any other blocked attachment (Save As only).
- **Many attachments**: listing keeps the existing 500 cap; creating beyond it is not blocked but the list says some are not shown.
- **Large PDF + large attachment**: if the write cannot be completed within the app's memory limits, it is refused with a clear message and the PDF is unchanged (see Questions for planning Q-P1).
- **PDF changed by another program while attaching**: detected by the existing "unchanged since read" check; nothing is written over the other program's version.
- **Rotated / cropped pages**: the icon appears where the reader clicked on the displayed page and stays there after reopening, in Readmate and in pdf.js.
- **Page deleted / PDF replaced by another version**: the attachment follows the file; if the file no longer has it, it is not shown.
- **Tool clicked on empty space between pages**: no picker opens.
- **Encrypted PDF**: cannot be written (existing rule); attachments already inside one that pdf.js cannot open report an error as today.
- **Disk full / temp folder unavailable when opening**: a clear error; no partial file is left behind.
- **App-owned (managed) PDF copy** (from URL / cloud): the attach is refused like for any non-writable file (FR-012).
- **Moving a Readmate-made icon when the PDF has become unwritable**: the move is refused with the reason and the icon stays where it is in the file.

## Requirements *(mandatory)*

### Functional Requirements

**Scope and entry points**

- **FR-001**: The File Attachment tool MUST be offered only for PDF books, in the group of PDF annotation tools. No other format shows it, and no other format gains any attachment UI or backend.
- **FR-002**: With the tool selected, a click on a page MUST open the system file picker (one file, any type); a cancelled picker MUST change nothing.

**Storing in the PDF**

- **FR-003**: An attachment MUST be stored inside the PDF as a standard page-level File Attachment annotation whose file specification carries the file's full content as an embedded file (with its name, size, and creation / modification dates when known). A path to the file on the user's computer MUST NOT be stored as a substitute for the content.
- **FR-004**: The PDF MUST be updated by appending an incremental update, as for every other annotation Readmate writes: the original bytes are kept unchanged.
- **FR-005**: The written annotation MUST carry Readmate's own annotation identity (as other Readmate-made annotations do) so it is recognised as Readmate-made when read back, and MUST have a visible icon (its own appearance), so readers that draw only appearances still show it.
- **FR-006**: Every write MUST be read back and verified (the attachment is found on the right page with the expected content fingerprint) before it is reported as stored.
- **FR-007**: A write MUST replace the PDF atomically: on any failure (I/O error, disk full, crash, quit) the file on disk is the previous version, intact; no temporary file is left behind after a failure.
- **FR-008**: Adding, moving or deleting an attachment MUST NOT change or remove any other annotation or attachment, in the file or in the app.

**Position**

- **FR-009**: The icon's position MUST be stored as the page (number) plus the icon's box relative to the displayed page, in the same normalised form other PDF annotations in Readmate use; in the file it MUST be the corresponding rectangle in the page's own coordinates, so other readers show it in the same place (also on rotated or cropped pages).
- **FR-010**: The icon MUST have a fixed size on the page (like a sticky-note icon), be placed with its top-left at the clicked point and kept wholly inside the page.

**Limits and validation of the picked file**

- **FR-011**: The picked file's size MUST be checked before its content is read and before any write starts. Files larger than 100 MB (104 857 600 bytes) and empty files MUST be refused; the message MUST show the actual size and the limit. The limit is a Readmate product choice, MUST be defined in one place so it can be changed later, and MUST NOT be presented as a limit of PDF, Foxit or Acrobat. No total-size limit across attachments is set.
- **FR-012**: When the PDF fails the existing write check (not the user's own file, read-only, encrypted, signed without confirmation, changed since read), the attach MUST be refused with the reason before the file picker opens (re-checked before the write); nothing is kept in the app (no pending state, no app-owned copy of the content). The tool MAY be shown disabled with the reason when the check already fails on open.
- **FR-013**: The content stored MUST be exactly the content that was size-checked: if the file changes or vanishes while being read, the attach MUST be refused.
- **FR-014**: The file's content SHOULD NOT be held in memory more times than necessary; streaming or a safe temporary copy MUST be used where the writing approach allows it. Whether a 100 MB attachment can be written into large PDFs within the app's memory limits MUST be measured before the design is fixed (Q-P1); a write that would exceed them MUST be refused cleanly, never crash the app.

**Opening and saving out**

- **FR-015**: A single click on an icon MUST only select it (file name shown as a tooltip); a double-click, or Enter on a selected icon, MUST open the details panel, which MUST show the attachment's details (sanitised name, actual size, page, description if any) with Open and Save As; nothing is opened by the click itself. A right-click menu on the icon MUST offer Open, Save As and, for Readmate-made attachments only, Delete. A drag that starts on a selected icon moves it and never opens the panel.
- **FR-016**: Open MUST go through the existing confirmation, security policy (blocked types, no extension, executable content) and app-owned temporary copy; blocked files MUST offer Save As only. Nothing is ever opened or executed automatically.
- **FR-017**: Save As MUST write only to the location the user chose in a system save dialog, with the sanitised name proposed; it MUST NOT write anywhere else, MUST NOT follow names or paths from the PDF, and replacing an existing file MUST require the system dialog's confirmation.
- **FR-018**: Name, MIME type, size and dates read from a PDF MUST be treated as untrusted: names sanitised, MIME ignored, size taken from the actual data, the 100 MB limit applied to the actual data.

**Move and delete**

- **FR-019**: Deleting a Readmate-made attachment MUST ask for confirmation, then remove the annotation from the page so no reader shows or lists it any more. Because the PDF is only ever appended to, the file's earlier revision still contains the deleted content and the file does not get smaller; the delete confirmation MUST state this plainly (the file stays in the PDF's history and the PDF does not get smaller). No clean-copy or full-rewrite option is offered in this version.
- **FR-020**: Moving a Readmate-made icon (drag, same page) MUST update its position in the app and in the file without rewriting the file's content data.
- **FR-021**: Move MUST be undoable and redoable through the existing annotation history. Delete is not in the undo history in this version (it is confirmed instead).
- **FR-022**: Page attachments made by other readers MUST be shown with an icon and be openable / savable. Moving or deleting them MUST NOT be offered in this version (view, open and save only); their icon can be selected but shows no move handle or delete action.
- **FR-023**: Document-level attachments MUST NOT be created, moved or deleted; they keep today's list / open / save behaviour.

**Visibility and listing**

- **FR-024**: Each page attachment MUST appear in the Attachment tab and in the book's Notes list (file name, size, page); choosing it there goes to its page and selects the icon.
- **FR-025**: An attachment exists in the app only once it is in the file: the icon is shown as stored only after the write has been verified (FR-006); while the write runs the reader sees progress, and if it fails the attach is reported as failed and no icon remains. Attachments never take the "Not in the file" state. Moves and deletes likewise either reach the file or are refused / reported as failed, with the icon showing the file's actual state.

**Export and other features**

- **FR-026**: "Export PDF with annotations…" MUST produce a file that contains every attachment of the book with identical content and position.
- **FR-027**: The annotation export file of spec 006 does not carry attachments in this version; its readable copy MAY list them by name. Importing such a file never creates attachments.
- **FR-028**: Attachments MUST NOT be imported into the Library, indexed for search, or counted as reading content.

**Compatibility**

- **FR-029**: Interoperability MUST be verified with pdf.js automatically and recorded manually for Foxit and Adobe Acrobat when available (reader + version + result per check). No compatibility claim may be made for a reader or version that was not tested.

### Key Entities

- **Page attachment**: a file tied to a place on a page — page, icon box (normalised to the displayed page), file name (sanitised), size, content fingerprint, optional description, creation / modification time, origin (Readmate-made, editable; or made by another reader, view / open / save only). Its content lives only in the PDF.
- **Document attachment**: a file attached to the whole PDF, no position; read-only in this feature.
- **Attached file content**: the bytes of the picked file, 1 byte to 100 MB, stored once in the PDF; never referenced by path.
- **Attachment write**: one appended update to the PDF that adds, moves or removes page attachments together with any other pending annotation changes; succeeds entirely or leaves the file as it was.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reader can attach a file to a page in at most 3 actions after opening the PDF (select tool, click the page, pick the file).
- **SC-002**: In 100% of round-trip tests (attach, close, reopen, save out) the saved-out file is byte-identical to the picked file, for sizes 1 byte, 1 MB, 50 MB and 100 MB.
- **SC-003**: In 100% of injected-failure tests (disk full, I/O error, interrupted write) the PDF afterwards has the same fingerprint as before the attempt, or is the complete new version, and every earlier annotation is still present.
- **SC-004**: Attaching a 10 MB file to a 50 MB PDF completes (icon shown, stored in the file) within 5 seconds on the reference development machine; a 100 MB file into a 50 MB PDF completes or is refused cleanly without the app becoming unresponsive for more than 1 second at a time.
- **SC-005**: An over-limit pick is refused within 1 second, before the content is read, with the actual size and the limit in the message.
- **SC-006**: In a PDF with existing highlights, notes, shapes, typewriter notes and other readers' annotations, adding, moving and deleting attachments leaves 100% of them unchanged.
- **SC-007**: No attachment UI or behaviour is reachable for any non-PDF book (checked for every non-PDF format).
- **SC-008**: For hostile test PDFs (path traversal names, reserved names, executable content behind harmless names, false MIME / size claims), 0 files are written outside the user-chosen folder and 0 blocked files are opened.
- **SC-009**: A compatibility record exists for pdf.js and, where available, Foxit and Acrobat, listing for each check (icon shown, listed, opened, content identical, moved/deleted state) pass / fail / not tested.

## Assumptions

- Builds on the existing Attachment tab, security policy, temporary-copy opening and Save As (audit §1); those are reused, not rebuilt.
- "Saving the PDF" means the existing always-on writing of annotations into the user's own referenced PDF; there is no separate Save button.
- The icon is a single generic attachment icon (paper-clip / push-pin style); choosing among icon styles is not in this version.
- Only one file per click; folders cannot be attached.
- An optional description can be shown when present in the file; writing a description is not in this version.
- The 100 MB limit applies to each new attachment and, as today, to extraction.
- Moving an icon to another page is not in this version (only within its page).
- Delete is confirmed rather than undoable (undo would require keeping the deleted content).
- Foxit and Acrobat may not be available in the development environment; their checks are manual and recorded, never assumed.

## Questions for planning (to verify, not to guess)

- **Q-P1 Memory**: today's writer holds the whole PDF in memory as text, in a worker with a capped heap. Measure the largest PDF + 100 MB attachment that can be written; decide whether the embedded file must be written by streaming (append the file content directly to the output) instead.
- **Q-P2 Compression**: store the embedded file compressed or as is (size vs memory / time); and whether to record its checksum in the file specification.
- **Q-P3 Content in transit**: with no pending state (FR-012, FR-025), the content goes from the picked file straight into one write; decide whether a short-lived temporary copy is needed during the write (e.g. for streaming) and how it is removed on failure / crash.
- **Q-P4 Icon appearance**: which drawing is used so pdf.js, Foxit and Acrobat all show an icon; whether Readmate draws its own icon over pdf.js' canvas or relies on the appearance.
- **Q-P5 Identity**: existing attachment ids include a content hash and position; a Readmate-made attachment also has its annotation identity — define how the two are linked so a moved icon keeps one identity.
- **Q-P6 Storage of the app-side record**: whether the attachment needs a row in the existing annotation table (likely, as a new annotation kind, for Notes list / history / status) and whether that needs a migration or new IPC channel (prefer none, as for shapes and typewriter notes).
- **Q-P7 Live sync**: the existing scan of embedded annotations ignores FileAttachment; confirm how Readmate-made attachments read back on reopen without being imported twice.
