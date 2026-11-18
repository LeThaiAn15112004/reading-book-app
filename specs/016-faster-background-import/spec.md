# Feature Specification: Faster import that runs in the background

**Feature Branch**: `016-faster-background-import`

**Created**: 2026-11-19

**Status**: Draft

**Input**: User description: importing a book takes long and opening a book takes long; fix the system first, then let a
large import run in the background so the reader can keep using the app while a progress indicator shows the import
(Vietnamese description, summarised from the analysis of 2026-11-19 — steps 0, 1 and 2 of that analysis).

## Context (current behaviour)

A reader adds a book with Import → "Add file" (or from a URL / a linked cloud folder). Today:

- While the book is imported, a dialog covers the Library and says only "Importing…": no percentage, no step, no way
  to do anything else. For a large file this can last a long time.
- To import one book from the reader's disk, the app reads the whole file several times (it fingerprints the file to
  find duplicates, then fingerprints it again while reading its details, then reads it once more to check for a
  digital signature). An EPUB is read and unpacked twice more.
- Right after an import, books without a cover image (PDF, TXT, Markdown) have their first page drawn as a cover: the
  app reads the whole book again and sends all of it to the screen just to draw one page, then reloads the whole
  Library list.
- Opening a book in the reader also reads, fingerprints and copies the whole file before the first page appears, and
  background work (search index, word count, signature check) starts on the same file at the same moment.

None of this has been measured yet: the analysis comes from reading how the app works, not from timings.

**This feature covers**: measuring where the time goes (step 0), removing the repeated work during import and right
after it (step 1), and a non-blocking, background import with visible progress (step 2).

**Not in this feature**: opening a book progressively (reading only the part of the file the current page needs, step 3
of the analysis). It changes how annotations are written back into PDFs and needs its own feature. Work that this
feature moves out of the way of opening a book (FR-012) is the only opening-related change here.

## Clarifications

### Session 2026-11-19

- Q: Which hosts? → A: Desktop and the phone. The background progress card, queue and placeholder are the same on both;
  the phone's copy of each book into app storage is one of the measured and optimised steps (FR-002, FR-003).
- Q: Several files at once? → A: Yes — "Add file" lets the reader pick several files at once; they are imported one
  after another in the queue, each with its own result.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Know where the time goes (Priority: P1)

Before anything is changed, the team runs the existing import and open on a few real books (a large PDF, a large EPUB,
a small book) and gets the time of each step, so the fixes target the slow steps and can be compared before / after.

**Why this priority**: Every other story is a guess until this exists; it also gives the baseline that the success
criteria are measured against.

**Independent Test**: Import and open each sample book with timing turned on; a report lists, per book and step, the
time taken. Turning timing off leaves no trace in the app.

**Acceptance Scenarios**:

1. **Given** timing is turned on, **When** a book is imported, **Then** the time of each step (duplicate check, reading
   the book's details, signature check, saving to the library, cover drawing) is recorded with the file's size and
   format.
2. **Given** timing is turned on, **When** a book is opened, **Then** the time until the first page is shown, and the
   time of each step before it, is recorded.
3. **Given** timing is off (the default for readers), **When** books are imported or opened, **Then** nothing is
   recorded and nothing changes for the reader.
4. **Given** the recorded timings, **When** the team reviews them, **Then** they contain no book title, file name or
   folder path — only format, size and durations.

---

### User Story 2 - Import a book without the app doing the same work twice (Priority: P1)

The reader picks a large book; the app reads the file as few times as it can, so the book appears in the library
sooner. Nothing the reader sees about the book changes: same details, same cover, same duplicate detection.

**Why this priority**: It is the root cause of the slowness and it is low risk: the result of an import stays the same.

**Independent Test**: Import the sample books from story 1 and compare with the baseline: each imports faster, the
library entry (title, author, format, size, cover, duplicate detection) is identical to before.

**Acceptance Scenarios**:

1. **Given** a book file, **When** it is imported, **Then** its fingerprint is computed once and reused for the
   duplicate check and for the library entry.
2. **Given** an EPUB, **When** it is imported, **Then** its contents are unpacked once for its details and cover.
3. **Given** a PDF, **When** it is imported, **Then** the book appears in the library without waiting for the digital
   signature check; the check then runs in the background, and until it ends the book shows the existing "not checked
   yet" signature state.
4. **Given** a book without a cover image, **When** its cover is drawn after the import, **Then** the app does not send
   the whole book to the screen to do it, and the Library list is not reloaded as a whole for each cover.
5. **Given** the same file is imported twice, **When** the second import runs, **Then** it is still recognised as a
   duplicate exactly as today.

---

### User Story 3 - Keep using the app while a book imports (Priority: P1)

The reader starts an import of a large book and immediately goes back to reading, browsing or searching. A small
progress card shows the import; when it ends, the reader can open the new book from the card or from the message that
appears.

**Why this priority**: Even after story 2, a very large file takes time; the reader must never be stuck in front of a
dialog. This is the user's explicit request. It applies to Desktop and the phone alike.

**Independent Test**: Start importing a large book, then open another book and read for a while, change Library filters
and open Settings; the import keeps going, its progress is visible, and the new book appears when it ends.

**Acceptance Scenarios**:

1. **Given** the reader picked a file, **When** the import starts, **Then** no dialog blocks the app; a progress card
   shows the file name, the current step ("Checking for duplicates", "Reading book details", "Saving") and, while the
   file is being read, a percentage.
2. **Given** an import is running, **When** the reader navigates to the Reader, Collections, Settings or another
   Library view, **Then** the progress stays visible (or reachable in one action) on every screen and the import goes on.
3. **Given** an import is running, **When** the reader looks at the Library, **Then** the coming book is shown as a
   placeholder ("Importing…", no cover yet) that cannot be opened, edited or deleted until it is saved.
4. **Given** an import ended successfully, **When** it ends, **Then** the placeholder becomes the real book and a
   message offers "Open"; the progress card shows it as done and can be dismissed.
5. **Given** an import failed (damaged file, unreadable file, no space, unsupported format), **When** it fails, **Then**
   the card says why in plain words and offers "Try again" (when it can help) and "Dismiss"; no placeholder stays in
   the Library.
6. **Given** the file is already in the library, **When** the duplicate check ends, **Then** no new entry is created
   and the card offers to open the existing book, as today's duplicate message does.
7. **Given** an import is running, **When** the reader presses "Cancel" on the card, **Then** the import stops, nothing
   is added to the library and no file the import created is left behind; the reader's own file is never touched.
8. **Given** an import is running, **When** the reader starts another import, **Then** the new one waits in line and
   starts when the previous one ends; the card shows how many are waiting.
9. **Given** "Add file", **When** the reader picks several files at once, **Then** each file becomes its own import in
   the queue, in the order shown by the picker; when all are done the card sums up how many were added, were already in
   the library and failed, and lists each failure with its cause.
10. **Given** the phone, **When** the reader imports a book, **Then** the same progress card, queue and placeholder are
   shown, the card stays clear of the bottom navigation and the system gesture area, and the system Back does not
   cancel the import.

---

### User Story 4 - Opening a book is not slowed by background work (Priority: P2)

The reader opens a book; the background work that the app does on books (search index, word count, signature check,
cover drawing, a background import) does not run on that book's file at the same moment as the first page is prepared.

**Why this priority**: It removes a known competition at the moment the reader waits most, without changing how a
book is opened (that is a later feature).

**Independent Test**: Open the large sample books with the background work of story 1 timed: the time until the first
page appears is not longer than the baseline, and background work on that book starts only after the page is shown.

**Acceptance Scenarios**:

1. **Given** a book is being opened, **When** the first page is not shown yet, **Then** no search indexing, word count
   or signature check starts on that book.
2. **Given** a background import is running, **When** the reader opens another book, **Then** the import does not make
   the first page appear later than the same open without an import, by more than the margin in SC-005.

---

### Edge Cases

- The reader quits the app while an import runs: on the next start nothing half-imported is in the library and no
  leftover file from that import remains; the reader's own file is untouched.
- The reader's file is moved, renamed or changed while it is being imported: the import fails with "the file changed or
  is no longer there" and adds nothing.
- The disk runs out of space during an import of a downloaded book (URL / cloud): the import fails, the partial copy is
  removed.
- A very large file (several hundred MB): the progress percentage keeps moving; the app stays responsive.
- Two imports of the same file are queued: the second one is reported as a duplicate of the first once the first is
  saved.
- The reader removes a book while its signature check is still running in the background: the check stops quietly and
  nothing is written for that book.
- The signature check fails or is interrupted: the book keeps "not checked yet" and is checked again the next time the
  signature is asked for (existing behaviour).
- An audiobook ZIP picked through "Add file": keeps its own preview and background job (unchanged).
- The interface language is English or Vietnamese: every new text is translated; file names and book titles are never
  translated.

## Requirements *(mandatory)*

### Functional Requirements

**Measuring (step 0)**

- **FR-001**: The team MUST be able to turn on timing of import and open steps (off by default for readers), recording
  per step the duration, the file's format and size, and nothing that identifies the book (no title, file name or
  path).
