# Feature Specification: Phone reader — a reading screen made for the phone

**Feature Branch**: `019-mobile-reader-redesign`

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: "specify cho mình" — turn the UI/UX review of the phone reading screen (2026-11-23: "rất chắp vá
tạm bợ") into a feature (Vietnamese description, summarised).

## Context (current behaviour)

The phone reader (spec 008, first release) is a thin shell around the same reading engine as the computer: the engine is
solid, the screen around it was built as a minimum. The review found:

- **No swipe to turn pages.** Pages turn only with two invisible tap strips along the left / right edges (14 % of the
  width each, from 18 % to 82 % of the height) and ‹ › buttons in the bottom bar. The strips sit over the text, so a
  long press to select text near an edge turns the page instead, and they get in the way of panning a zoomed PDF.
- **Android Back leaves the book while a panel is open.** Contents, Bookmarks / Notes, Appearance and the mark panel do
  not close on Back (the phone Library and Settings screens do).
- **Bars cover the text and pop in / out.** Both bars are shown when a book opens, cover the first and last lines, and
  appear / disappear with no transition. The bottom bar has two rows (‹ slider % › and Contents / Notes / Aa), about
  110 px plus the system area. In Markdown / TXT the bars hide on scroll and can only come back with a tap on a narrow
  margin.
- **The Appearance panel is the computer's panel in a sheet.** It shows keyboard-shortcut hints (Ctrl + = …), offers a
  1-page / 2-page layout, has 36 px controls and 11 px titles, and has no theme (Night / Sepia / Paper) choice — the
  theme can only be changed in the app's Settings.
- **Text glyphs instead of icons**: ‹ › − + and "Aa" are characters; Contents / Notes / Aa are text-only; the bookmark is
  an icon of another style.
- **Marking text takes two steps**: after selecting, "Mark" must be pressed before the colours appear.
- **Little sense of place**: the top bar shows only the book title; the bottom bar a percentage. No chapter name, no
  page or time left in the chapter.
- **Small defects**: releasing the progress slider outside it loses the jump; arrow keys on the slider jump on every
  press; the toast is placed at a fixed 64 px.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Back always does the expected thing (Priority: P1)

A reader with a panel open (Contents, Bookmarks / Notes, Appearance, a mark's panel, the text-selection bar) presses
Android Back (button or gesture): the panel closes and the book stays open. With nothing open, Back leaves the book as
today.

**Why this priority**: today Back throws the reader out of the book in the middle of a task; it is the most frequent
irritation and the cheapest to fix.

**Independent Test**: open each panel and press Back; the panel closes, the reading position is unchanged; press Back
again; the Library appears.

**Acceptance Scenarios**:

1. **Given** the Contents panel is open, **When** the reader presses Back, **Then** the panel closes and the book stays
   on the same page.
2. **Given** a mark's panel is open over the Notes panel, **When** Back is pressed twice, **Then** first the mark's panel
   closes, then the Notes panel, then (third press) the book is left.
3. **Given** text is selected and the selection bar is shown, **When** Back is pressed, **Then** the selection is
   cleared and the bar disappears.
4. **Given** nothing is open, **When** Back is pressed, **Then** the book is left exactly as today (position saved).

---

### User Story 2 - Turn pages by swiping (Priority: P1)

In a paginated book (EPUB in page view) the reader swipes left / right to go to the next / previous page; the page
follows the finger and settles. Taps near the edges still turn pages, but never steal a long press meant for text
selection. Books read by scrolling (PDF, Markdown, TXT, EPUB in scroll view) keep vertical scrolling.

**Why this priority**: swiping is the default way to read on a phone; without it the reader feels unfinished.

**Independent Test**: open an EPUB in page view, swipe through 20 pages both ways, select text near both edges, open a
PDF and zoom / pan near the edges.

**Acceptance Scenarios**:

1. **Given** a paginated EPUB, **When** the reader swipes left past a small threshold, **Then** the next page appears;
   a short or mostly vertical move does not turn the page.
2. **Given** the reader long-presses a word near the left or right edge, **When** the press is held, **Then** text is
   selected and no page turn happens.
3. **Given** a zoomed PDF, **When** the reader drags near an edge, **Then** the page pans; nothing turns.
4. **Given** the first / last page, **When** the reader swipes past it, **Then** the page springs back and nothing else
   happens.
5. **Given** the system asks for reduced motion, **When** a page is turned, **Then** it changes without a sliding
   animation.

---

### User Story 3 - Bars that stay out of the way (Priority: P2)

The book opens straight to the text with the bars hidden. A tap in the middle of the page shows them with a short fade;
another tap, a page turn or a few seconds without interaction hides them. The bottom bar is one slim row: the chapter
name with "page x of y" / "n min left in chapter", the progress slider, and three icon buttons (Contents, Notes,
Appearance). The text is never under a bar the reader did not ask for.

**Why this priority**: the reading area is the product; today a fifth of the screen is chrome when the bars show.

**Independent Test**: open a book (no bars), tap the middle (bars fade in), wait (they fade out), turn a page (they hide),
check that the bottom bar is one row and shows the chapter and place.

**Acceptance Scenarios**:

1. **Given** a book is opened, **When** its first page appears, **Then** no bar covers it.
2. **Given** the bars are hidden, **When** the reader taps the middle third of the page, **Then** both bars fade in
   within 200 ms; **When** they tap there again or turn a page, **Then** they fade out.
3. **Given** the bars are shown and nothing is touched for 4 seconds, **When** no panel or selection is open, **Then**
   they fade out.
4. **Given** the bars are shown, **When** the reader looks at the bottom bar, **Then** it shows the current chapter name,
   the place in it (page x of y, or time left when pages are not known) and the progress slider in one row, plus three
   icon buttons with their names for screen readers.
5. **Given** a Markdown / TXT book scrolled with the bars hidden, **When** the reader taps anywhere on the text that is
   not a link or mark, **Then** the bars show (not only on the margin).
6. **Given** the reader drags the progress slider and releases anywhere on the screen, **Then** the book goes to the
   released place once; arrow keys move the slider without jumping on every press.

---

### User Story 4 - Appearance made for the phone (Priority: P2)

The Appearance panel offers what a phone reader changes while reading: theme (Night / Sepia / Paper), font size, font,
line spacing and margins, each with controls at least 48 dp tall. Computer-only items (keyboard hints, 1 / 2-page
layout) are not shown. Changes apply live behind the panel.

**Why this priority**: changing to a dark theme at night is a frequent need that today requires leaving the book.

**Independent Test**: open Appearance on an EPUB, change theme, size, font, spacing; check the page behind updates and no
computer-only item is shown.

**Acceptance Scenarios**:

1. **Given** Appearance is open, **When** the reader picks Sepia, **Then** the whole app (bars, panels, page) switches
   to Sepia at once and stays so after leaving the book (the same setting as Settings → Appearance).
2. **Given** Appearance is open, **When** the reader looks at it, **Then** no keyboard-shortcut hint and no 1 / 2-page
   choice is shown; every control is at least 48 dp tall and every label at least 12 px.
3. **Given** the reader changes the font size, **When** the panel is open, **Then** the page behind re-lays out and the
   reading position is kept.

---

### User Story 5 - Marking text in one step and a consistent look (Priority: P3)

When the reader finishes selecting text the colour bar appears at once (no "Mark" first). Every control of the reader
uses vector icons from one icon style.

**Why this priority**: polish that makes the reader feel finished; the functions already exist.

**Independent Test**: select text in EPUB, PDF and Markdown and mark it with one tap; check every bar / panel control
for vector icons.

**Acceptance Scenarios**:

1. **Given** the reader lifts the finger after selecting text, **When** the selection is stable, **Then** the colour bar
   (colours, underline, strike, note, copy) appears within 300 ms.
2. **Given** any bar or panel of the reader, **When** it is shown, **Then** its controls use vector icons of the app's
   icon style (no ‹ › − + "Aa" characters), each with an accessible name.

### Edge Cases

- A swipe that starts as a text selection (long press) never turns the page; a swipe that starts on a mark opens nothing.
- A swipe while a panel or the selection bar is open closes / ignores — it never turns a page under a panel.
- Back while the opening screen is shown leaves the book (spec 017 behaviour unchanged).
- Back while a dialog of a panel is open (e.g. the confirmation to delete a mark) closes that dialog first.
- A book without chapters: the bottom bar shows the book's progress instead of a chapter name.
- Pages not known yet (still counting): the bottom bar shows the time left / percentage until they are, never "page 0".
- Landscape phone and small phones (360 px wide): the single-row bottom bar keeps every control ≥ 44 dp; the chapter name
  truncates with an ellipsis.
- Theme changed in the reader while another screen is open in the background: every screen follows (one setting).
- TalkBack: the bars are reachable even while hidden (a "Show reading controls" control at the top of the reading order).

## Requirements *(mandatory)*

### Functional Requirements

**Back (Story 1)**

- **FR-001**: Android Back MUST close, in order, the innermost open layer of the phone reader — a panel's dialog, the
  mark panel, a bottom panel (Contents, Bookmarks / Notes, Appearance), the text-selection bar — before it leaves the
  book; with none open it leaves the book as today.
- **FR-002**: Closing a layer with Back MUST NOT change the reading position or the bars' visibility.

**Page turns (Story 2)**

- **FR-003**: In a paginated EPUB a horizontal swipe longer than a threshold (and more horizontal than vertical) MUST
  turn to the next / previous page, the page following the finger during the swipe and settling after it; past the
  first / last page it springs back.
- **FR-004**: A long press (text selection) or a touch that starts on a mark or link MUST NOT turn a page; swipes MUST be
  ignored while a panel, the selection bar or the opening screen is shown.
- **FR-005**: Edge taps MUST keep turning pages in paginated books, through tap handling on the page itself (not
  elements laid over the text), so long presses near the edges select text and a zoomed PDF pans.
- **FR-006**: Scrolling books (PDF, Markdown, TXT, EPUB scroll view) MUST keep vertical scrolling; swipes do not turn
  pages there.
- **FR-007**: With reduced motion requested, page turns MUST change without sliding.

**Bars (Story 3)**

- **FR-008**: A book MUST open with the bars hidden; a tap in the middle third of a paginated page (anywhere on plain
  text in a scrolling book) toggles them; a page turn, a scroll in a scrolling book, or 4 s without interaction (no
  panel or selection open) hides them.
- **FR-009**: Showing / hiding the bars MUST use a fade of at most 200 ms (none with reduced motion) and MUST NOT move or
  re-lay out the text.
- **FR-010**: The bottom bar MUST be one row: chapter name, place in the chapter (page x of y, else time left, else
  percentage) and the progress slider, with Contents, Notes and Appearance as icon buttons (≥ 44 dp, accessible names).
  The top bar keeps Back, the book title and the bookmark (and PDF zoom).
- **FR-011**: The progress slider MUST go to the released place exactly once, wherever the finger is lifted; keyboard
  changes go to the place after the key is released, not on every repeat.
- **FR-012**: Toasts MUST be placed below the top bar's actual height (or the top of the safe area when the bars are
  hidden).

**Appearance (Story 4)**

- **FR-013**: The phone Appearance panel MUST offer theme (Night / Sepia / Paper — the app's one theme setting), font
  size, font family, line spacing and margins; it MUST NOT show keyboard hints or the 1 / 2-page layout.
- **FR-014**: Every control in the panel MUST be at least 48 dp tall, labels at least 12 px; changes apply live and keep
  the reading position.

**Marking and look (Story 5)**

- **FR-015**: When a text selection ends (finger lifted, selection stable), the colour bar MUST appear directly, without
  a separate "Mark" step.
- **FR-016**: Every control of the phone reader's bars, panels and selection bar MUST use vector icons of the app's icon
  style with accessible names; no text glyph is used as an icon.

**Accessibility (all stories)**

- **FR-017**: While the bars are hidden, a screen-reader user MUST be able to reach a "Show reading controls" control as
  the first item of the reading order; page turns MUST be available as named controls in the bottom bar's reading order.

### Key Entities

- **Reader chrome state**: bars shown / hidden, the open layer stack (panel, mark panel, selection bar), the inactivity
  timer — session-only, per open book.
- **Place in chapter**: chapter name, page x of y in the chapter (when pages are known), time left in the chapter (from
  the reading speed already measured for word counts, else none), book percentage.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With any panel or the selection bar open, Back closes it in 100 % of tries and never leaves the book.
- **SC-002**: In a paginated EPUB, 20 swipes in a row turn exactly 20 pages; 20 long presses near the edges select text
  and turn no page.
- **SC-003**: On opening a book, 0 lines of the first page are covered by a bar.
- **SC-004**: With the bars shown, the bottom bar takes at most 64 dp plus the system gesture area (today about 110 dp).
- **SC-005**: Changing the theme takes 2 taps from the page (Appearance → theme), without leaving the book.
- **SC-006**: Marking a selected passage takes 1 tap after the selection (today 2).
- **SC-007**: No text glyph is used as an icon in the phone reader; every control is ≥ 44 dp (panel controls ≥ 48 dp).

## Assumptions

- Scope: the **phone** reader (Mobile host, `MobileReaderScreen` and its components); the computer's reader is not
  changed, except shared pieces a fix needs (e.g. the selection bar's timing) when Desktop behaviour stays the same.
- Swipe page turns are for paginated EPUB only; PDF stays one continuous vertical scroll on the phone (as today).
  Whether a swipe can be told from a selection on real WebViews (risk R2 of spec 008) is verified on a device first.
- The theme in the reader's Appearance panel is the app's single theme setting (Settings → Appearance), not a per-book
  one.
- "Time left in chapter" uses the existing word counts and a default reading speed; when unavailable only page or
  percentage is shown.
- Search, read aloud, translation and annotation tools stay out of the phone reader (spec 008 first-release scope).
- The 4 s auto-hide and the 200 ms fade are defaults that may be tuned during the plan.
