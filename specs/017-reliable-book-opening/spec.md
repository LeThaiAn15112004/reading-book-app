# Feature Specification: Reliable, clear book opening (and import without false failures)

**Feature Branch**: `017-reliable-book-opening`

**Created**: 2026-11-21

**Status**: Draft

**Input**: User description (+ US4 from the 2026-11-22 clarification): the book opening flow is not good enough yet. Light and heavy books alike sometimes fail
with "cannot open this book"; a heavy book shows the loading indicator for a very long time, until the whole book has
been opened; the app may read / fingerprint the file several times; and the opening screens are not designed well
(Vietnamese description, summarised from the UI/UX review of the opening flow of 2026-11-21).

## Context (current behaviour)

A reader taps a book in the Library (grid, list, Continue Reading or the book menu). Today:

- **Screens**: up to three waiting screens follow each other, each in a different style: first "Opening book… /
  Preparing the reader and loading the file on this device", then (EPUB) an overlay "Opening book…" again, then
  "Preparing book…". A PDF shows a single line of text instead. The title and cover the app already knows are not
  shown, and the wording ("loading the file") suggests a download.
- **No way out**: while a book is loading there is no Back / Cancel control; the only exit appears once opening has
  failed. On the phone the reader is full screen without the tab bar, so only the system Back gesture leaves.
- **Waiting without end**: nothing limits how long a step may take. A step that never finishes keeps the spinner
  turning; the message never changes, however long the wait.
- **Sporadic failures**: opening sometimes fails for books that open fine at another moment, whatever their size.
  Known contributors, from reading how the app works (not measured yet):
  - returning to the saved reading position can fail or be retried for a long time when that position no longer
    matches the book (for example after the file changed), instead of falling back to the start of the chapter;
  - on the phone, the book's bytes come from a component that may be briefly unavailable (just after the app returns
    from the background); one failed read ends the opening at once;
  - on the phone, opening competes with other work running at the same time (drawing a missing cover, an import),
    and work already running is not held back while a book opens.
- **The whole book before the first page**: before anything is drawn, the app reads the whole file, fingerprints all
  of it (needed only to keep PDF annotations in step with the file), and copies it twice; an EPUB is then unpacked
  whole. After the first page, an EPUB is opened a second time in the background to count its pages, which can make
  the first page turns stutter.

