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
- On the phone, an import copies the picked file into app storage through the app, then reads the whole copy again to
  fingerprint it, and an EPUB is then handed whole to the interface to read its details.
- Opening a book in the reader also reads, fingerprints and copies the whole file before the first page appears, and
  background work (search index, word count, signature check) starts on the same file at the same moment.

None of this has been measured yet: the analysis comes from reading how the app works, not from timings.

**This feature covers**: measuring where the time goes (step 0), removing the repeated work during import and right
after it (step 1), and a non-blocking, background import with visible progress (step 2).

**Not in this feature**: opening a book progressively (reading only the part of the file the current page needs, step 3
of the analysis). It changes how annotations are written back into PDFs and needs its own feature. Work that this
feature moves out of the way of opening a book (FR-015) is the only opening-related change here.

## Clarifications

### Session 2026-11-19

- Q: Which hosts? → A: Desktop and the phone. The background progress card, queue and placeholder are the same on both;
  the phone's copy of each book into app storage is one of the measured and optimised steps (FR-002, FR-003).
- Q: Several files at once? → A: Yes — "Add file" lets the reader pick several files at once; they are imported one
  after another in the queue, each with its own result.
- Q: What happens when the reader quits or closes the window while imports run? → A: Closing the window follows the
  existing Run in Background setting (kept running → imports continue). Quitting completely while imports are running
  or waiting asks first; if confirmed, they are cancelled and cleaned up (FR-013a).
- Q: On the phone, what happens to an import when the reader leaves the app? → A: It continues while the system allows
  it; if the system stopped it, on return the interrupted file shows "Interrupted" with "Try again", waiting files
  resume on their own, and nothing half-imported is left (FR-013b). No native background service.
- Q: How many files may one "Add file" pick hold? → A: Up to 50; picking more adds the first 50 and says the rest
  were not added ("Pick at most 50 files at a time") (FR-011a).
- Q: Can an import still be cancelled during its last step, "Saving"? → A: No — Cancel works in every step before
  "Saving"; during "Saving" it is disabled ("Finishing…") and the import completes (FR-009).

### Session 2026-11-21

- Q: On the phone, which import steps stop reading the whole file and work by path instead? → A: All of them — the copy
  into app storage is a system copy by path, the fingerprint is one read of that copy by path in parts, and an EPUB's
  details are read from the needed parts of the file by path; no import step holds the whole file in memory or sends it
  whole to the interface (FR-003, FR-004a).
- Q: On the phone, if the system ends the app completely during an import, does the next launch remember the queue? →
  A: Yes — the phone keeps a small list of unfinished import jobs (shown name, source, state, order; never file bytes).
  On the next launch the leftover staging is cleaned first, the job that was running shows "Interrupted" with "Try
  again", and waiting jobs continue; a waiting job whose picked file can no longer be read also shows "Interrupted"
  (FR-013b).
- Q: How do the audiobook ZIP import and the new import queue relate, and what about a ZIP among several picked files?
  → A: One shared queue — the ZIP keeps its own preview; pressing Import there adds its job at the end of the same
  queue, shown on the same progress card. A ZIP among several picked files is left out of the batch and the reader is
  told to pick it on its own to see its preview (FR-014).
- Q: Which groups does the batch summary count? → A: Five — added, already in the library, failed (each with its
  cause), cancelled, interrupted (with "Try again"); a group with 0 is hidden; the counts always add up to the number
  of files queued in that batch (FR-011a).
- Q: Are the 40 % / 30 % speed-ups fixed gates or set after the baseline? → A: Defaults; they may be lowered only after
  story 1's report shows the repeated reads are not the main cost, with the new figure and its reason written under the
  criterion before story 2 starts — from then on it is a fixed gate. "Not slower than the baseline" in SC-005 allows
  5 % (SC-002, SC-005, SC-009).

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
   During the last step ("Saving") Cancel is disabled and shows "Finishing…"; the import then completes.
8. **Given** an import is running, **When** the reader starts another import, **Then** the new one waits in line and
   starts when the previous one ends; the card shows how many are waiting.
9. **Given** "Add file", **When** the reader picks several files at once, **Then** each file becomes its own import in
   the queue, in the order shown by the picker; when all are done the card sums up how many were added, were already in
   the library, failed (each failure with its cause), were cancelled and were interrupted, hiding the groups with 0;
   the counts add up to the number of files queued.
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

