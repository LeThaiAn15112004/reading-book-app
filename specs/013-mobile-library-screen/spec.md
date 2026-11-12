# Feature Specification: Mobile Library screen

**Feature Branch**: `013-mobile-library-screen`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "Chúng ta đang chuẩn bị viết specification cho màn hình Library phiên bản Mobile của
ứng dụng Readmate Reader … 1. Empty State … 2. Banner Ad & Bottom Tab Bar … 3. Continue Reading (vuốt ngang) … 4. Grid
vs List … 5. Bottom Sheet ⋮" (the Mobile Library screen: empty state, ad banner and bottom tab bar behaviour, the
horizontally scrolling Continue Reading row, grid / list view, and the per-book bottom sheet).

## Context (current behaviour)

The phone app already shows a Library, because it runs the same interface as the desktop app with phone adjustments
(spec 008):

- Navigation is a bottom bar with **Library, Collections, Reading, Settings**.
- The Library has a **Continue Reading** row (cover + title + progress + "Resume"), the book grid / table, sort, and a
  search box. Tapping a Continue Reading cover or "Resume" opens the book in the Reader at its saved position.
- The view choice (**grid** or **table**) and the sort order are already remembered on the device between launches,
  and Settings → Advanced → Reset App Settings puts them back to grid / recently added.
- Each book has a **⋮** button (and long press) that opens a **bottom sheet**: Resume, Add to collection (list opens
  inline), Favourite, Mark completed, Details, Edit metadata, Remove from collection, Remove from library. Annotation
  import / export, "Open file location" and "Copy file path" are already hidden on the phone.
- There is an empty-library screen, but it is the desktop one (it talks about adding files the desktop way).
- Import offers only "Add file" (the system file picker); every imported book is **copied** into the app's storage.
- There is **no advertising** anywhere in the app today.

The table view is a desktop layout (many columns, a detail panel) and does not fit a phone screen; the empty state
does not speak to a phone user; and the screen has no slot for an advertising banner. This feature makes the Library a
proper phone screen around those five points.

## Clarifications

### Session 2026-11-12

- Q: Does "Read again" also clear the completed status and reset progress? → A: Yes. It opens the book at the
  beginning, clears the completed status and sets progress to 0 %; highlights, notes and bookmarks are kept.
- Q: Is the file picker the only import path on the empty state, or also a folder scan? → A: File picker only. Folder
  scanning is out of scope.
- Q: Is a 320 × 50 ad banner part of this release? → A: No. This release shows no advertising; it only reserves the
  layout slot above the tab bar, which stays collapsed (zero height) until a later feature fills it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pick up the book I was reading (Priority: P1)

A reader opens the app and, at the top of the Library, sees the books they are in the middle of as a horizontally
scrolling row of cards. One tap on a card takes them straight back into that book at the exact place they stopped.

**Why this priority**: Returning to the current book is the most frequent thing a reader does; it must be one tap.

**Independent Test**: Read a book to the middle, return to the Library, tap its card: the Reader opens at the same
place, with no intermediate popup.

**Acceptance Scenarios**:

1. **Given** a book read to 40 %, **When** the user taps its card (cover or "Resume"), **Then** the Reader opens at the
   saved position — no details popup in between.
2. **Given** several books in progress, **When** the Library opens, **Then** they appear in the row most recently read
   first, each with its title and a progress indication, and the row scrolls sideways with a finger swipe.
3. **Given** a book marked completed (or read to the end), **When** it is shown in the row, **Then** its action reads
   "Read again" instead of "Resume", and choosing it opens the book at its beginning.
4. **Given** "Read again" on a completed book, **When** the book opens at the beginning, **Then** its highlights,
   notes and bookmarks are kept, its completed status is cleared and its progress is 0 %, so it shows "Resume" from
   then on.
5. **Given** no book has ever been opened, **When** the Library opens, **Then** the Continue Reading row is not shown
   (no empty row, no placeholder).

---

### User Story 2 - A first launch that tells me what to do (Priority: P1)

A new user opens the app with an empty Library. Instead of a blank grid, the screen explains in one sentence what the
app does and offers one large, obvious "Import book" action that opens the phone's file picker.

**Why this priority**: Without it a first-time user has no path into the app; it is the gate to every other story.

