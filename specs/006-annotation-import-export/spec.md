# Feature Specification: Annotation Import and Export for Text Books

**Feature Branch**: `006-annotation-import-export`

**Created**: 2026-10-28

**Status**: Draft

**Input**: User description: "tôi muốn làm chức năng import và export annotation (note) cho các định dạng sách dạng văn bản, không phải audio book" (I want to build import and export of annotations (notes) for text-based book formats, not audiobooks.)

**Update 2026-10-28**: "chức năng import với export annotation với tất cả các định dạng (006), tạm ko gộp external sync" (annotation import and export for all formats; external sync is left out for now). Scope is every text format that has annotations. Audiobooks are explicitly excluded (they have no annotations in this sense; their Notes are a separate feature).

## Scope

Annotations here means everything a reader marks or writes on a text book: highlights, underline, squiggly, strikethrough, replace-text, insert-text, shapes (PDF), typewriter notes (PDF); and the comment attached to any of them. Export writes them to a separate file the reader keeps; import reads such a file back into a book.

| Format | Export / Import |
|--------|-----------------|
| EPUB | Yes |
| PDF | Yes |
| TXT | Yes |
| Audiobooks (MP3 and other audio formats) | No (this feature does not apply to audiobooks) |
| Markdown | Yes |
| DOCX, DOC | No (the reader does not create annotations on them yet; they are covered automatically once they do) |

Not in scope for now (external sync): importing annotations made by other apps (other than what the app already reads from inside a PDF), sharing or syncing through a cloud service or between devices automatically, and live exchange with other readers. Also out: bookmarks, reading position and reading statistics.

## Clarifications

### Session 2026-10-28

- Q: Which book formats are covered? → A: All text formats that have annotations: EPUB, PDF, TXT and Markdown. Audiobooks are excluded (confirmed by the user). DOCX/DOC have no annotations to move yet. (Markdown was added after the user showed it already draws and stores annotations; the older annotation support matrix doc is out of date on this.)
- Q: Is external sync (other apps, cloud, automatic sync) part of this? → A: No, deferred. Files are moved by the reader by hand through a system dialog.
- Q: Which file format does the restore-capable file use? → A: One plain-text JSON file per book, extension `.readmate-notes.json`, UTF-8; header (file version, app version, book title, author, format, content fingerprint) followed by the list of annotations; the reader can open it in any text editor.
- Q: What format does the readable copy use? → A: Markdown (`.md`): book title header, one heading per chapter or page in reading order, each annotation as a quote with kind, comment, colour tag and time.
- Q: Where are Export and Import started? → A: Both Reader and Library: the open book's More menu (for that book), the Library book's context menu (for that book), and a Library-level "Import annotations file…" that picks the file first and finds the book from its identity.
- Q: What does the import preview show? → A: Counts (target book, to add, already present, cannot be placed) plus a list of the annotations that cannot be placed (kind, quote, location in the file); the full list of those to be added is not shown.
- Q: Are annotations read from inside a PDF (made in other readers) exported? → A: Yes. Everything in the book's Notes list is exported, each marked with its origin (made in the app, or read from the PDF); import skips any that already exist.
- Q: Which formats, which file extensions, what does the data look like? → A: EPUB, PDF, TXT and Markdown. Import file: `.readmate-notes.json` (the Import dialog filters on it); readable copy: `.md` (not importable). Illustrative data: `samples/` in this folder (not normative; exact fields are decided in the plan).
- Q: Does import write into the book file? → A: No, not itself. For PDF the existing always-on two-way sync may append the imported annotations to the user's own PDF afterwards (confirmed: option A).
- Q: Does this replace the existing "Export PDF with annotations" (annotations written into a new PDF)? → A: No. That feature stays. This feature moves annotations as data between books and devices; it never changes the book file.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Export a book's annotations to a file (Priority: P1)

A reader who has highlighted and commented on a book opens the book's menu and chooses to export annotations. They pick where to save the file. The file holds every annotation of that book, with its quoted text, comment, colour, kind and place in the book, so it can be kept as a backup or moved to another device.

**Why this priority**: Export alone already protects the reader's work (backup) and is the base for every other story. Without it, import has nothing to read.

**Independent Test**: Annotate a book (several kinds, with comments), export, and check that the saved file exists and lists each annotation with its text, comment and kind.

**Acceptance Scenarios**:

1. **Given** an open EPUB, PDF, TXT or Markdown book with annotations, **When** the reader chooses Export annotations and picks a destination, **Then** a file is saved there and the reader is told how many annotations it holds.
2. **Given** a book with no annotations, **When** the reader opens Export annotations, **Then** the action is unavailable or says clearly that there is nothing to export; no empty file is created.
3. **Given** the save dialog is cancelled, **When** the reader returns to the book, **Then** nothing is written and nothing changed.
4. **Given** an audiobook is open, **When** the reader looks for the action, **Then** it is not offered.

---

### User Story 2 - Import annotations into the same book (Priority: P1)

A reader who exported annotations earlier (or lost them by reinstalling the app, or wants them on a second device that has the same book) chooses Import annotations, picks the file, and sees the annotations appear in the book exactly where they were.

**Why this priority**: Together with Story 1 this completes the round trip: backup and restore, and moving work between devices.

**Independent Test**: Export from a book, remove the annotations (or use a second library with the same book), import the file, and compare: same annotations, same places, same comments.

**Acceptance Scenarios**:

1. **Given** a file exported from a book and the same book in the library, **When** the reader imports it, **Then** a preview shows how many annotations will be added, and after confirming, they appear in the book at their original places with their comments and colours.
2. **Given** some annotations in the file already exist in the book, **When** the reader imports, **Then** those are not duplicated and the result says how many were added and how many were skipped as already present.
3. **Given** an import that has been confirmed, **When** it finishes, **Then** the book file itself is unchanged (for PDF, until the existing two-way sync runs; see FR-012), and if the book is open in the Reader its annotations appear at once without reopening it; a failed or rolled-back import changes nothing on screen.
4. **Given** a file that is not an annotations file or is damaged, **When** the reader picks it, **Then** the app says so in plain words and changes nothing.

---

### User Story 3 - Import into the right book (Priority: P2)

A reader imports a file while a different book is open, or from the library. The app works out which book the file belongs to and does not put annotations into a book they do not fit.

**Why this priority**: Wrong-book imports would corrupt a library; this protects the data but the basic flow works without it.

**Independent Test**: Export from book A; try to import into book B; confirm the app warns and requires a deliberate choice, and that nothing is written without it.

**Acceptance Scenarios**:

1. **Given** a file exported from book A and the library holds A, **When** the reader imports it from the Library, **Then** the app proposes A as the target and shows its title in the preview.
2. **Given** a file exported from book A, **When** the reader starts the import from the menu of another open book B, **Then** the preview names both books ("this file is from A; you started from B"), proposes A, and no import runs until the reader deliberately picks A or B; annotations of A are never put into B silently. The Reader and Library flows behave the same.
3. **Given** the file's book is not in the library, **When** the reader imports it, **Then** the app says which book is missing (title, author) and does not import into it; the reader may deliberately choose another book of the same format, which then follows scenario 4.
4. **Given** the reader chooses a target book whose content differs from the exported one (another edition, a different file), **When** the preview is shown, **Then** it states how many annotations fit and how many could not be placed under the placement rule in FR-011, and the reader decides whether to import the ones that fit.
5. **Given** the file's format differs from the target book's format, **When** the reader tries to import, **Then** the app refuses and explains why.

---

### User Story 4 - Export a readable copy (Priority: P3)

A reader wants their highlights and notes as plain readable text to paste into a notes app, send to someone, or print. They choose a readable export and get a document listing each annotation as a quote with its comment, grouped by chapter or page in reading order.

**Why this priority**: Useful for study and sharing but separate from restoring annotations; the main flows do not depend on it.

**Independent Test**: Export a readable copy of an annotated book and open it in any text viewer; confirm quotes, comments and locations read in book order with no special software.

**Acceptance Scenarios**:

1. **Given** an annotated book, **When** the reader chooses the readable export, **Then** the saved document lists annotations in reading order with kind, quote, comment and location (chapter or page).
2. **Given** annotations with Vietnamese or other non-Latin text, **When** exported, **Then** the text appears intact.
3. **Given** the readable copy, **When** the reader tries to import it, **Then** the app explains that only the restore-capable export can be imported.

---

### Edge Cases

