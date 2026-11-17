# Feature Specification: Collections screen redesign

**Feature Branch**: `015-collections-screen-redesign`

**Created**: 2026-11-17

**Status**: Draft

**Input**: User description: "cải thiện giao diện màn collection" (improve the look and usability of the Collections
screen — the place where the user groups and keeps books).

## Context (current behaviour)

A **collection** is a user-made group of books (name, optional description, ordered list of books). A book can be in any
number of collections; deleting a collection never removes its books from the library. Collections are reached from the
top navigation on Desktop and from the "Collections" tab of the bottom bar on the phone; both hosts show the same screen.

Today the screen has three parts:

- **Collections list**: a header (title, one-line subtitle, "New collection" button) and a grid of cards. Each card shows
  three coloured blocks picked from five fixed colours (not the books' covers), the name, the description and the book
  count. **Edit** and **Delete** appear only when the pointer hovers a card; on the phone they are always shown, small
  (about 28 px) and placed over the card's own tap area.
- **Collection page**: Back, the collection's name, the book count and a Grid / List switch. It offers no way to rename
  or delete the collection, nor to add books. An empty collection shows a single line of text.
- **Adding a book**: only from a book's menu in the Library ("Add to collection" → a sub-list of collections). A
  collection that already holds the book is greyed out with a tick and cannot be clicked, so the book cannot be removed
  from there. "New collection" in that sub-list creates the collection and adds the book.
- **New / Edit dialog**: name (required, up to 80 characters) and description (optional, up to 160 characters).

A UI/UX review of the current screen (2026-11-17) found these problems, which this feature addresses:

1. In the light themes (Day / Paper) the New / Edit dialog keeps a dark background while its title uses the dark
   text colour, so the title cannot be read. The card hover colour, the hover backgrounds of small buttons and the red
   Delete text are also fixed dark-theme values, and Delete is below the readable contrast on light backgrounds.
2. On the phone, Edit and Delete are small, next to each other and on top of the card's tap area: a tap meant to open a
   collection can edit or delete it, and the reverse.
3. Filling a collection is slow: each book needs a trip to the Library, its menu, and a sub-menu.
4. Collection cards look alike because their colours do not come from their books.
5. A collection cannot be renamed or deleted from its own page.
6. Keyboard and screen-reader use is weak: the dialog lets focus leave it and does not return focus on close; the
   "already added" tick is not announced; the List rows have a faint focus mark and two stops that open the same book.
7. Smaller issues: the Grid / List choice is forgotten every time; removing a book from a collection cannot be undone;
   the collection page grid leaves a ragged gap on narrow screens; the card lift on hover ignores "reduce motion"; the
   phone's Back button does not close the collection dialogs.

## Clarifications

### Session 2026-11-18

- Q: Does feature 015 include the two new capabilities (multi-book picker, real covers on cards), or only the low-risk
  fixes? → A: Full scope in one feature, but delivered in order: the fixes (themes / contrast, phone card actions,
  focus and Back — FR-001…FR-006, FR-016, FR-017, FR-020) are finished and shippable first; the picker (User Story 2)
  and real covers (User Story 3) come after.
- Q: How is the "Add books" picker presented on the phone? → A: A full-screen page (search at the top, a fixed
  "Add (n)" button at the bottom, closed by Back); on Desktop a centred dialog.
- Q: When the "Add to collection" toggle in a book's menu removes the book from a collection, is there a safeguard?
  → A: It removes at once and shows a message with "Undo", exactly like removal on the collection page (FR-015); no
  confirmation dialog.
- Q: On the phone, does a long-press on a collection card also open its Edit / Delete menu? → A: Yes — the same menu
  as the "more" (⋮) control, consistent with long-press on book cards; ⋮ stays the visible primary way.
- Q: How is the Collections list shown on a phone (about 360 px wide)? → A: A one-column list of compact rows (small
  stacked covers on the left · name, one-line description and book count · ⋮ on the right); Desktop keeps the card
  grid.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Collections are readable and safe to use in every theme and on the phone (Priority: P1)

A reader opens Collections in any theme (Dark, Day, Paper, Sepia, System) on Desktop or on the phone. Every text, button
and dialog is readable, and on the phone each collection's actions (open, edit, delete) are separate, finger-sized
targets so a tap never does something other than what was meant.

**Why this priority**: Today the dialog title is invisible in light themes and a tap on the phone can delete a
collection by mistake. These are defects, not polish, and every other story builds on a screen that can be used safely.

**Independent Test**: Switch through every theme, open Collections, create / edit / delete a collection and check each
text and control is readable; on a phone, open, edit and delete collections by tapping and confirm no tap triggers a
neighbouring action.

**Acceptance Scenarios**:

1. **Given** the Day or Paper theme, **When** the user opens "New collection" or "Edit", **Then** the dialog's title,
   description, labels, fields and buttons are all readable against the dialog background.
2. **Given** any theme, **When** the user hovers or focuses a collection card or one of its buttons, **Then** the
   highlight keeps the card's text readable and stays in the theme's colours.
3. **Given** any theme, **When** a destructive action (Delete collection, Remove from collection) is shown, **Then** it
   is marked as destructive by colour AND by its label or icon, and its text is readable on that theme.
4. **Given** the phone, **When** the user looks at a collection card, **Then** its actions are reached through one
   separate "more" control of at least 44 × 44 px that does not overlap the area that opens the collection.
5. **Given** the phone, **When** the user taps the "more" control of a card or long-presses the card, **Then** a menu (or sheet) offers Edit and
   Delete as separate full-width rows, and Delete still asks for confirmation.
6. **Given** Desktop, **When** the user uses the pointer, **Then** the card's actions are also available from a visible
   "more" control and from right-click on the card, not only on hover.

---

### User Story 2 - Add several books to a collection from the collection itself (Priority: P1)

From inside a collection (including an empty one), the reader presses "Add books", sees the library's books with a
search box, ticks several books and confirms. All the ticked books are added at once.

**Why this priority**: Filling a collection is the main job of the screen and today needs four steps per book from
another screen. It is the biggest usability gain of the feature.

**Independent Test**: Create an empty collection, open it, use "Add books" to search and tick five books, confirm, and
check the five books appear in the collection in one step.

**Acceptance Scenarios**:

1. **Given** an empty collection, **When** the user opens it, **Then** the empty state explains that the collection has
   no books and offers an "Add books" action.
2. **Given** any collection page, **When** the user presses "Add books", **Then** a picker lists the library's books
   (cover, title, author) with a search field that filters by title or author as the user types.
3. **Given** the picker, **When** a book is already in the collection, **Then** it is shown as already included and
   cannot be ticked again.
4. **Given** the user has ticked one or more books, **When** they confirm, **Then** all ticked books are added in one
   action, the picker closes, the collection page shows them, and a short message says how many books were added.
5. **Given** the user has ticked books, **When** they cancel or close the picker (Esc, Cancel, phone Back), **Then** no
   book is added.
6. **Given** the library is empty, **When** the user opens the picker, **Then** it says there are no books in the
   library and points to importing books, instead of an empty list.

---

### User Story 3 - Recognise collections at a glance (Priority: P2)

On the Collections list, each card shows the covers of its first books, so the reader recognises a collection by what is
in it rather than by an arbitrary colour.

**Why this priority**: It makes the list scannable once a reader has several collections, but the screen works without
it.

**Independent Test**: Create three collections with different books and check each card shows the covers of its own
first books; create an empty one and check it shows a neutral placeholder.

**Acceptance Scenarios**:

1. **Given** a collection with three or more books, **When** the list is shown, **Then** its card shows the covers of its
   first three books in the collection's order.
2. **Given** a collection with one or two books, **When** the list is shown, **Then** the card shows those covers and
   neutral placeholders for the remaining places.
3. **Given** a book without a cover image, **When** its cover is shown on a card, **Then** the same generated cover the
   Library uses for that book is shown.
4. **Given** an empty collection, **When** the list is shown, **Then** its card shows a neutral placeholder that follows
   the current theme.
5. **Given** books are added to or removed from a collection, **When** the user returns to the list, **Then** the card's
   covers and count reflect the change.

---

### User Story 4 - Manage a collection and its books from its own page (Priority: P2)

On a collection's page, the reader can rename or delete the collection and remove a book from it, and can take back a
removal they did not mean.

**Why this priority**: Removes the need to go back to the list to manage the open collection; the undo protects against
mistakes. Useful, but secondary to readability and adding books.

**Independent Test**: Open a collection, rename it from its page, remove a book and undo the removal, then delete the
collection from its page and check the app returns to the Collections list.

**Acceptance Scenarios**:

1. **Given** a collection page, **When** the user opens its "more" menu, **Then** Edit and Delete are offered.
2. **Given** the user edits the collection from its page, **When** they save, **Then** the page title and description
   update at once.
3. **Given** the user deletes the collection from its page and confirms, **When** it is deleted, **Then** the app goes
   back to the Collections list and the books stay in the library.
4. **Given** a book in a collection, **When** the user removes it from the collection, **Then** a message offers "Undo"
   for at least 5 seconds, and Undo puts the book back at the same place in the collection's order.
5. **Given** a book's menu in the Library, **When** the user opens "Add to collection", **Then** each collection shows
   whether the book is in it, and choosing a collection that already holds the book removes it at once (a toggle) with
   the same "Undo" message as in scenario 4, the state being announced to screen readers.

---

### User Story 5 - Keyboard and screen-reader users can do everything (Priority: P2)

A reader who uses only the keyboard, or a screen reader, can create, open, edit and delete collections, add and remove
books, and always knows where focus is.

**Why this priority**: Accessibility is required for the whole app; most fixes are small but touch every part of the
screen.

**Independent Test**: With the keyboard only, complete: create a collection, add three books through the picker, open
the collection, remove one book, rename and delete the collection — then repeat with a screen reader and check every
control and state is announced.

**Acceptance Scenarios**:

1. **Given** a collection dialog or the picker is open, **When** the user presses Tab, **Then** focus stays inside it;
   **When** it closes, **Then** focus returns to the control that opened it.
2. **Given** any interactive element on the screen, **When** it receives keyboard focus, **Then** a clearly visible
   focus mark is shown (readable against its surroundings in every theme).
3. **Given** a list row for a book, **When** the user tabs through the list, **Then** each book is one stop for opening
   it plus its menu control, not two stops that open the same book.
4. **Given** the "Add to collection" list or the picker, **When** a screen reader reads a collection or a book, **Then**
   it announces whether the book is included.
5. **Given** the phone, **When** a collection dialog, the picker or a collection menu is open and the user presses the
   system Back, **Then** it closes first, before leaving the page.

---

### User Story 6 - The collection page remembers how it is shown and fits any width (Priority: P3)

The reader's Grid / List choice for collection pages is kept between visits and launches, and the Grid fills the width
evenly on narrow and wide windows.

**Why this priority**: Comfort improvements with low risk.

**Independent Test**: Choose List, leave Collections, restart the app, open a collection and check it shows List;
resize the window from phone width to wide and check the Grid has no ragged gap.

**Acceptance Scenarios**:

1. **Given** the user chose List on a collection page, **When** they open any collection later (also after a restart),
   **Then** it is shown as List.
2. **Given** Settings → Advanced → Reset App Settings, **When** the reset runs, **Then** the choice goes back to the
   default (Grid).
3. **Given** a window or screen from 320 px to wide, **When** a collection page shows the Grid, **Then** covers fill the
   rows evenly, the page never scrolls sideways and covers are not distorted.
4. **Given** the system asks for reduced motion, **When** the user hovers or focuses cards, **Then** cards do not move.

---

### Edge Cases

- A collection name or description that is very long, or in a script that is wider than Latin text: the name wraps up
  to two lines (description: two lines on Desktop cards, one line on phone rows) and is cut with an ellipsis after
  that, with the full text available on the collection's page.
- A collection whose books were all removed from the library: it is shown as empty, with "Add books".
- A book in the collection whose file is missing: it is still shown in the collection (as in the Library) and can be
  removed from it.
- The picker with a large library (1 000+ books): it stays responsive while scrolling and searching.
- The picker with a search that matches nothing: it says no book matches and keeps the ticked books ticked.
- Adding books fails part-way: the user is told how many were added and how many failed; nothing is reported as added
  that was not.
- Undo is pressed after the collection was deleted or the book removed from the library: Undo does nothing harmful and
  says it can no longer be undone.
- Two collections with the same name: allowed (as today); cards stay distinguishable by their covers and description.
- The collection open on its page is deleted from elsewhere: the app returns to the Collections list.
- Interface language Vietnamese or English: every new text is translated; book titles, authors and collection names are
  never translated.

## Requirements *(mandatory)*

### Functional Requirements

**Readability and themes**

- **FR-001**: Every text, control, dialog and highlight on the Collections list, the collection page, the collection
  dialogs and the picker MUST take its colours from the current theme; no colour fixed to the dark theme may remain.
- **FR-002**: Normal-size text MUST have at least 4.5 : 1 contrast against its background and icons / control
  boundaries at least 3 : 1, in each theme (Dark, Day, Paper, Sepia).
- **FR-003**: Destructive actions MUST be shown with the theme's danger colour AND a destructive label or icon (never
  colour alone).