- **Imports that fail at random** (found while reading how feature 016's queue works, not measured): on the computer
  a picked file is kept for the queue for 30 minutes only, so the last files of a long queue can fail with "could not
  read the selected file"; the check that a file did not change during its import compares the exact modification
  time, which a sync program (OneDrive, Google Drive, Dropbox) can touch without changing the content; on the phone,
  read access to picked files can be withdrawn when the app is closed with imports still waiting.

**Not in this feature**: opening a large book progressively (reading only the parts of the file the current page
needs). It is planned as its own feature; here a large book still reads its file before the first page, but with the
waiting screen, time limits and Back of this feature.

Feature 016 already made background work (search index, word count, signature check, new covers, the next import)
wait for the first page of the book being opened. This feature builds on that.

## Clarifications

### Session 2026-11-21

- Q: Does this feature also open large books progressively (only the part of the file the current page needs, without
  reading the whole book first)? → A: No. This feature covers reliability, the waiting screen and removing repeated
  work; progressive opening is planned as its own feature (it changes how a PDF's annotations are kept in step with its
  file).
- Q: Are the imports that fail for valid books at random (a pick that expires while it waits in the queue, the
  "file changed" check tripped by a sync program, read access lost on the phone) part of this feature? → A: Yes, as
  User Story 4: valid books must import without false failures.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A book either opens or says clearly why not, and the reader can always leave (Priority: P1)

A reader taps a book. Whatever happens, they are never stuck: they can go back to the Library at any moment, a step
that takes too long ends with a clear message instead of a spinner without end, and a book that is fine does not fail
because of a passing problem (a saved position that no longer fits, a read that failed once).

**Why this priority**: "cannot open this book" for a good book, or a spinner that never stops, is the worst outcome of
the flow: the reader loses trust and may think the book or the app is broken. Fixing it has value on its own, even
with today's screens and speed.

**Independent Test**: Open a sample set of valid books (every format, small and large, read and unread) many times,
including right after returning to the app and while an import runs; force a saved position that no longer fits; make
one read fail once; make a step hang. Check: every valid book opens; a hanging step ends in a message within the time
limit; Back works at every moment.

**Acceptance Scenarios**:

1. **Given** a book is opening, **When** the reader presses Back (the on-screen control, the system Back gesture or
   Esc on the computer), **Then** the Library is shown within 1 s, the opening stops, and nothing of the opening is
   left running or saved (the reading position is unchanged).
2. **Given** a book whose saved reading position no longer matches the book, **When** it is opened, **Then** it opens
   at the start of the chapter that position belonged to (or the start of the book), with a short note "Couldn't
   return to where you left off", and no error.
3. **Given** the book's content cannot be read at the first attempt for a passing reason, **When** it is opened,
   **Then** the app tries again by itself before showing an error, and the reader sees no failure if the second
   attempt works.
4. **Given** a step of the opening takes longer than its time limit, **When** the limit passes, **Then** the waiting
   screen is replaced by an error saying what could not be done, with Try again, Open from the beginning (when a
   saved position was being used) and Back to Library.
5. **Given** opening fails, **When** the error is shown, **Then** it names the cause in plain words (file missing or
   moved, file damaged or not a valid book, file too large for this device, took too long, could not be read) and
   offers the actions that can help for that cause (Locate file on the computer for a moved file, Try again, Back).
6. **Given** the file of a book has been moved or deleted, **When** the book is opened, **Then** the error appears
   within 2 s (it does not wait for a time limit) and offers Locate file (computer) or explains that the book must be
   imported again (phone).

---

### User Story 2 - One clear waiting screen that shows which book is opening (Priority: P1)

While a book opens, the reader sees one waiting screen, the same for every format and on both the computer and the
phone: the book's cover and title, a progress indicator, one short line that says what is happening and changes with
the step, a note when it takes longer than usual, and a Back control.

**Why this priority**: the waiting screen is seen at every opening. Several screens in different styles, a repeated
"Opening book…" and wording that suggests a download make the app feel slow and unfinished even when it is not.

**Independent Test**: Open one book of each format on both hosts, in light and dark themes, with reduced motion on and
off, with a screen reader; compare the screens and timings with the requirements below.

**Acceptance Scenarios**:

1. **Given** the reader taps a book, **When** the reader screen appears, **Then** within 100 ms it shows that book's
   cover (or the generated cover style when it has none) and title, and keeps the same screen until the first page is
   shown — no second or third waiting screen in another style for any format.
2. **Given** a book is opening, **When** the step changes (for example from reading the file to preparing the first
   page), **Then** the line of text changes with it; the words never suggest a download for a book stored on the
   device.
3. **Given** the opening takes longer than 5 s, **When** that moment passes, **Then** a second line says that large
   books can take a little longer, and Back stays available.
4. **Given** the opening is quick (the first page is ready in under 300 ms), **When** the book opens, **Then** no
   waiting screen flashes briefly before the page.
5. **Given** reduced motion is on, **When** a book is opening, **Then** no element spins or slides; the indicator is
   static.
6. **Given** a screen reader is on, **When** a book is opening, **Then** "Opening {title}" is announced once, step
   changes are not announced repeatedly, and an error is announced when it appears.
7. **Given** the first page appears, **When** the waiting screen goes away, **Then** it fades out (no fade under
   reduced motion) and focus goes to the reading surface.

---

### User Story 3 - Books open faster and the first pages turn smoothly (Priority: P2)

The time from tapping a book to its first page goes down, especially for large books, because the app no longer does
the same work several times before the first page, and work started after the first page no longer makes the first
page turns stutter.

**Why this priority**: speed matters for every opening, but a fast opening that can still hang or fail (US1) or that
still looks confusing (US2) does not solve the reader's problem; this story comes after them.

**Independent Test**: With the developer timing of feature 016, measure "tap → first page" on the sample set before
and after; turn ten pages right after the first page of a large EPUB and note any page turn slower than usual.

**Acceptance Scenarios**:

1. **Given** a book that is not a PDF, **When** it is opened, **Then** the whole file is not fingerprinted for the
   opening, and its content is not copied more than once on the way to the screen.
2. **Given** a PDF, **When** it is opened, **Then** the fingerprint that keeps its annotations in step with the file is
   still taken, without delaying the first page any more than today.
3. **Given** the first page of a large EPUB has appeared, **When** the reader turns pages during the first 10 s,
   **Then** every page turn shows the next page in under 300 ms (counting pages and similar work wait until the reader
   is idle).
4. **Given** a cover is being drawn or another piece of background work is running when a book starts to open,
   **When** the opening starts, **Then** that work is paused (not only the next one held back) and resumes after the
   first page.

---

### User Story 4 - A valid book imports every time (Priority: P2)

A reader adds several books at once, some of them from a folder kept in sync with a cloud drive. Every valid book is
added, however long the queue takes and wherever the file lives; a book fails only when something is really wrong
with it, and then the message says what.

**Why this priority**: the same kind of fault as US1 (a good book refused) on the way in; the fixes are small and the
same sample set tests them.

**Independent Test**: Pick 50 valid books (every format, small and large), part of them in a folder synced by a cloud
drive client; let the queue run more than 30 minutes; on the phone, pick books, close the app before the queue ends
and reopen it. Check the batch summary and the Library.

**Acceptance Scenarios**:

1. **Given** a long queue that takes more than 30 minutes, **When** the last waiting files reach their turn, **Then**
   they import like the first ones (no "could not read the selected file" because of the wait).
2. **Given** a file in a folder synced by a cloud drive client whose modification time is touched during the import
   but whose content is unchanged, **When** it is saved, **Then** it is added normally.
3. **Given** a file whose content really changes during its import, **When** it would be saved, **Then** it is not
   added and the message says the file changed while it was being imported, with Try again.
4. **Given** the phone app was closed with imports waiting, **When** it is opened again and a waiting file can no
   longer be read, **Then** that file shows "Interrupted — pick the file again" with Try again opening the picker, and
   the files that can still be read continue.
5. **Given** an import fails, **When** the reason is shown (in the card, the batch summary or a message), **Then** it
   is in the interface language and names the cause, on both the computer and the phone.

---

### Edge Cases

- The reader presses Back, then opens the same book again before the first opening has stopped: the second opening
  starts cleanly; nothing from the first one appears on top of it.
- The reader opens book A, goes back, and opens book B quickly: B never shows A's cover, title, page or error.
- The app is sent to the background while a book is opening (phone): when it comes back, the opening continues or is
  retried; time spent in the background does not count against the time limit.
- The file is replaced by a different file while the book opens: the opening uses one consistent version, or fails
  with "file changed — try again"; it never shows a mix.
- A book with no cover and no title stored: the waiting screen shows the generated cover style and the file name.
- A Markdown file above the size limit, or a book too large to open in development builds on the phone: refused at
  once with the size reason, without a time limit to wait for.
- A DRM-protected or encrypted book: a clear "this book is protected and cannot be opened" message, not "damaged".
- Audiobooks: not changed by this feature (they already stream), except that the shared waiting screen and Back rule
  apply to their opening screen too.
- Opening while an import of the same book is still saving: the book opens only once its entry is complete.
- The reader taps a book twice quickly: one opening, not two.
- A waiting import is cancelled, or the app quits: the file it had picked is released then (not kept forever).
- A synced file that is still being downloaded by the cloud client when its import starts: it imports once complete,
  or fails with "the file is not available offline yet", never as "damaged".

## Requirements *(mandatory)*

### Functional Requirements

**Leaving and time limits (US1)**

- **FR-001**: The reader MUST be able to leave a book that is opening at any moment — on-screen Back control, system
  Back gesture (phone) and Esc (computer) — and return to where they came from within 1 s.
- **FR-002**: Leaving MUST stop the opening: nothing from it appears afterwards, nothing keeps running for it, and the
  saved reading position, status and settings of the book are unchanged.
- **FR-003**: Each step of the opening (getting the book's content, preparing it, showing the first page) MUST have a
  time limit; default 20 s per step, counted only while the app is in the foreground. When a limit passes, the opening
  stops and the error of FR-006 is shown with the cause "took too long".
- **FR-004**: A failure to read the book's content that may be passing (the content source is briefly unavailable, a
  read was interrupted) MUST be retried once automatically before an error is shown. A missing file, a refused file
  or a file that is too large MUST NOT be retried.
- **FR-005**: When the saved reading position cannot be used (it no longer fits the book, or reaching it fails or
  passes 3 s), the book MUST open at the start of the chapter that position belongs to, or at the start of the book,
  and show a short note that the previous position could not be restored. The saved position is replaced only once
  the reader moves on.
- **FR-006**: An opening error MUST state its cause in plain words and offer only actions that can help: Try again
  (always), Open from the beginning (when a saved position was used), Locate file (computer, missing file), an
  explanation to import the book again (phone, missing file), and Back to Library (always). Causes at least: file
  missing or moved, cannot be read, damaged or not a valid book of its format, protected, too large for this device,
  took too long.
- **FR-007**: Checks that can fail at once (file missing, refused, too large) MUST be done first, so their error
  appears within 2 s.
- **FR-008**: Opening the same book twice quickly, or another book while one is opening, MUST leave exactly one
  opening running — the latest — and nothing of an earlier one may be shown.

**Waiting screen (US2)**

- **FR-009**: There MUST be one waiting screen, the same for every format (EPUB, PDF, TXT, Markdown) and on both the
  computer and the phone, from the tap until the first page is shown. It shows the book's cover (or the generated
  cover style) and title, an indeterminate progress indicator, one line naming the current step, and the Back control.