- The reader quits the app while an import runs: the app asks first (FR-013a); if the reader confirms — or the app is
  ended without asking (crash, system shutdown) — on the next start nothing half-imported is in the library and no
  leftover file from that import remains; the reader's own file is untouched.
- The reader closes the window while an import runs: with Run in Background on, the app keeps running and the import
  continues; the result is shown when the window is opened again. With it off, closing is a quit (FR-013a).
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
- On the phone the reader switches to another app or the screen turns off during an import: the import goes on while
  the system lets the app run; if the system paused or stopped it, the reader finds that file marked "Interrupted" with
  "Try again" on returning, the files still waiting continue, and nothing half-imported is in the library — also when
  the system ended the app completely and it is started again (FR-013b).
- The reader picks more than 50 files at once: the first 50 are queued, the reader is told the rest were not added
  (FR-011a); picking again adds the next ones to the same queue.
- The reader presses Cancel just as the import reaches "Saving": the import completes and the book is added (Cancel
  was already disabled); the reader can remove it from the library as usual.
- An audiobook ZIP picked alone through "Add file": keeps its own preview; its job then joins the import queue (FR-014).
- An audiobook ZIP among several picked files: it is left out of the batch, the other files are queued, and the reader
  is told to pick the ZIP on its own to see its preview (FR-014).
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
  storage, the copy MUST be made by path by the system (not by reading the file through the app), and the fingerprint
  MUST be computed by one read of that copy, by path and in parts; no import step may hold the whole file in memory.