- **FR-002**: Timing MUST cover at least: duplicate check, reading the book's details, signature check, saving to the
  library, cover drawing, on the phone the copy of the book into app storage, and, for opening, every step until the
  first page is shown — on Desktop and on the phone.

**Less repeated work (step 1)**

- **FR-003**: An import MUST compute the file's fingerprint once and use that one value for the duplicate check, the
  library entry and anything else that needs it during that import. On the phone, where every book is copied into app
  storage, the file MUST NOT be read again after the copy just to fingerprint it when the fingerprint can be computed
  while copying.
- **FR-004**: Importing an EPUB MUST unpack it once for its details and its cover.
- **FR-005**: The digital signature check of an imported PDF MUST NOT delay the book's appearance in the library: it
  runs after the book is saved, in the background, and the book shows the existing "not checked yet" state until it
  ends. A failed or interrupted check leaves "not checked yet" (never "unsigned").
- **FR-006**: Drawing the cover of a book without a cover image MUST NOT send the whole book to the screen, and MUST
  update only that book's entry in the Library instead of reloading the whole list.
- **FR-007**: The result of an import MUST be unchanged by FR-003…FR-006: same title, author, format, size, page count,
  description, genres, cover and duplicate detection as before this feature, for every supported format.

**Background import with progress (step 2)**

- **FR-008**: Starting an import (Add file, From URL, cloud download) MUST NOT block the app: after the file is chosen
  the reader can use every screen while the import runs.
- **FR-009**: A progress indicator MUST be visible or reachable in one action from every screen while an import runs,
  showing the file name, the current step, a percentage while the file is read or downloaded, the number of imports
  waiting, and a Cancel action.
- **FR-010**: While a book is being imported, the Library MUST show it as a placeholder that cannot be opened, edited,
  added to a collection or removed; on success it becomes the real book, on failure or cancel it disappears.
- **FR-011**: Imports MUST run one at a time; an import started while another runs waits in line (first started, first
  run), and each queued import can be cancelled before it starts.
- **FR-011a**: "Add file" MUST let the reader pick several files at once; each becomes its own queued import. When a
  batch ends, the reader MUST get one summary (added / already in the library / failed) with each failure's cause, and
  "Open" when exactly one book was added.
- **FR-012**: On success the reader MUST be told (with "Open"); on a duplicate the reader MUST be offered the existing
  book; on failure the reader MUST be told the cause and offered "Try again" when retrying can help. These messages are
  announced to screen readers without moving focus.
- **FR-013**: Cancelling, failing or quitting the app during an import MUST leave the library and the app's storage as
  if the import never started (no entry, no app-owned copy, no cover); the reader's own file is never modified, moved
  or deleted.