- **FR-010**: The waiting screen MUST appear within 100 ms of the tap; when the first page is ready in under 300 ms,
  the waiting screen MUST NOT be shown at all (no flash).
- **FR-011**: The step line MUST change with the step (for example "Opening the book…", "Preparing the first page…",
  "Going back to where you left off…") and MUST NOT suggest a download for a book stored on the device. After 5 s a
  second line MUST say that large books can take a little longer.
- **FR-012**: Under reduced motion nothing on the waiting screen moves (static indicator, no fade). Text and controls
  MUST meet a contrast of at least 4.5 : 1 in light and dark themes; the Back control is at least 44 × 44 px on the
  phone and reachable by keyboard on the computer.
- **FR-013**: For screen readers: the opening is announced once ("Opening {title}"), step changes are not announced
  more than once each, an error is announced when it appears, and focus moves to the reading surface once the first
  page is shown, or to the error's first action when an error is shown.
- **FR-014**: All new text MUST exist in English and Vietnamese (feature 012 rules: no literal interface text; book
  titles and file names are user data, never translated).

**Less work before the first page (US3)**

- **FR-015**: Opening a book that is not a PDF MUST NOT fingerprint its whole file. A PDF keeps the fingerprint its
  annotation sync needs, taken so that it does not add to the time to the first page.