**Independent Test**: Install fresh (or remove every book), open the Library: one clear import action is shown; using
it imports a book and the empty state is replaced by the Library.

**Acceptance Scenarios**:

1. **Given** a Library with no books, **When** it opens, **Then** it shows an illustration, a short explanation, the
   list of supported formats (EPUB, PDF, TXT, Markdown) and one primary "Import book" button in the middle of the
   screen — no mention of drag and drop or of desktop-only sources.
2. **Given** the empty state, **When** the user taps "Import book", **Then** the system file picker opens; after a
   supported file is chosen the book appears in the Library and the empty state disappears.
3. **Given** the empty state, **When** the user cancels the picker, **Then** nothing changes and no error is shown.
4. **Given** a file of an unsupported type is chosen, **When** the import ends, **Then** the user sees a message naming
   the problem and the empty state stays.
5. **Given** the empty state, **Then** the file picker is its only import path — no folder scan and no storage
   permission request.
6. **Given** a Library that has books but a filter, search or collection that matches none, **When** it is shown,
   **Then** a smaller "nothing matches" message is shown with a way to clear the search / filter — not the first-launch
   empty state.

---

### User Story 3 - Grid or list, remembered (Priority: P2)

On the phone the reader can switch the book collection between a **grid** of covers and a compact **list** (small
cover, title, author, progress on one row). The choice is still there the next time they open the app.

**Why this priority**: A list is faster to scan for large libraries, a grid is nicer for small ones; it is a comfort
feature built on an existing preference.

**Independent Test**: Switch to list, close and reopen the app: the list is shown. Reset App Settings: the grid is back.

**Acceptance Scenarios**:

1. **Given** the grid, **When** the user taps the view switch, **Then** the books are shown as a list immediately,
   keeping the current sort, search and scroll position near the same book.
2. **Given** the list was chosen, **When** the app is closed and reopened, **Then** the Library opens in the list.
3. **Given** the phone is rotated or the screen width changes, **When** the grid is shown, **Then** the number of
   columns adapts to the width (at least 2 columns in portrait on a typical phone) and no cover is cut off.
4. **Given** Settings → Advanced → Reset App Settings, **When** it completes, **Then** the Library is back to the grid
   and the default sort.
5. **Given** the phone app, **Then** the desktop "table" layout with its detail panel is never shown; a table choice
   saved earlier is shown as the list.

---

### User Story 4 - Book actions in a bottom sheet (Priority: P2)

Tapping ⋮ on a book (or pressing and holding its cover) opens a bottom sheet with the actions that make sense on a
phone, in a predictable order, each large enough to tap.

**Why this priority**: The sheet exists already; this story fixes its minimum content and behaviour so it is
consistent across the Continue Reading row, grid and list.

**Independent Test**: Open the sheet from each of the three places for the same book: same actions, same order; each
action works and the sheet closes.

**Acceptance Scenarios**:

1. **Given** any book, **When** the sheet opens, **Then** it shows the book's cover, title and author at the top and, in
   this order: **Resume / Read again**, **Add to collection**, **Add to / Remove from favourites**, **Mark completed /
   Mark as unread**, **Book details**, **Edit metadata**, (**Remove from this collection** only when viewing a
   collection), and last, separated and styled as destructive, **Remove from library**.
2. **Given** the sheet, **When** the user swipes it down, taps outside it or uses the system Back gesture, **Then** it
   closes without doing anything.
3. **Given** "Remove from library", **When** it is chosen, **Then** a confirmation names the book and states that its
   highlights, notes, bookmarks and reading progress will be removed with it, and that the app's copy of the file is
   deleted; only after confirming is the book removed.
4. **Given** "Add to collection", **When** chosen, **Then** the collection list opens inside the sheet with the
   current memberships ticked and a "New collection" entry.