**Collection card actions and touch**

- **FR-004**: Each collection card MUST offer its actions (Edit, Delete) through one visible "more" control placed
  outside the area that opens the collection; the same menu MUST also open by right-click on Desktop and by long-press
  on the phone (a long-press MUST NOT also open the collection).
- **FR-005**: On the phone, every interactive target on the Collections list, collection page, dialogs and picker MUST be
  at least 44 × 44 px with at least 8 px between neighbouring targets; the "New collection" button included.
- **FR-006**: Deleting a collection MUST always ask for confirmation stating that its books stay in the library.

**Adding books**

- **FR-007**: The collection page MUST offer an "Add books" action in its header and in its empty state.
- **FR-008**: "Add books" MUST open a picker listing all library books (cover, title, author) with a search that filters
  by title or author while typing, multi-selection, a count of ticked books, and Confirm / Cancel. On the phone the
  picker is a full-screen page with the search field at the top and a fixed "Add (n)" confirm button at the bottom
  (kept above the keyboard and the system gesture area), closed by the system Back; on Desktop it is a centred dialog.
- **FR-009**: Books already in the collection MUST be shown as included and not selectable in the picker.
- **FR-010**: Confirming MUST add all ticked books to the end of the collection in the order they were ticked, in one
  action, and report the number added (and the number that failed, if any).