- **FR-016**: The book's content MUST NOT be copied more than once between the file and the reader.
- **FR-017**: Work that the opening starts for later use (counting an EPUB's pages, measuring text lengths) MUST start
  only after the first page is shown and the reader has not turned a page for at least 1 s, and MUST stop as soon as
  the reader turns a page or leaves; it MUST NOT make any page turn take longer than 300 ms.
- **FR-018**: Background work that is already running when a book starts to open (drawing a cover, an import step that
  can wait, the search index) MUST be paused, not only the next item held back, and resumed after the first page
  (extends feature 016 FR-015).
- **FR-019**: The developer timing of feature 016 MUST record each opening step (content, preparing, first page,
  restoring the position) by format and size only, and the outcome (opened, left by the reader, failed with its
  cause), so the targets below can be measured.

**Import without false failures (US4)**

- **FR-020**: A file picked for import MUST stay available to its queued job for as long as that job waits or runs
  (no time-based expiry while queued); it is released when the job ends, is cancelled or dismissed, or the app quits.
- **FR-021**: The "file changed during import" check MUST report a change only when the file's content differs from
  what was fingerprinted; a changed modification time alone (for example touched by a sync program) MUST NOT fail the
  import.
- **FR-022**: On the phone, a waiting file that can no longer be read after a relaunch MUST end as "Interrupted —
  pick the file again" (Try again opens the picker); it MUST NOT be reported as damaged or as a save failure.
- **FR-023**: Every import failure message MUST be shown in the interface language with its cause, on both hosts
  (the phone's messages are English-only today).

### Key Entities

- **Opening**: one attempt to show a book — which book, where the reader came from, its current step, when that step
  began (for the time limit and the 5 s note), whether a saved position is being used, and how it ended (opened, left,
  failed with a cause). At most one per reader window; a new one replaces the previous one. Not stored.
- **Opening error**: the cause (missing, unreadable, damaged, protected, too large, took too long), the step it
  happened in, and the actions offered. Shown, not stored.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the sample set (every format, small and large, read and unread, at least 30 valid books), each book
  opened 5 times on the computer and on the phone — including right after returning to the app and while an import
  runs — opens every time: 0 "cannot open" errors for valid books.
- **SC-002**: No opening shows a waiting screen for more than 20 s per step without either the first page or an error
  (time-limit check with a forced hanging step).
- **SC-003**: Back from the waiting screen returns to the Library within 1 s in 20 out of 20 tries, at any step.
- **SC-004**: A book whose file is missing shows its error within 2 s.
- **SC-005**: Time from tap to first page goes down by at least 30 % for books larger than 50 MB, and does not go up
  for any book (baseline measured before the change with the developer timing, the same method as feature 016).
- **SC-006**: In the first 10 s after the first page of a large EPUB, none of 10 page turns takes longer than 300 ms.
- **SC-007**: A batch of 50 valid books (every format, part of them in a cloud-synced folder), with the queue running
  longer than 30 minutes, imports 50 of 50 on the computer; on the phone, 50 of 50 or the unreadable ones marked
  "Interrupted" after a relaunch — 0 false "could not read" / "file changed" / "damaged" results.
- **SC-008**: In an internal check, 3 people who did not work on this feature open 5 books each, including a slow one
  and a missing one, and can say which book is opening and how to leave in every case without help.

## Assumptions

- "Valid book" means a file that the app can open today when nothing else runs; damaged or protected files are
  expected to fail, but with the right cause (FR-006).
- The 20 s per-step limit and the 5 s "takes longer" note are defaults; they can be tuned after the baseline
  measurement (like the targets of feature 016).
- The sample set lives outside the repository; reports name books only by format and size (feature 016 FR-001).
- Audiobooks keep their own player and streaming; only the shared waiting screen, Back and error rules apply to them.
- No change to how annotations, reading positions or settings are stored; no database change.
- Feature 016's "wait for the first page" gate is kept and extended (FR-018), not replaced.
- E2E stays manual-only (project rule); checks are unit tests, spike scripts and the manual quickstart.