5. **Given** the phone app, **Then** actions that do not exist on the phone (open file location, copy file path,
   annotation import / export, delete the user's original file) are not shown — hidden, not greyed out.

---

### User Story 5 - Navigation that stays put, with a reserved banner slot (Priority: P3)

While scrolling a long Library, the bottom tab bar stays fixed at the bottom; the book list scrolls above it and
nothing is hidden under it. The layout reserves a 320 × 50 banner slot directly above the tab bar for a later
release; in this release no advertising is shown and the slot takes no space.

**Why this priority**: Layout stability matters, but it only becomes visible once the other stories exist; the slot
only prepares a later business decision.

**Independent Test**: Scroll a 200-book Library to the end: the tab bar never moves, no ad appears, and the last row
of books is fully visible above it.

**Acceptance Scenarios**:

1. **Given** a long Library, **When** the user scrolls in either direction, **Then** the tab bar stays fixed at the
   bottom and is always reachable.
2. **Given** this release, **When** any screen is shown, **Then** no advertisement is displayed and no ad-related
   request, permission or consent screen exists.
3. **Given** the reserved slot is empty, **When** the Library is shown, **Then** it takes zero height — no empty
   50-pixel gap.
4. **Given** the last row of books, **When** scrolled to the end, **Then** it is fully visible above the tab bar, and
   the phone's system areas (notch, gesture bar) never cover a control.
5. **Given** the slot is filled by a later feature with 320 × 50 content, **When** the user scrolls, **Then** that
   content stays fixed directly above the tab bar and is not hidden or shown with the scroll direction.

---

### Edge Cases

- A book in Continue Reading whose file can no longer be opened (app copy missing / damaged): the card stays, tapping
  it shows a clear message instead of an empty Reader, and the sheet still offers "Remove from library".
- A book with no cover: grid, list, card and sheet show the same generated placeholder (title initials on a colour).
- Very long titles / authors: cut with an ellipsis after two lines in the grid and one line in list / cards; the full
  title is in Book details.
- A Library of 1 000+ books: scrolling stays smooth and the screen opens without loading every cover at once.
- An import in progress when the user switches tab or locks the phone: the import finishes; the Library shows the new
  book when the user comes back.
- The same book imported twice: the existing duplicate message is shown; no second entry appears.
- Changing the app language (spec 012) while on the Library: every text of this screen, including the empty state and
  the sheet, follows the language.
- Large system font / display size: texts wrap rather than overflow; the sheet scrolls if its actions do not fit.
- Dark / light / sepia appearance: every new element follows the app theme.
- A book removed while its sheet is open (e.g. from another screen): the sheet closes.

## Requirements *(mandatory)*

### Functional Requirements

**Continue Reading**

- **FR-001**: The Library MUST show, above the book collection, a horizontally scrollable row of the books the user has
  started, most recently read first, and MUST hide the row entirely when there is none.
- **FR-002**: Each card MUST show the cover, title and reading progress, and one action labelled "Resume" for a book in
  progress or "Read again" for a completed book.
- **FR-003**: Tapping a card (cover or action) MUST open the book directly in the Reader — "Resume" at the saved
  position, "Read again" at the beginning — without an intermediate details popup.
- **FR-004**: "Read again" MUST clear the book's completed status and set its progress to 0 %, and MUST NOT remove any
  highlight, note or bookmark of the book.
- **FR-005**: Each card MUST give access to the same bottom sheet as the book collection (⋮ and long press).
- **FR-006**: The row MUST show at most 10 books; it does not need a "see all" entry (the full collection is just
  below, sortable by recently read).

**Empty state**

- **FR-007**: When the Library has no books, the screen MUST show a phone-specific empty state: illustration, one-line
  explanation, the supported formats, and one primary "Import book" action that opens the system file picker.
- **FR-008**: The empty state MUST NOT mention drag and drop, desktop menus or sources not available on the phone.
- **FR-009**: A search, filter or collection with no match MUST show a distinct "nothing matches" message with a way to
  clear it, never the first-launch empty state.
- **FR-010**: Cancelling the picker MUST change nothing; a failed import MUST show a message that names the reason.

**Grid / list**

- **FR-011**: The user MUST be able to switch the collection between a grid of covers and a one-row-per-book list
  (cover thumbnail, title, author, progress, ⋮).
- **FR-012**: The choice MUST be remembered on the device across launches and MUST be reset to the grid by Reset App
  Settings, together with the sort order.
- **FR-013**: On the phone a previously saved desktop "table" choice MUST be shown as the list; the desktop table and its
  detail panel MUST NOT appear.
- **FR-014**: The grid MUST adapt its number of columns to the screen width, with at least 2 columns in portrait on a
  phone 360 px wide or more.
- **FR-015**: Switching view MUST keep the current sort, search, filter and collection.

**Bottom sheet**

- **FR-016**: ⋮ on a book and a long press on its cover MUST open the same bottom sheet from the Continue Reading row,
  the grid and the list.
- **FR-017**: The sheet MUST contain, in this order: book header (cover, title, author); Resume / Read again; Add to
  collection; favourite toggle; completed toggle; Book details; Edit metadata; Remove from this collection (only inside
  a collection); Remove from library (last, separated, destructive style).
- **FR-018**: "Remove from library" MUST ask for confirmation naming the book and stating what is removed with it
  (annotations, bookmarks, progress, the app's copy of the file).
- **FR-019**: The sheet MUST close by swipe down, tap outside and the system Back gesture, without performing an action.
- **FR-020**: Actions not available on the phone MUST be hidden, not disabled.

**Bars and banner**

- **FR-021**: The bottom tab bar (Library, Collections, Reading, Settings) MUST stay fixed while the Library scrolls.
- **FR-022**: The layout MUST reserve a 320 × 50 banner slot fixed directly above the tab bar; content placed in it
  MUST NOT hide or reappear with scrolling, and the slot MUST NOT exist in the Reader.
- **FR-023**: In this release the slot MUST stay empty and take zero height; the app MUST NOT show advertising, load an
  ad provider, or ask for ad-related consent or permissions.
- **FR-024**: The scrolling content MUST end above the fixed bars so the last book is fully visible, and no control may
  sit under the phone's system areas (notch, status bar, gesture bar).

**General**

- **FR-025**: Every text of the screen MUST be translated in Vietnamese and English (spec 012) and every element MUST
  follow the app theme.
- **FR-026**: The desktop Library MUST be unchanged by this feature.
- **FR-027**: Every tappable element MUST have a touch target of at least 44 × 44 points and an accessible label.

### Key Entities

- **Library book (as shown)**: title, author, cover (or placeholder), format, progress, last-read time, favourite and
  completed status, collections it belongs to. Existing data; nothing new is stored.
- **Library view preference**: layout (grid / list) and sort order, per device. Existing preference; "list" is the
  phone rendering of it.
- **Continue Reading entry**: a started book derived from its last-read time and progress; not stored separately.
- **Banner slot**: a reserved, empty fixed position above the tab bar; holds no data in this release.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From launching the app, a user returns to the exact place in the book they were reading in **one tap**
  on the Library.
- **SC-002**: In a hallway test, 9 of 10 first-time users with an empty Library import their first book within
  **60 seconds** without help.
- **SC-003**: The view choice survives 100 % of app restarts in testing, and Reset App Settings restores the grid every
  time.
- **SC-004**: The bottom sheet offers the same actions in the same order from all three entry points in 100 % of
  checks, and opens within **300 ms** of the tap.
- **SC-005**: With a 1 000-book Library, the Library is usable within **2 seconds** of opening and scrolling shows no
  visible stutter on a mid-range phone.
- **SC-006**: In a full scroll of a 200-book Library, the tab bar never moves, no book is ever hidden behind it, and no
  advertisement is shown anywhere in the app.
- **SC-007**: Desktop Library behaviour is unchanged (its recorded checks still pass).

## Assumptions

- **Same interface architecture as today**: the phone Library keeps being the shared Library interface with phone
  adjustments (spec 008), not a separate native rewrite. The feature description lists React Native / NativeWind; the
  repository's phone app does not use NativeWind and runs the shared interface in a web view. Choosing the technical
  approach is left to `/speckit-plan`; this spec describes only behaviour.
- The four-tab bottom bar (Library, Collections, Reading, Settings) is kept as it is.
- Import stays "Add file" through the system picker, and books stay copied into app storage (spec 008).
- "Recently read" order, progress and completed status come from the existing reading data; no new data is stored.
- Search and sort keep their current behaviour; only their phone presentation may change.
- Advertising is not part of this release. Its provider, consent handling (e.g. GDPR consent), screens and any
  "remove ads" purchase belong to a later feature; this spec only reserves the slot's position and behaviour.
- Android is the target of this release; iOS follows the same spec when built.
- Out of scope: showing advertising, cloud / URL import, audiobooks, annotation import / export, folder scanning,
  syncing the view choice between devices.