- **FR-011**: The "Add to collection" list in a book's menu MUST show for each collection whether the book is in it and
  MUST let the user add the book to or remove it from that collection (a toggle), with the state exposed to assistive
  technology. A removal made through this toggle follows FR-015 (immediate, with Undo, no confirmation dialog).

**Card appearance**

- **FR-012**: A collection card MUST show the covers of the collection's first three books (in collection order), using
  the Library's generated cover for books without an image, and theme-coloured placeholders for missing places.
- **FR-013**: A card MUST show the name, the description (if any) and the number of books; long names and descriptions
  MUST be limited to two lines with the full text available.
- **FR-013a**: On the phone, the Collections list MUST be a one-column list of compact rows: the small stacked covers of
  FR-012 on the left, then name (up to two lines), description (one line) and book count, then the "more" control on
  the right; a 360 px wide screen MUST show at least 6 rows without scrolling. Desktop keeps the card grid.

**Collection page management**

- **FR-014**: The collection page MUST offer Edit and Delete for the collection; deleting from the page MUST return the
  user to the Collections list.
- **FR-015**: Removing a book from a collection (from the collection page or from the book menu's toggle) MUST happen
  at once without a confirmation dialog and MUST offer Undo for at least 5 seconds; Undo MUST restore the book at its
  previous position.

**Keyboard, screen reader and navigation**

- **FR-016**: Collection dialogs and the picker MUST keep keyboard focus inside while open, close on Esc, and return focus
  to the control that opened them.
- **FR-017**: Every interactive element MUST show a visible focus indicator meeting FR-002's 3 : 1 contrast.
- **FR-018**: Each book in a list MUST have a single keyboard stop to open it (plus its menu control).
- **FR-019**: Included / not-included states, counts after adding, and success / failure messages MUST be announced to
  screen readers without moving focus.
- **FR-020**: On the phone, the system Back MUST close an open collection dialog, picker, menu or sheet before navigating
  away.

**Layout and preferences**

- **FR-021**: The collection page's Grid / List choice MUST be remembered across visits and launches (one choice for all
  collections) and MUST be reset to Grid by "Reset App Settings".