- A book with thousands of annotations: export and import finish without freezing the app and show progress.
- The book file is missing or moved: export still works from stored data. Import into that book is refused with a message to relink the book first, and nothing is written.
- A PDF whose annotations are also embedded in the file: imported ones that match annotations already read from the file are not duplicated.
- A PDF locked from writing (encrypted, signed, read-only): the import still stores annotations in the app; they are held back from the file the same way as annotations created in the app.
- A Markdown book: annotations are anchored to the rendered piece and offset, which only mean something on identical content; on a different edition they are reported as not placed, not re-anchored.
- A TXT book that was edited in the app: the export file stores the content fingerprint of the text it was made from, not the text itself. If the target's current text has that fingerprint, annotations are placed at their exact offsets; if not, each is re-anchored by its quote and context, and any that cannot be matched with confidence is reported as not placed, never guessed.
- An annotation whose quote can no longer be found in the book (different edition): it is listed as "could not be placed" and is not added silently at a guessed position.
- Importing the same file twice: the second import adds nothing and says so.
- A file exported by a newer app version: the app says the file needs a newer version instead of importing a partial result.
- The destination folder is not writable or the disk is full: the reader gets a clear error and no partial file is left behind.
- Import is cancelled midway: either all annotations of that import are present or none are.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to export all annotations of one open EPUB, PDF, TXT or Markdown book to a file they choose the location of.
- **FR-002**: The exported file MUST contain, for each annotation, its kind, quoted text (where the kind has one), the comment, colour and style, created and modified times, and enough information to find the same place in the same book again.
- **FR-003**: The exported file MUST identify the book it came from (title, author, format and a fingerprint of the content) and the app version that wrote it.
- **FR-004**: Users MUST be able to import such a file into a book of the same format, after a preview of what will be added.
- **FR-005**: The import preview MUST show the target book, the number of annotations to add, the number already present, and the number that cannot be placed. It MUST also list each annotation that cannot be placed with its kind, quote and location recorded in the file; the annotations to be added are shown by count only.
- **FR-006**: Importing MUST NOT create duplicates: an annotation that already exists in the book (same kind, place and content) is skipped, and importing the same file twice adds nothing the second time.
- **FR-007**: An imported annotation MUST be indistinguishable from one made in the app: it appears in the reader (immediately, if the book is open), in the Notes list, can be edited and deleted, and (for PDF) follows the existing rules for being written into the PDF.
- **FR-008**: Import MUST be all-or-nothing per run: if it fails or is cancelled, the book's annotations remain exactly as before.
- **FR-009**: Existing annotations MUST NOT be changed or removed by an import.
- **FR-010**: The system MUST identify the book a file belongs to from the file's identity, in every import flow (Reader menu and Library). When that book differs from the book the import was started from, or is not in the library, the preview MUST say so, name both books, and the import MUST NOT run until the reader deliberately chooses the target. It MUST refuse to import across different formats.
- **FR-011**: When the target's content has the same fingerprint as the exported one, annotations are placed at their stored locations. When it differs: TXT annotations are placed only if their quote and surrounding context can be matched with confidence in the target's text; Markdown and EPUB annotations are placed only on identical content; PDF annotations only when the file is the same document (same title and author, and the page count is known on both sides and equal) and the stored page number lies within the target's page count. If either page count is unknown, PDF annotations from a different file are not placed. Every other annotation MUST be reported as not placed, by number and in a list. The system MUST NOT place annotations at guessed positions and MUST NOT search Markdown, EPUB or PDF content to re-anchor them.
- **FR-012**: Export MUST never modify the book file, and import MUST NOT write to it itself. For PDF, annotations that the import stores in the app are written into the reader's own PDF only afterwards, by the existing always-on two-way sync under its usual checks; EPUB, TXT and Markdown files are never written.
- **FR-013**: The system MUST reject files that are not valid annotation exports (including a readable `.md` copy, which it names as not importable), are damaged, or come from a newer incompatible version, deciding this from the file's content in Main and not from the file picker's filter, with a plain-language message and no change to the book.
- **FR-014**: Users MUST be able to export a readable copy of a book's annotations (quotes, comments, locations in reading order) that opens in any text viewer; this copy is for reading and is not importable.
- **FR-015**: Exported text MUST preserve Vietnamese and other Unicode content exactly, in both file types.
- **FR-016**: Export and import MUST show progress for large books and MUST NOT block reading or navigating elsewhere in the app.
- **FR-017**: Export and import MUST be offered for EPUB, PDF, TXT and Markdown, and MUST NOT be offered for audiobooks or for formats without annotations.
- **FR-018**: The reader MUST never be shown or asked for a file-system path of the book; choosing the file to save or open happens in a system dialog.
- **FR-019**: The result of every export and import MUST be reported with counts (exported, added, skipped as present, not placed).
- **FR-021**: The feature MUST NOT read from or write to other apps' formats, cloud services or any automatic sync channel; the reader moves files by hand.
- **FR-022**: The restore-capable export MUST be a single UTF-8 JSON text file named `<book title>.readmate-notes.json` by default, openable in any text editor, with a file-version field so later app versions can read older files.
- **FR-023**: The readable copy MUST be a UTF-8 Markdown file named `<book title>.md` by default: a title header, one heading per chapter (EPUB), page (PDF) or section by position (TXT, Markdown) in reading order, and under each heading every annotation as a quoted passage followed by its kind, colour tag, comment and time.
- **FR-024**: Export and Import MUST be reachable from the open book's More menu (acting on that book), from the Library book's context menu (acting on that book), and from a Library-level "Import annotations file…" action that picks the file first and proposes the target book from the file's identity.
- **FR-025**: The export MUST include every annotation in the book's Notes list, including PDF annotations read from the file, each tagged with its origin (app or file); import MUST treat an imported file-origin annotation that matches one already read from the PDF as already present. For PDF the origin tag (made in the app / read from the file) is best effort: when it cannot be determined reliably from the stored data, the annotation is tagged as made in the app and keeps its PDF annotation name if known.