- **FR-014**: The existing audiobook ZIP import (preview + its own background job) MUST keep working as today; the two
  kinds of import MUST NOT run their heavy work at the same time.

**Opening without competition**

- **FR-015**: While a book is being opened and its first page is not shown yet, the app MUST NOT start search indexing,
  word count or a signature check on that book; they start after the first page is shown.

**Quality**

- **FR-016**: All new interface text MUST exist in English and Vietnamese; file names and book titles are never
  translated.
- **FR-017**: The progress card and placeholder MUST follow the current theme, be readable (text ≥ 4.5 : 1), be usable
  with the keyboard, and on the phone have targets of at least 44 × 44 px and stay clear of the bottom navigation and
  the system gesture area.
- **FR-018**: Background import, progress card, queue, placeholder and the batch summary MUST work the same on Desktop
  and on the phone (one shared interface); host-specific differences are limited to where the card sits and to the
  phone's copy step.

### Key Entities

- **Import job**: one requested import — its source (the reader's file, a URL, a cloud file), file name shown to the
  reader, state (waiting, running, done, duplicate, failed, cancelled), current step, progress (bytes done / total
  when known), the resulting book (on success) or the cause (on failure). Session-only: never stored across launches.
- **Import queue**: the ordered list of import jobs of this session; one runs at a time. A pick of several files adds
  one job per file and forms a batch whose summary is shown when its last job ends.
- **Placeholder book**: what the Library shows for a running or waiting import job; not a library entry.
- **Step timing**: one measured step (name, format, size, duration); only when timing is turned on.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For each sample book of story 1, a timing report gives the duration of every step listed in FR-002, before
  and after the change.
- **SC-002**: Importing each large sample book (PDF and EPUB) from the reader's disk takes at least 40 % less time than
  its baseline, with an identical library entry.
- **SC-003**: After choosing a file, the reader can use the app (navigate, open another book) within 1 second, for any
  file size.
- **SC-004**: During an import of a file of several hundred MB, the progress shown changes at least every 2 seconds, and
  the app answers a click or a key press within 200 ms.
- **SC-005**: Opening a book while another book is imported in the background shows the first page no more than 20 %
  later than the same open with nothing running; and opening a book right after its import is not slower than the
  baseline.
- **SC-006**: In 20 cancelled or failed imports (including quitting the app mid-import), 0 library entries, 0 app-owned
  copies and 0 covers are left behind, and the reader's files are unchanged (same fingerprint).
- **SC-007**: In a check of 10 users importing a large book, every user finds the import's progress and can open the new
  book when it ends without help.
- **SC-008**: Picking 20 books at once adds them all in one action (no further step per book), and the summary's
  counts match the library exactly; the same holds on the phone.
- **SC-009**: On the phone, importing each large sample book takes at least 30 % less time than its baseline (the copy
  into app storage included).

## Assumptions

- The sample books for story 1 are chosen by the team (at least one PDF and one EPUB above 100 MB, and one small book);
  real slow cases reported by the user are added when available. The success percentages of SC-002 are reviewed after
  story 1's report and may be lowered if the measured baseline shows the repeated reads are not the main cost.
- Timing output is for developers only (logs or a report file, off by default); it never reaches other people.
- The pattern of the existing audiobook ZIP background job (dialog closes at once, a job card with progress, cancel and
  result) is the reference for the progress card and queue; the card replaces today's blocking "Importing…" dialog.
- Today's duplicate rule (same fingerprint = same book) and today's failure messages stay; only when they appear changes.
- The signature status values and their meaning are unchanged; only the moment of the check at import moves.
- The library entry is created only once the book is fully imported (no "half" book in the library); the placeholder
  is a display of the running job, not stored.
- Opening a book progressively (only the bytes the current page needs) is a separate, later feature because it changes
  how annotations are written back into PDFs.
- Reading position, annotations, collections and every other per-book data are unaffected.
- On the phone, picking several files uses the system file picker's multi-selection; URL and cloud imports stay one
  book per action (they join the same queue).