- **FR-022**: The collection page Grid and the Collections list MUST reflow from 320 px to wide windows without
  horizontal scrolling or ragged gaps.
- **FR-023**: Hover / focus movement of cards MUST be disabled when the system asks for reduced motion.
- **FR-024**: All new interface text MUST exist in English and Vietnamese; user data (book titles, authors, collection
  names and descriptions) MUST never be translated.

**Scope guard**

- **FR-025**: The feature MUST NOT change what a collection is (name, optional description, ordered books), the limits of
  name (80) and description (160), or the rule that deleting a collection never removes books from the library.

### Key Entities

- **Collection**: a user-made group — name, optional description, ordered list of books, created / updated times. A book
  may belong to many collections. Unchanged by this feature.
- **Collection view preference**: the reader's Grid / List choice for collection pages — one value for the whole app,
  kept on the device, resettable.
- **Pending removal**: a book just removed from a collection, kept briefly with its former position so Undo can restore
  it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In each of the four themes, 100 % of texts and controls on the Collections screens, dialogs and picker meet
  the contrast levels of FR-002 (checked on every screen state listed in the user stories).
- **SC-002**: Adding 10 books to an empty collection takes at most 1 picker session and under 60 seconds for a user who
  knows the titles (today: 10 separate trips of 4 steps each).