- **FR-004**: Importing an EPUB MUST unpack it once for its details and its cover.
- **FR-004a**: On the phone, reading an EPUB's details and cover during import MUST read only the parts of the file it
  needs (the archive's index and the entries for details and cover), by path; the interface MUST NOT receive the whole
  file during an import.
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
  waiting, and a Cancel action. Cancel is available in every step before "Saving"; during "Saving" (which writes the
  library entry all at once) it is disabled and labelled "Finishing…", and the import completes.
- **FR-010**: While a book is being imported, the Library MUST show it as a placeholder that cannot be opened, edited,
  added to a collection or removed; on success it becomes the real book, on failure or cancel it disappears.
- **FR-011**: Imports MUST run one at a time; an import started while another runs waits in line (first started, first
  run), and each queued import can be cancelled before it starts.
- **FR-011a**: "Add file" MUST let the reader pick several files at once — at most 50 per pick; each becomes its own
  queued import. When more than 50 are picked, the first 50 (in the picker's order) are queued and the reader is told
  how many were not added and that at most 50 files can be picked at a time. When a batch ends, the reader MUST get one summary with five groups — added, already in the library, failed (each with
  its cause), cancelled, interrupted (each with "Try again") — hiding groups with 0, whose counts add up to the number of
  files queued in that batch, and "Open" when exactly one book was added.
- **FR-012**: On success the reader MUST be told (with "Open"); on a duplicate the reader MUST be offered the existing
  book; on failure the reader MUST be told the cause and offered "Try again" when retrying can help. These messages are
  announced to screen readers without moving focus.
- **FR-013**: Cancelling, failing or quitting the app during an import MUST leave the library and the app's storage as
  if the import never started (no entry, no app-owned copy, no cover); the reader's own file is never modified, moved
  or deleted.
- **FR-013a**: Closing the window MUST follow the existing Run in Background setting: when the app keeps running, imports
  continue. Quitting the app completely (window close with Run in Background off, tray Quit, menu Quit, keyboard
  shortcut) while imports are running or waiting MUST first ask the reader, naming how many; Cancel keeps the app and
  the imports going, Quit cancels them (FR-013 cleanup applies). A system shutdown or crash quits without asking and
  the next start finds nothing left behind.
- **FR-013b**: On the phone, an import MUST keep going while the system lets the app run in the background, and MUST NOT
  rely on running when the system stops the app. When the reader returns after the system interrupted an import, that
  import MUST be shown as "Interrupted" with "Try again", everything it had written MUST be cleaned up (FR-013), and the
  imports still waiting MUST continue. This MUST also hold when the system ended the app completely: the phone keeps
  the list of unfinished import jobs (shown name, source, state, order — never file bytes) across launches; on the next
  launch the leftover staging is cleaned before anything else, the job that was running shows "Interrupted" with "Try
  again", the waiting jobs continue in order, and a waiting job whose picked file can no longer be read (the system
  withdrew the app's access to it) shows "Interrupted" too, with "Try again" opening the picker. An entry leaves the
  list when its job ends or is dismissed. No background service or system notification is added for imports.
- **FR-014**: The existing audiobook ZIP import MUST keep its preview (choice of tracks and cover) as today; pressing
  Import in the preview MUST add the ZIP's job at the end of the same import queue, shown on the same progress card
  (step, percentage, Cancel, result with "Open audiobook"), so ZIP and book imports never run at the same time. A ZIP
  among several files picked at once MUST be left out of that batch (the other files are queued) and the reader told to
  pick it on its own to see its preview; the batch summary does not count it.

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
  reader, state (waiting, running, done, duplicate, failed, cancelled, interrupted), current step, progress (bytes done / total
  when known), the resulting book (on success) or the cause (on failure). On Desktop the job lives for the session only (while the app runs,
  also with the window hidden by Run in Background) and is never stored across launches. On the phone a minimal list of
  unfinished jobs is kept across launches — shown name, source, state and order only, never file bytes — so that after a
  relaunch the job that was running can be shown as "Interrupted" and the waiting jobs can continue; an entry leaves the
  list when its job ends or is dismissed (FR-013b).
- **Import queue**: the ordered list of import jobs (this session's, plus on the phone the unfinished ones kept from the
  last launch); one runs at a time. A pick of several files adds
  one job per file and forms a batch whose summary is shown when its last job ends.
- **Placeholder book**: what the Library shows for a running or waiting import job; not a library entry.
- **Step timing**: one measured step (name, format, size, duration); only when timing is turned on.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For each sample book of story 1, a timing report gives the duration of every step listed in FR-002, before
  and after the change.
- **SC-002**: Importing each large sample book (PDF and EPUB) from the reader's disk takes at least 40 % less time than
  its baseline, with an identical library entry. 40 % is the default target: it may be lowered only once, after story
  1's report shows the repeated reads are not the main cost, with the new figure and its reason written here before
  story 2 starts; from then on the figure is a fixed pass / fail gate.
- **SC-003**: After choosing a file, the reader can use the app (navigate, open another book) within 2 seconds, for any
  file size.
- **SC-004**: During an import of a file of several hundred MB, the progress shown changes at least every 2 seconds, and
  the app answers a click or a key press within 200 ms. On the phone, a step that cannot report intermediate
  percentages (the SHA-256 fingerprint computed by path, in parts, by the system) still meets this criterion when the
  interface keeps a continuous animation together with a counter of the seconds elapsed in that step, and clicks, taps
  and key presses are still answered within 200 ms. When the reader asked for reduced motion, the elapsed-seconds
  counter alone satisfies this.
- **SC-005**: Opening a book while another book is imported in the background shows the first page no more than 20 %
  later than the same open with nothing running; and opening a book right after its import shows the first page no
  more than 5 % later than the baseline.
- **SC-006**: In 20 cancelled or failed imports (including quitting the app mid-import), 0 library entries, 0 app-owned
  copies and 0 covers are left behind, and the reader's files are unchanged (same fingerprint).
- **SC-007**: In a check of 10 users importing a large book, every user finds the import's progress and can open the new
  book when it ends without help.
- **SC-008**: Picking 20 books at once adds them all in one action (no further step per book), and the summary's
  counts match the library exactly and add up to the 20 files picked; the same holds on the phone.
- **SC-009**: On the phone, importing each large sample book takes at least 30 % less time than its baseline (the copy
  into app storage included). 30 % is the default target and follows the same rule as SC-002 (lowered at most once,
  after story 1's report, with the figure and reason written here before story 2; then a fixed gate).

## Assumptions

- The sample books for story 1 are chosen by the team (at least one PDF and one EPUB above 100 MB, and one small book);
  real slow cases reported by the user are added when available. The success percentages of SC-002 and SC-009 are reviewed after
  story 1's report and may be lowered once, as those criteria describe; the figures are fixed before story 2 starts.
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