### Key Entities *(include if feature involves data)*

- **Annotation**: A mark or note on a text book: kind (highlight, underline, squiggly, strikethrough, replace, insert, shape, typewriter), place in the book, quoted text, comment, colour/style, created and modified times.
- **Annotation Export File**: A single file holding the annotations of one book, plus the book's identity and the writing app's version. It can be imported back.
- **Readable Export**: A human-readable document built from the same annotations, ordered by position; read-only.
- **Book Identity**: Title, author, format and content fingerprint, used to match an export file to a book in the library.
- **Import Preview**: The summary shown before an import is confirmed: target book, annotations to add, already present, not placeable.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reader can export a book's annotations in under 30 seconds from opening the menu to seeing the confirmation, for a book with up to 1,000 annotations.
- **SC-002**: Exporting from a book and importing into the same book on a clean library restores 100% of annotations with the same kind, place, quote, comment and colour.
- **SC-003**: Importing a file twice yields zero duplicate annotations.
- **SC-004**: A book with 5,000 annotations imports in under 1 minute and the app stays responsive while it runs: no single stall of the application's main process longer than 1 second (measured as in tasks T041).
- **SC-005**: In 100% of failed or cancelled imports, the book's annotations are identical to those before the attempt.
- **SC-006**: In 100% of export runs, and in 100% of import runs for EPUB, TXT and Markdown, the book file is byte-for-byte unchanged; for PDF it is unchanged by the import itself, before the existing two-way sync runs.
- **SC-007**: Vietnamese text in quotes and comments survives export and import with zero character differences.
- **SC-008**: When importing TXT annotations into a different edition of a book, no annotation is placed at a position that does not contain its quoted text; Markdown, EPUB and PDF annotations are never re-anchored by search.
- **SC-009**: A first-time user completes an export, then an import into a second copy of the book, without help, on their first attempt.

## Assumptions

- Annotation data lives in the app's own storage today; export reads from there and import writes there. The book file is never the destination, except where the existing PDF two-way sync already writes annotations into the reader's own PDF.
- The restore-capable export is one file per book. Exporting the whole library at once is a possible later addition and is out of scope.
- The restore-capable file (`.readmate-notes.json`) is meant to be read by this app only; it is plain JSON but not an interchange standard with other readers. The readable copy covers sharing with people and other tools.
- "Same book" is decided by the content fingerprint first, then by title, author and format; the reader may pick a different target and then relies on the quote-matching rule.
- Bookmarks, reading position and statistics are not included; only annotations and their comments.
- One file format and one flow serve every supported format; only the "place in the book" differs per format.
- Existing local annotations win over imported ones when they describe the same thing; the import never edits or deletes an existing annotation.
- Desktop only for this release; mobile is not built out yet.
- The app's existing annotation kinds per format (see `docs/implementation_plan/annotation_support_matrix.md`) define what exists to export; annotation kinds added later are exported by the same mechanism.