- **SC-003**: On a 360 px wide phone, 100 % of interactive targets on the Collections screens are at least 44 × 44 px,
  and a test of 20 taps on card areas produces 0 unintended edit / delete / open actions.
- **SC-004**: A keyboard-only user completes the full flow of User Story 5 without a mouse and without focus ever being
  lost behind a dialog.
- **SC-005**: In a test with 5 collections of different books, a user identifies a named collection from the list by its
  covers in under 5 seconds.
- **SC-006**: The picker shows search results within 1 second of typing in a library of 1 000 books.
- **SC-007**: An accidental removal of a book from a collection can be undone in one action within the undo window.

## Assumptions

- **Delivery order** (clarified 2026-11-18): first the fixes — themes / contrast (FR-001…FR-003), phone card actions
  and touch sizes (FR-004…FR-006), dialog focus and phone Back (FR-016, FR-017, FR-020) — as a shippable increment;
  then the "Add books" picker (User Story 2) and real covers (User Story 3); then the remaining P2 / P3 stories.
- The redesign covers both hosts (Desktop and the phone), since they share the Collections screen; phone-specific rules
  (targets, Back, sheet menus) apply only on the phone, and the overall layout keeps the existing visual style of the
  Library.
- The picker adds books in tick order to the END of the collection; reordering books inside a collection, sorting or
  searching the Collections list itself, and sorting inside a collection are NOT part of this feature.
- Duplicate collection names stay allowed (current behaviour).
- No new data is stored about collections; the view preference is a device-level app preference like the other Library
  display preferences, and is included in "Reset App Settings".
- The phone menu for a card reuses the existing phone sheet style of the Library book menu (spec 013).
- Cover images for cards come from the covers the Library already shows; no new cover generation.
- Undo is offered through the app's existing message (toast) area; the 5-second minimum follows common practice.
- Bulk removal of several books at once, sharing / exporting collections and smart (rule-based) collections are out of
  scope.
